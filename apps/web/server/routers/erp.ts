import { z } from "zod";
import { eq, desc, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, financeProcedure } from "@/lib/trpc/init";
import { db, erpSyncJobs, auditLogs } from "@flowprocure/db";

export const erpRouter = router({
  listSyncJobs: financeProcedure
    .input(
      z.object({
        status: z
          .enum(["queued", "processing", "success", "failed", "retrying"])
          .optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      return db.query.erpSyncJobs.findMany({
        where: input.status
          ? eq(erpSyncJobs.status, input.status)
          : undefined,
        with: { request: true },
        orderBy: desc(erpSyncJobs.createdAt),
        limit: input.limit,
        offset: input.offset,
      });
    }),

  getSyncStatus: financeProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ input }) => {
      const job = await db.query.erpSyncJobs.findFirst({
        where: eq(erpSyncJobs.id, input.jobId),
        with: { request: true },
      });
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });
      return job;
    }),

  reSync: financeProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const job = await db.query.erpSyncJobs.findFirst({
        where: eq(erpSyncJobs.id, input.jobId),
      });

      if (!job) throw new TRPCError({ code: "NOT_FOUND" });

      if (job.status !== "failed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot re-sync a job with status: ${job.status}. Only failed jobs can be re-synced.`,
        });
      }

      // Reset to queued — preserve error_log history for diagnostics
      await db.update(erpSyncJobs)
        .set({
          status: "queued",
          attemptCount: 0,
          nextRetryAt: null,
          errorCode: null,
          errorMessage: null,
          // errorLog intentionally preserved
        })
        .where(eq(erpSyncJobs.id, input.jobId));

      await db.insert(auditLogs).values({
        eventType: "erp_sync.manual_retry",
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        entityType: "erp_sync_job",
        entityId: input.jobId,
        afterState: {
          triggeredBy: ctx.user.id,
          previousAttemptCount: job.attemptCount,
          previousErrorCode: job.errorCode,
        } as Record<string, unknown>,
      });

      // Note: pg-boss worker polls for 'queued' status and will pick this up.
      // For immediate execution, the worker process would need to be signaled.
      return { success: true, message: "Job re-queued. It will be processed shortly." };
    }),
});
