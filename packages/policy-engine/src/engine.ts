import type {
  EvaluationContext,
  PolicyRecord,
  ResolvedApprovalStep,
} from "./types.js";
import type { PolicyConditions, ConditionRuleType } from "@flowprocure/db";

// ─── Condition evaluation ──────────────────────────────────────────────────

function evaluateRule(
  rule: ConditionRuleType,
  ctx: EvaluationContext
): boolean {
  let fieldValue: string | number | boolean;

  switch (rule.field) {
    case "total_amount":
      fieldValue = ctx.totalAmount;
      break;
    case "department_id":
      fieldValue = ctx.departmentId;
      break;
    case "vendor_is_new":
      fieldValue = ctx.vendorIsNew;
      break;
    case "requester_role":
      fieldValue = ctx.requesterRole;
      break;
    default:
      throw new Error(`Unknown policy field: ${(rule as { field: string }).field}`);
  }

  const val = rule.value;

  switch (rule.operator) {
    case "gt":
      return Number(fieldValue) > Number(val);
    case "gte":
      return Number(fieldValue) >= Number(val);
    case "lt":
      return Number(fieldValue) < Number(val);
    case "lte":
      return Number(fieldValue) <= Number(val);
    case "eq":
      // Support boolean comparisons stored as strings in JSONB
      if (typeof fieldValue === "boolean") {
        const boolVal = val === "true" || String(val) === "true";
        return fieldValue === boolVal;
      }
      return String(fieldValue) === String(val);
    case "neq":
      if (typeof fieldValue === "boolean") {
        const boolVal = val === "true" || String(val) === "true";
        return fieldValue !== boolVal;
      }
      return String(fieldValue) !== String(val);
    case "in":
      return (val as string[]).includes(String(fieldValue));
    case "not_in":
      return !(val as string[]).includes(String(fieldValue));
    default:
      throw new Error(`Unknown operator: ${(rule as { operator: string }).operator}`);
  }
}

function evaluateConditionGroup(
  group: PolicyConditions,
  ctx: EvaluationContext
): boolean {
  const results = group.rules.map((rule) => {
    if ("rules" in rule) {
      return evaluateConditionGroup(rule as PolicyConditions, ctx);
    }
    return evaluateRule(rule as ConditionRuleType, ctx);
  });

  return group.operator === "AND"
    ? results.every(Boolean)
    : results.some(Boolean);
}

// ─── Step building ─────────────────────────────────────────────────────────

/**
 * Evaluates all policies against the context and returns a merged, ordered
 * list of approval steps. Lower priority number = higher precedence for
 * step_number conflicts.
 */
export function buildApprovalChain(
  policies: PolicyRecord[],
  ctx: EvaluationContext
): ResolvedApprovalStep[] {
  const sorted = [...policies].sort((a, b) => a.priority - b.priority);

  const matchingPolicies = sorted.filter((p) =>
    evaluateConditionGroup(p.conditions, ctx)
  );

  // Merge steps: first match by step_number wins (lowest priority number)
  const stepMap = new Map<number, ResolvedApprovalStep>();

  for (const policy of matchingPolicies) {
    for (const step of policy.actions.steps) {
      if (!stepMap.has(step.step_number)) {
        stepMap.set(step.step_number, {
          policyId: policy.id,
          stepNumber: step.step_number,
          label: step.label,
          assigneeType: step.assignee_type,
          assigneeValue: step.assignee_value,
          requiresAll: step.requires_all,
          timeoutHours: step.timeout_hours,
          assigneeIds: [], // populated by resolveAssignees later
        });
      }
    }
  }

  return Array.from(stepMap.values()).sort((a, b) => a.stepNumber - b.stepNumber);
}

/**
 * Dry-run preview: returns matching policy names and the step chain
 * without persisting anything. Used by the PolicyEditor preview feature.
 */
export function previewApprovalChain(
  policies: PolicyRecord[],
  ctx: EvaluationContext
): { matchedPolicyIds: string[]; steps: ResolvedApprovalStep[] } {
  const sorted = [...policies].sort((a, b) => a.priority - b.priority);
  const matchingPolicies = sorted.filter((p) =>
    evaluateConditionGroup(p.conditions, ctx)
  );
  const steps = buildApprovalChain(policies, ctx);

  return {
    matchedPolicyIds: matchingPolicies.map((p) => p.id),
    steps,
  };
}
