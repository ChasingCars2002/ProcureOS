import type { ErpSyncJob } from "@flowprocure/db";

export type ErrorClassification =
  | "AUTH_FAILURE"
  | "RATE_LIMIT"
  | "ERP_UNREACHABLE"
  | "ERP_INTERNAL_ERROR"
  | "RESPONSE_TIMEOUT"
  | "PAYLOAD_REJECTED"
  | "UNKNOWN_ERROR";

export type DiagnosticAlert = {
  jobId: string;
  requestId: string;
  erpSystem: string;
  errorCode: ErrorClassification;
  errorMessage: string;
  attemptCount: number;
  actionUrl: string;
};

export function classifyError(error: unknown): {
  code: ErrorClassification;
  message: string;
} {
  const err = error as { message?: string; status?: number; code?: string };
  const message = err.message ?? String(error);
  const status = err.status;

  if (status === 401 || status === 403) {
    return { code: "AUTH_FAILURE", message: `Authentication failed (HTTP ${status}): ${message}` };
  }
  if (status === 429) {
    return { code: "RATE_LIMIT", message: `Rate limit exceeded: ${message}` };
  }
  if (status && status >= 500) {
    return { code: "ERP_INTERNAL_ERROR", message: `ERP internal server error (HTTP ${status}): ${message}` };
  }
  if (status && status >= 400) {
    return { code: "PAYLOAD_REJECTED", message: `ERP rejected payload (HTTP ${status}): ${message}` };
  }
  if (
    err.code === "ECONNREFUSED" ||
    err.code === "ENOTFOUND" ||
    err.code === "ENETUNREACH"
  ) {
    return { code: "ERP_UNREACHABLE", message: `ERP unreachable (network error: ${err.code}): ${message}` };
  }
  if (err.code === "ETIMEDOUT" || message.toLowerCase().includes("timeout")) {
    return { code: "RESPONSE_TIMEOUT", message: `ERP response timeout: ${message}` };
  }
  return { code: "UNKNOWN_ERROR", message };
}

/**
 * Dispatch a structured alert when ERP sync permanently fails.
 * In production this sends email via Resend and triggers a Supabase Realtime event.
 */
export async function dispatchDiagnosticAlert(
  job: ErpSyncJob,
  errorCode: ErrorClassification,
  appUrl: string
): Promise<void> {
  const alert: DiagnosticAlert = {
    jobId: job.id,
    requestId: job.requestId,
    erpSystem: job.erpSystem,
    errorCode,
    errorMessage: job.errorMessage ?? "Unknown error",
    attemptCount: job.attemptCount,
    actionUrl: `${appUrl}/erp?jobId=${job.id}`,
  };

  console.error("[ERP Sync Alert] Permanent failure detected:", alert);

  // Send alert email to finance and admin users
  const resendApiKey = process.env.RESEND_API_KEY;
  const alertEmailTo = process.env.ERP_ALERT_EMAIL ?? "finance@flowprocure.dev";

  if (resendApiKey) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "FlowProcure Alerts <alerts@flowprocure.dev>",
          to: [alertEmailTo],
          subject: `[ACTION REQUIRED] ERP Sync Failed: ${job.erpSystem.toUpperCase()} — ${errorCode}`,
          html: buildAlertEmailHtml(alert),
        }),
      });
    } catch (emailErr) {
      console.error("[ERP Sync Alert] Failed to send alert email:", emailErr);
    }
  }
}

function buildAlertEmailHtml(alert: DiagnosticAlert): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px;">
      <h2 style="color: #dc2626;">ERP Sync Permanently Failed</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td><strong>ERP System</strong></td><td>${alert.erpSystem.toUpperCase()}</td></tr>
        <tr><td><strong>Error Type</strong></td><td>${alert.errorCode}</td></tr>
        <tr><td><strong>Error Detail</strong></td><td>${alert.errorMessage}</td></tr>
        <tr><td><strong>Attempts Made</strong></td><td>${alert.attemptCount}</td></tr>
        <tr><td><strong>Job ID</strong></td><td>${alert.jobId}</td></tr>
        <tr><td><strong>Request ID</strong></td><td>${alert.requestId}</td></tr>
      </table>
      <p style="margin-top: 24px;">
        <a href="${alert.actionUrl}" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          View in FlowProcure &rarr; Re-Sync
        </a>
      </p>
    </div>
  `;
}

/** Exponential backoff: 1min, 4min, 16min, 64min, 256min (4.3h) */
export function computeNextRetry(attemptCount: number): Date {
  const delayMs = Math.pow(4, attemptCount) * 60_000;
  const jitterMs = Math.random() * 30_000;
  return new Date(Date.now() + delayMs + jitterMs);
}
