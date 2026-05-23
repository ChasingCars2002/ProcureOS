import type { PolicyConditions, PolicyActions, ApprovalStepConfig } from "@flowprocure/db";

export type { PolicyConditions, PolicyActions, ApprovalStepConfig };

export type EvaluationContext = {
  totalAmount: number;
  departmentId: string;
  vendorIsNew: boolean;
  vendorComplianceReviewed: boolean;
  requesterId: string;
  requesterRole: string;
};

export type PolicyRecord = {
  id: string;
  priority: number;
  conditions: PolicyConditions;
  actions: PolicyActions;
};

export type ResolvedApprovalStep = {
  policyId: string;
  stepNumber: number;
  label: string;
  assigneeType: ApprovalStepConfig["assignee_type"];
  assigneeValue: string;
  requiresAll: boolean;
  timeoutHours: number | null;
  /** Resolved concrete user IDs — populated after resolveAssignees() */
  assigneeIds: string[];
};
