"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { RefreshCw, AlertCircle, CheckCircle, Clock, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import type { ErpSyncJob } from "@flowprocure/db";

type Props = {
  jobs: ErpSyncJob[];
};

const statusConfig = {
  queued: { icon: Clock, color: "text-gray-500", bg: "bg-gray-100", label: "Queued" },
  processing: { icon: Loader2, color: "text-blue-600", bg: "bg-blue-50", label: "Processing" },
  success: { icon: CheckCircle, color: "text-green-600", bg: "bg-green-50", label: "Success" },
  failed: { icon: AlertCircle, color: "text-red-600", bg: "bg-red-50", label: "Failed" },
  retrying: { icon: RefreshCw, color: "text-orange-600", bg: "bg-orange-50", label: "Retrying" },
};

export function SyncStatusPanel({ jobs }: Props) {
  const [reSyncingIds, setReSyncingIds] = useState<Set<string>>(new Set());
  const reSync = trpc.erp.reSync.useMutation({
    onSuccess: (_, { jobId }) => {
      setReSyncingIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    },
    onError: (_, { jobId }) => {
      setReSyncingIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    },
  });

  const handleReSync = (jobId: string) => {
    setReSyncingIds((prev) => new Set(prev).add(jobId));
    reSync.mutate({ jobId });
  };

  if (jobs.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <p className="text-gray-500 text-sm">No sync jobs found.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="py-3 px-4 text-left font-medium text-gray-500">Request</th>
            <th className="py-3 px-4 text-left font-medium text-gray-500">ERP</th>
            <th className="py-3 px-4 text-left font-medium text-gray-500">Status</th>
            <th className="py-3 px-4 text-left font-medium text-gray-500">Attempts</th>
            <th className="py-3 px-4 text-left font-medium text-gray-500">Last Attempt</th>
            <th className="py-3 px-4 text-left font-medium text-gray-500">Error</th>
            <th className="py-3 px-4 text-left font-medium text-gray-500"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {jobs.map((job) => {
            const cfg = statusConfig[job.status];
            const isReSyncing = reSyncingIds.has(job.id);
            const Icon = cfg.icon;

            return (
              <tr key={job.id} className="hover:bg-gray-50">
                <td className="py-3 px-4 font-medium text-gray-900">
                  {job.requestId.slice(0, 8)}
                </td>
                <td className="py-3 px-4 text-gray-600 uppercase text-xs font-medium">
                  {job.erpSystem}
                </td>
                <td className="py-3 px-4">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color}`}>
                    <Icon className={`w-3 h-3 ${job.status === "processing" ? "animate-spin" : ""}`} />
                    {cfg.label}
                  </span>
                </td>
                <td className="py-3 px-4 text-gray-600">
                  {job.attemptCount}/{job.maxAttempts}
                </td>
                <td className="py-3 px-4 text-gray-500">
                  {job.lastAttemptedAt
                    ? formatDistanceToNow(new Date(job.lastAttemptedAt), { addSuffix: true })
                    : "—"}
                </td>
                <td className="py-3 px-4">
                  {job.errorCode ? (
                    <span className="text-red-600 text-xs font-mono" title={job.errorMessage ?? ""}>
                      {job.errorCode}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="py-3 px-4">
                  {job.status === "failed" && (
                    <button
                      onClick={() => handleReSync(job.id)}
                      disabled={isReSyncing}
                      className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${isReSyncing ? "animate-spin" : ""}`} />
                      {isReSyncing ? "Re-syncing..." : "Re-Sync"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
