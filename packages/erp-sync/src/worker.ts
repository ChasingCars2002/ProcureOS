import "dotenv/config";
import PgBoss from "pg-boss";
import { eq, and } from "drizzle-orm";
import {
  db,
  erpSyncJobs,
  purchaseRequests,
  lineItems,
  vendors,
  type ErpSyncJob,
  type ErpAttemptLog,
} from "@flowprocure/db";
import { QuickBooksClient, buildQbPayload } from "./quickbooks/client.js";
import { NetSuiteClient, buildNsPayload } from "./netsuite/client.js";
import {
  classifyError,
  dispatchDiagnosticAlert,
  computeNextRetry,
} from "./diagnostics.js";

export const ERP_SYNC_QUEUE = "erp-sync";

// ─── Worker setup ──────────────────────────────────────────────────────────

export async function startWorker(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const boss = new PgBoss(connectionString);

  boss.on("error", (error) => {
    console.error("[pg-boss] Error:", error);
  });

  await boss.start();
  console.log("[ERP Worker] pg-boss started");

  await boss.work<{ jobId: string }>(ERP_SYNC_QUEUE, processJob);
  console.log(`[ERP Worker] Listening on queue: ${ERP_SYNC_QUEUE}`);

  return boss;
}

// ─── Job processor ─────────────────────────────────────────────────────────

async function processJob(
  jobs: PgBoss.Job<{ jobId: string }>[]
): Promise<void> {
  const job = jobs[0];
  if (!job) return;
  const { jobId } = job.data;
  console.log(`[ERP Worker] Processing job ${jobId}`);

  const syncJob = await db.query.erpSyncJobs.findFirst({
    where: eq(erpSyncJobs.id, jobId),
  });

  if (!syncJob) {
    console.error(`[ERP Worker] Job ${jobId} not found in database`);
    return;
  }

  if (syncJob.status === "success") {
    console.log(`[ERP Worker] Job ${jobId} already succeeded, skipping`);
    return;
  }

  // Mark as processing
  await db.update(erpSyncJobs)
    .set({
      status: "processing",
      attemptCount: syncJob.attemptCount + 1,
      lastAttemptedAt: new Date(),
      pgBossJobId: job.id,
    })
    .where(eq(erpSyncJobs.id, jobId));

  const startTime = Date.now();

  try {
    const result = await exportToErp(syncJob);

    // Success
    await db.update(erpSyncJobs)
      .set({
        status: "success",
        result,
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      })
      .where(eq(erpSyncJobs.id, jobId));

    await db.update(purchaseRequests)
      .set({
        erpExported: true,
        erpExportReference: (result as { id: string }).id,
        updatedAt: new Date(),
      })
      .where(eq(purchaseRequests.id, syncJob.requestId));

    console.log(`[ERP Worker] Job ${jobId} succeeded`);
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const { code, message } = classifyError(error);
    const currentJob = await db.query.erpSyncJobs.findFirst({
      where: eq(erpSyncJobs.id, jobId),
    });
    const newAttemptCount = (currentJob?.attemptCount ?? syncJob.attemptCount + 1);
    const maxAttempts = syncJob.maxAttempts;

    const attemptLog: ErpAttemptLog = {
      attempt: newAttemptCount,
      timestamp: new Date().toISOString(),
      error: message,
      errorCode: code,
      durationMs,
    };

    const existingLog = (currentJob?.errorLog ?? []) as ErpAttemptLog[];
    const newLog = [...existingLog, attemptLog];

    if (newAttemptCount >= maxAttempts) {
      // Permanent failure
      await db.update(erpSyncJobs)
        .set({
          status: "failed",
          errorCode: code,
          errorMessage: message,
          errorLog: newLog,
        })
        .where(eq(erpSyncJobs.id, jobId));

      const failedJob = await db.query.erpSyncJobs.findFirst({
        where: eq(erpSyncJobs.id, jobId),
      });
      if (failedJob) {
        await dispatchDiagnosticAlert(
          failedJob,
          code,
          process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
        );
      }

      console.error(`[ERP Worker] Job ${jobId} permanently failed after ${newAttemptCount} attempts: ${code}`);
    } else {
      // Schedule retry with exponential backoff
      const nextRetryAt = computeNextRetry(newAttemptCount);

      await db.update(erpSyncJobs)
        .set({
          status: "retrying",
          errorCode: code,
          errorMessage: message,
          errorLog: newLog,
          nextRetryAt,
        })
        .where(eq(erpSyncJobs.id, jobId));

      // pg-boss re-enqueue is handled by throwing — pg-boss will retry
      // We could also explicitly re-send with a delay
      throw error; // Let pg-boss know the job failed so it retries
    }
  }
}

// ─── ERP export (idempotent) ───────────────────────────────────────────────

async function exportToErp(job: ErpSyncJob): Promise<unknown> {
  const [request, items] = await Promise.all([
    db.query.purchaseRequests.findFirst({
      where: eq(purchaseRequests.id, job.requestId),
    }),
    db.query.lineItems.findMany({
      where: eq(lineItems.requestId, job.requestId),
    }),
  ]);

  if (!request) throw new Error(`Purchase request ${job.requestId} not found`);

  const vendor = request.vendorId
    ? await db.query.vendors.findFirst({ where: eq(vendors.id, request.vendorId) })
    : null;

  if (job.erpSystem === "quickbooks") {
    const client = new QuickBooksClient({
      realmId: process.env.QUICKBOOKS_REALM_ID!,
      accessToken: process.env.QUICKBOOKS_ACCESS_TOKEN!,
    });

    // Idempotency: check if already exported
    if (request.erpExportReference) {
      const existing = await client.getPurchaseOrder(request.erpExportReference);
      if (existing) return existing;
    }

    const payload = buildQbPayload(request, items, vendor ?? null);
    return client.createPurchaseOrder(payload);
  }

  if (job.erpSystem === "netsuite") {
    const client = new NetSuiteClient({
      accountId: process.env.NETSUITE_ACCOUNT_ID!,
      consumerKey: process.env.NETSUITE_CONSUMER_KEY!,
      consumerSecret: process.env.NETSUITE_CONSUMER_SECRET!,
      tokenId: process.env.NETSUITE_TOKEN_ID!,
      tokenSecret: process.env.NETSUITE_TOKEN_SECRET!,
    });

    if (request.erpExportReference) {
      const existing = await client.getPurchaseOrder(request.erpExportReference);
      if (existing) return existing;
    }

    const payload = buildNsPayload(request, items, vendor ?? null);
    return client.createPurchaseOrder(payload);
  }

  throw new Error(`Unsupported ERP system: ${job.erpSystem}`);
}

// ─── Entrypoint ────────────────────────────────────────────────────────────

if (process.argv[1] === new URL(import.meta.url).pathname) {
  startWorker().then(() => {
    console.log("[ERP Worker] Running. Press Ctrl+C to stop.");
  }).catch((err) => {
    console.error("[ERP Worker] Fatal startup error:", err);
    process.exit(1);
  });

  process.on("SIGTERM", async () => {
    console.log("[ERP Worker] Shutting down...");
    process.exit(0);
  });
}
