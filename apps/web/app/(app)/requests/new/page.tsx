import { createServerCaller } from "@/lib/trpc/server";
import { NewRequestForm } from "@/components/requests/RequestForm";

export default async function NewRequestPage() {
  const caller = await createServerCaller();
  const [vendors, policies] = await Promise.all([
    caller.vendors.list({}),
    caller.policies.list(),
  ]);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">New Purchase Request</h1>
        <p className="text-sm text-gray-500 mt-1">Fill in the details below to submit a request for approval.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <NewRequestForm vendors={vendors} />
      </div>
    </div>
  );
}
