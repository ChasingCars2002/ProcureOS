"use client";

import { useState, useEffect, useCallback } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { AlertTriangle, Clock } from "lucide-react";
import { BulkActionBar } from "./BulkActionBar";
import { trpc } from "@/lib/trpc/client";

type InboxItem = {
  assignmentId: string;
  requestId: string;
  requestNumber: string;
  title: string;
  totalAmount: string;
  status: string;
  createdAt: Date;
  neededByDate: string | null;
  stepLabel: string;
  stepNumber: number;
};

type Props = {
  initialItems: InboxItem[];
};

export function InboxTable({ initialItems }: Props) {
  const [items, setItems] = useState(initialItems);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);

  const bulkDecide = trpc.approvals.bulkDecide.useMutation({
    onSuccess: () => {
      // Remove processed items from the list
      setItems((prev) =>
        prev.filter((item) => !selectedIds.has(item.assignmentId))
      );
      setSelectedIds(new Set());
      setIsProcessing(false);
    },
    onError: () => {
      setIsProcessing(false);
    },
  });

  const handleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((item) => item.assignmentId)));
    }
  };

  const handleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleBulkAction = useCallback(
    (decision: "approved" | "rejected", comment?: string) => {
      setIsProcessing(true);
      bulkDecide.mutate({
        assignmentIds: Array.from(selectedIds),
        decision,
        comment,
      });
    },
    [selectedIds, bulkDecide]
  );

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-4">
          <span className="text-green-600 text-xl">✓</span>
        </div>
        <h3 className="text-lg font-medium text-gray-900">Inbox is clear</h3>
        <p className="text-sm text-gray-500 mt-1">No pending approvals.</p>
      </div>
    );
  }

  const allSelected = selectedIds.size === items.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  return (
    <div className="relative">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="w-10 py-3 pl-4 text-left">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected; }}
                onChange={handleSelectAll}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                aria-label="Select all"
              />
            </th>
            <th className="py-3 px-4 text-left font-medium text-gray-500">Request</th>
            <th className="py-3 px-4 text-left font-medium text-gray-500">Amount</th>
            <th className="py-3 px-4 text-left font-medium text-gray-500">Step</th>
            <th className="py-3 px-4 text-left font-medium text-gray-500">Submitted</th>
            <th className="py-3 px-4 text-left font-medium text-gray-500">Needed By</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item) => {
            const amount = Number(item.totalAmount);
            const isUrgent =
              item.neededByDate &&
              new Date(item.neededByDate) <= new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
            const isSelected = selectedIds.has(item.assignmentId);

            return (
              <tr
                key={item.assignmentId}
                className={`group cursor-pointer ${
                  isSelected ? "bg-blue-50" : "hover:bg-gray-50"
                }`}
                onClick={() => handleSelect(item.assignmentId)}
              >
                <td className="py-3 pl-4" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleSelect(item.assignmentId)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    aria-label={`Select ${item.requestNumber}`}
                  />
                </td>
                <td className="py-3 px-4">
                  <a
                    href={`/requests/${item.requestId}`}
                    className="hover:text-blue-600"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="font-medium text-gray-900">{item.title}</div>
                    <div className="text-xs text-gray-400">{item.requestNumber}</div>
                  </a>
                </td>
                <td className="py-3 px-4">
                  <span
                    className={`font-mono font-medium ${
                      amount >= 5000
                        ? "text-red-600"
                        : amount >= 500
                        ? "text-orange-600"
                        : "text-gray-900"
                    }`}
                  >
                    ${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
                </td>
                <td className="py-3 px-4 text-gray-600">{item.stepLabel}</td>
                <td className="py-3 px-4 text-gray-500">
                  {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                </td>
                <td className="py-3 px-4">
                  {item.neededByDate ? (
                    <span
                      className={`flex items-center gap-1 ${
                        isUrgent ? "text-red-600 font-medium" : "text-gray-500"
                      }`}
                    >
                      {isUrgent && <Clock className="w-3 h-3" />}
                      {format(new Date(item.neededByDate), "MMM d")}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          onApprove={(comment) => handleBulkAction("approved", comment)}
          onReject={(comment) => handleBulkAction("rejected", comment)}
          isProcessing={isProcessing}
        />
      )}
    </div>
  );
}
