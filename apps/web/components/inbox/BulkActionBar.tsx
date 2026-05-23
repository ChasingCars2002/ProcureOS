"use client";

import { useState } from "react";
import { CheckCircle, XCircle, X } from "lucide-react";

type Props = {
  count: number;
  onApprove: (comment?: string) => void;
  onReject: (comment?: string) => void;
  isProcessing: boolean;
};

export function BulkActionBar({ count, onApprove, onReject, isProcessing }: Props) {
  const [showRejectComment, setShowRejectComment] = useState(false);
  const [comment, setComment] = useState("");

  const handleReject = () => {
    if (showRejectComment) {
      onReject(comment || undefined);
      setShowRejectComment(false);
      setComment("");
    } else {
      setShowRejectComment(true);
    }
  };

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-2xl"
      style={{ opacity: isProcessing ? 0.7 : 1 }}
      role="toolbar"
      aria-label="Bulk actions"
    >
      <span className="text-sm font-medium text-gray-300">
        {count} selected
      </span>

      {showRejectComment && (
        <input
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Rejection reason (optional)"
          className="text-sm bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500 w-56"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") handleReject();
            if (e.key === "Escape") setShowRejectComment(false);
          }}
        />
      )}

      <button
        onClick={() => onApprove()}
        disabled={isProcessing}
        className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg"
      >
        <CheckCircle className="w-4 h-4" />
        Approve {count > 1 ? `All (${count})` : ""}
      </button>

      <button
        onClick={handleReject}
        disabled={isProcessing}
        className="flex items-center gap-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg"
      >
        <XCircle className="w-4 h-4" />
        {showRejectComment ? "Confirm Reject" : `Reject ${count > 1 ? `All (${count})` : ""}`}
      </button>

      {showRejectComment && (
        <button
          onClick={() => setShowRejectComment(false)}
          className="text-gray-400 hover:text-white p-1"
          aria-label="Cancel reject"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
