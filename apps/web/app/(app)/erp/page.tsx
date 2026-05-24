import { createServerCaller } from "@/lib/trpc/server";
import { SyncStatusPanel } from "@/components/erp/SyncStatusPanel";

export default async function ErpPage() {
  const caller = await createServerCaller();
  const [failed, recent] = await Promise.all([
    caller.erp.listSyncJobs({ status: "failed", limit: 20 }),
    caller.erp.listSyncJobs({ limit: 50 }),
  ]);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">ERP Sync</h1>
        <p className="text-sm text-gray-500 mt-1">
          Monitor and manage QuickBooks / NetSuite export jobs.
        </p>
      </div>

      {failed.length > 0 && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
            <span className="text-sm font-medium text-red-800">
              {failed.length} sync job{failed.length !== 1 ? "s" : ""} failed and require attention
            </span>
          </div>
        </div>
      )}

      <SyncStatusPanel jobs={recent as Parameters<typeof SyncStatusPanel>[0]["jobs"]} />
    </div>
  );
}
