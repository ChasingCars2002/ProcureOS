import { createServerCaller } from "@/lib/trpc/server";
import { InboxTable } from "@/components/inbox/InboxTable";

export default async function InboxPage() {
  const caller = await createServerCaller();
  const items = await caller.approvals.inbox();

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Inbox</h1>
          <p className="text-sm text-gray-500 mt-1">
            {items.length === 0
              ? "No pending approvals"
              : `${items.length} pending approval${items.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <a
          href="/requests/new"
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          New Request
        </a>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <InboxTable initialItems={items as Parameters<typeof InboxTable>[0]["initialItems"]} />
      </div>
    </div>
  );
}
