"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import type { Vendor } from "@flowprocure/db";

type LineItemInput = {
  description: string;
  quantity: number;
  unitPrice: number;
  glAccountCode?: string;
};

type Props = {
  vendors: Pick<Vendor, "id" | "name" | "isNew">[];
};

export function NewRequestForm({ vendors }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [businessJustification, setBusinessJustification] = useState("");
  const [neededByDate, setNeededByDate] = useState("");
  const [lineItems, setLineItems] = useState<LineItemInput[]>([
    { description: "", quantity: 1, unitPrice: 0 },
  ]);
  const [submitted, setSubmitted] = useState(false);

  const createRequest = trpc.requests.create.useMutation();
  const submitRequest = trpc.requests.submit.useMutation({
    onSuccess: (data) => {
      setSubmitted(true);
      setTimeout(() => router.push(`/requests/${createRequest.data?.id}`), 600);
    },
  });

  const totalAmount = lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  );

  const addLineItem = () => {
    setLineItems((prev) => [
      ...prev,
      { description: "", quantity: 1, unitPrice: 0 },
    ]);
  };

  const removeLineItem = (idx: number) => {
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateLineItem = (idx: number, updates: Partial<LineItemInput>) => {
    setLineItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, ...updates } : item))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = lineItems.filter(
      (item) => item.description && item.quantity > 0 && item.unitPrice > 0
    );
    if (!title || validItems.length === 0) return;

    // Hardcode departmentId for demo — in production, get from user's dept
    const DEPT_PLACEHOLDER = "00000000-0000-0000-0000-000000000001";

    const request = await createRequest.mutateAsync({
      title,
      vendorId: vendorId || undefined,
      businessJustification: businessJustification || undefined,
      neededByDate: neededByDate || undefined,
      departmentId: DEPT_PLACEHOLDER,
      lineItems: validItems,
    });

    await submitRequest.mutateAsync({ id: request.id });
  };

  const isLoading = createRequest.isPending || submitRequest.isPending;

  if (submitted) {
    return (
      <div className="py-8 text-center">
        <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
          <span className="text-green-600">✓</span>
        </div>
        <p className="font-medium text-gray-900">Request submitted</p>
        <p className="text-sm text-gray-500 mt-1">Routing to approvers...</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Request Title <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Q2 Software Licenses"
          required
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Vendor
        </label>
        <select
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">— Select vendor (optional) —</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} {v.isNew ? "(New — compliance review required)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Line Items <span className="text-red-500">*</span>
        </label>
        <div className="space-y-2">
          {lineItems.map((item, idx) => (
            <div key={idx} className="flex gap-2 items-start">
              <input
                type="text"
                value={item.description}
                onChange={(e) => updateLineItem(idx, { description: e.target.value })}
                placeholder="Description"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="number"
                value={item.quantity}
                onChange={(e) => updateLineItem(idx, { quantity: Number(e.target.value) })}
                min="0.001"
                step="any"
                placeholder="Qty"
                className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="number"
                value={item.unitPrice || ""}
                onChange={(e) => updateLineItem(idx, { unitPrice: Number(e.target.value) })}
                min="0"
                step="0.01"
                placeholder="Unit $"
                className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {lineItems.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLineItem(idx)}
                  className="p-2 text-gray-400 hover:text-red-500"
                  aria-label="Remove line item"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addLineItem}
          className="mt-2 flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
        >
          <Plus className="w-4 h-4" /> Add line item
        </button>
      </div>

      <div className="flex items-center justify-between py-3 px-4 bg-gray-50 rounded-lg">
        <span className="text-sm font-medium text-gray-600">Total</span>
        <span className={`font-mono font-semibold text-lg ${
          totalAmount >= 5000 ? "text-red-600" : totalAmount >= 500 ? "text-orange-600" : "text-gray-900"
        }`}>
          ${totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </span>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Business Justification
        </label>
        <textarea
          value={businessJustification}
          onChange={(e) => setBusinessJustification(e.target.value)}
          rows={3}
          placeholder="Why is this purchase needed?"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Needed By Date
        </label>
        <input
          type="date"
          value={neededByDate}
          onChange={(e) => setNeededByDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
        <a
          href="/inbox"
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
        >
          Cancel
        </a>
        <button
          type="submit"
          disabled={isLoading || !title}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg"
        >
          {isLoading ? "Submitting..." : "Submit Request"}
        </button>
      </div>
    </form>
  );
}
