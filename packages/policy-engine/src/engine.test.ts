import { describe, it, expect } from "vitest";
import { buildApprovalChain, previewApprovalChain } from "./engine.js";
import type { PolicyRecord, EvaluationContext } from "./types.js";

// ─── Test fixtures ─────────────────────────────────────────────────────────

const ENG_DEPT_ID = "dept-engineering-uuid";
const FIN_DEPT_ID = "dept-finance-uuid";
const CTO_USER_ID = "user-cto-uuid";
const ADMIN_USER_ID = "user-admin-uuid";

const defaultCtx: EvaluationContext = {
  totalAmount: 100,
  departmentId: FIN_DEPT_ID,
  vendorIsNew: false,
  vendorComplianceReviewed: true,
  requesterId: "user-requester-uuid",
  requesterRole: "requester",
};

const defaultPolicies: PolicyRecord[] = [
  {
    id: "policy-manager-approval",
    priority: 10,
    conditions: {
      operator: "AND",
      rules: [{ field: "total_amount", operator: "gte", value: 500 }],
    },
    actions: {
      steps: [
        {
          step_number: 1,
          label: "Manager Approval",
          assignee_type: "department_budget_owner",
          assignee_value: "self",
          requires_all: false,
          timeout_hours: 48,
        },
      ],
    },
  },
  {
    id: "policy-finance-exec",
    priority: 20,
    conditions: {
      operator: "AND",
      rules: [{ field: "total_amount", operator: "gte", value: 5000 }],
    },
    actions: {
      steps: [
        {
          step_number: 2,
          label: "Finance Review",
          assignee_type: "role",
          assignee_value: "finance",
          requires_all: false,
          timeout_hours: 24,
        },
        {
          step_number: 3,
          label: "Executive Approval",
          assignee_type: "role",
          assignee_value: "admin",
          requires_all: false,
          timeout_hours: 48,
        },
      ],
    },
  },
  {
    id: "policy-new-vendor",
    priority: 30,
    conditions: {
      operator: "AND",
      rules: [{ field: "vendor_is_new", operator: "eq", value: "true" }],
    },
    actions: {
      steps: [
        {
          step_number: 4,
          label: "Vendor Compliance Review",
          assignee_type: "role",
          assignee_value: "finance",
          requires_all: true,
          timeout_hours: 72,
        },
      ],
    },
  },
  {
    id: "policy-eng-cto",
    priority: 40,
    conditions: {
      operator: "AND",
      rules: [
        { field: "department_id", operator: "eq", value: ENG_DEPT_ID },
        { field: "total_amount", operator: "gte", value: 500 },
      ],
    },
    actions: {
      steps: [
        {
          step_number: 1,
          label: "CTO Approval",
          assignee_type: "user",
          assignee_value: CTO_USER_ID,
          requires_all: false,
          timeout_hours: 48,
        },
      ],
    },
  },
];

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("buildApprovalChain", () => {
  it("returns empty chain for low-spend known vendor (no policies match)", () => {
    const ctx = { ...defaultCtx, totalAmount: 100, vendorIsNew: false };
    const result = buildApprovalChain(defaultPolicies, ctx);
    expect(result).toHaveLength(0);
  });

  it("routes $500 exactly to manager only (gte boundary)", () => {
    const ctx = { ...defaultCtx, totalAmount: 500 };
    const result = buildApprovalChain(defaultPolicies, ctx);
    expect(result).toHaveLength(1);
    expect(result[0].stepNumber).toBe(1);
    expect(result[0].assigneeType).toBe("department_budget_owner");
    expect(result[0].label).toBe("Manager Approval");
  });

  it("routes $501 to manager only", () => {
    const ctx = { ...defaultCtx, totalAmount: 501 };
    const result = buildApprovalChain(defaultPolicies, ctx);
    expect(result).toHaveLength(1);
    expect(result[0].assigneeType).toBe("department_budget_owner");
  });

  it("routes $5000 exactly to manager + finance + exec (3 steps)", () => {
    const ctx = { ...defaultCtx, totalAmount: 5000 };
    const result = buildApprovalChain(defaultPolicies, ctx);
    expect(result).toHaveLength(3);
    expect(result[0].stepNumber).toBe(1);
    expect(result[1].stepNumber).toBe(2);
    expect(result[1].label).toBe("Finance Review");
    expect(result[2].stepNumber).toBe(3);
    expect(result[2].label).toBe("Executive Approval");
  });

  it("adds compliance step for new vendor + high spend (4 steps total)", () => {
    const ctx: EvaluationContext = {
      ...defaultCtx,
      totalAmount: 6000,
      vendorIsNew: true,
    };
    const result = buildApprovalChain(defaultPolicies, ctx);
    expect(result).toHaveLength(4); // step 1 (manager) + step 2 (finance) + step 3 (exec) + step 4 (compliance)
    const stepNumbers = result.map((s) => s.stepNumber);
    expect(stepNumbers).toEqual([1, 2, 3, 4]);
    expect(result[3].label).toBe("Vendor Compliance Review");
    expect(result[3].requiresAll).toBe(true);
  });

  it("engineering dept routes to CTO instead of generic manager (priority wins)", () => {
    const ctx: EvaluationContext = {
      ...defaultCtx,
      totalAmount: 700,
      departmentId: ENG_DEPT_ID,
    };
    const result = buildApprovalChain(defaultPolicies, ctx);
    // Both policy-manager-approval (priority 10) and policy-eng-cto (priority 40)
    // match and both produce step_number 1. Priority 10 wins.
    expect(result).toHaveLength(1);
    expect(result[0].stepNumber).toBe(1);
    // Manager policy (priority 10) wins the step_number 1 conflict over CTO policy (priority 40)
    expect(result[0].assigneeType).toBe("department_budget_owner");
  });

  it("evaluates OR conditions correctly", () => {
    const orPolicy: PolicyRecord = {
      id: "policy-or-test",
      priority: 5,
      conditions: {
        operator: "OR",
        rules: [
          { field: "total_amount", operator: "gte", value: 10000 },
          { field: "requester_role", operator: "eq", value: "finance" },
        ],
      },
      actions: {
        steps: [
          {
            step_number: 1,
            label: "Special Review",
            assignee_type: "role",
            assignee_value: "admin",
            requires_all: false,
            timeout_hours: null,
          },
        ],
      },
    };

    // Matches via requester_role = finance, even though amount < 10000
    const ctx = { ...defaultCtx, totalAmount: 100, requesterRole: "finance" };
    const result = buildApprovalChain([orPolicy], ctx);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Special Review");

    // Does not match if neither condition is true
    const ctx2 = { ...defaultCtx, totalAmount: 100, requesterRole: "requester" };
    const result2 = buildApprovalChain([orPolicy], ctx2);
    expect(result2).toHaveLength(0);
  });

  it("evaluates nested AND/OR conditions correctly", () => {
    const nestedPolicy: PolicyRecord = {
      id: "policy-nested",
      priority: 5,
      conditions: {
        operator: "AND",
        rules: [
          { field: "total_amount", operator: "gte", value: 500 },
          {
            operator: "OR",
            rules: [
              { field: "vendor_is_new", operator: "eq", value: "true" },
              { field: "requester_role", operator: "eq", value: "finance" },
            ],
          },
        ],
      },
      actions: {
        steps: [
          {
            step_number: 1,
            label: "Nested Review",
            assignee_type: "role",
            assignee_value: "admin",
            requires_all: false,
            timeout_hours: null,
          },
        ],
      },
    };

    // Matches: amount >= 500 AND (vendor_is_new = true)
    const ctx = { ...defaultCtx, totalAmount: 600, vendorIsNew: true };
    expect(buildApprovalChain([nestedPolicy], ctx)).toHaveLength(1);

    // Matches: amount >= 500 AND (requester_role = finance)
    const ctx2 = { ...defaultCtx, totalAmount: 600, requesterRole: "finance" };
    expect(buildApprovalChain([nestedPolicy], ctx2)).toHaveLength(1);

    // Does not match: amount >= 500 but neither OR branch is true
    const ctx3 = { ...defaultCtx, totalAmount: 600, vendorIsNew: false, requesterRole: "requester" };
    expect(buildApprovalChain([nestedPolicy], ctx3)).toHaveLength(0);

    // Does not match: both OR branches true but amount < 500
    const ctx4 = { ...defaultCtx, totalAmount: 400, vendorIsNew: true };
    expect(buildApprovalChain([nestedPolicy], ctx4)).toHaveLength(0);
  });

  it("handles priority conflict: lower number wins step_number collision", () => {
    const p1: PolicyRecord = {
      id: "high-priority",
      priority: 5,
      conditions: { operator: "AND", rules: [{ field: "total_amount", operator: "gte", value: 100 }] },
      actions: { steps: [{ step_number: 1, label: "High Priority Step", assignee_type: "role", assignee_value: "admin", requires_all: false, timeout_hours: null }] },
    };
    const p2: PolicyRecord = {
      id: "low-priority",
      priority: 50,
      conditions: { operator: "AND", rules: [{ field: "total_amount", operator: "gte", value: 100 }] },
      actions: { steps: [{ step_number: 1, label: "Low Priority Step", assignee_type: "role", assignee_value: "finance", requires_all: false, timeout_hours: null }] },
    };

    const ctx = { ...defaultCtx, totalAmount: 200 };
    const result = buildApprovalChain([p2, p1], ctx); // intentionally pass low first
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("High Priority Step"); // priority 5 wins
  });

  it("handles `in` operator for department matching", () => {
    const policy: PolicyRecord = {
      id: "policy-dept-in",
      priority: 5,
      conditions: {
        operator: "AND",
        rules: [{ field: "department_id", operator: "in", value: [ENG_DEPT_ID, FIN_DEPT_ID] }],
      },
      actions: {
        steps: [{ step_number: 1, label: "Dept Review", assignee_type: "role", assignee_value: "admin", requires_all: false, timeout_hours: null }],
      },
    };

    expect(buildApprovalChain([policy], { ...defaultCtx, departmentId: ENG_DEPT_ID })).toHaveLength(1);
    expect(buildApprovalChain([policy], { ...defaultCtx, departmentId: FIN_DEPT_ID })).toHaveLength(1);
    expect(buildApprovalChain([policy], { ...defaultCtx, departmentId: "other-dept" })).toHaveLength(0);
  });

  it("returns steps in ascending step_number order regardless of input order", () => {
    const result = buildApprovalChain(defaultPolicies, { ...defaultCtx, totalAmount: 6000 });
    const stepNumbers = result.map((s) => s.stepNumber);
    const sorted = [...stepNumbers].sort((a, b) => a - b);
    expect(stepNumbers).toEqual(sorted);
  });

  it("preserves policy ID on each step for traceability", () => {
    const ctx = { ...defaultCtx, totalAmount: 600 };
    const result = buildApprovalChain(defaultPolicies, ctx);
    expect(result[0].policyId).toBe("policy-manager-approval");
  });
});

describe("previewApprovalChain", () => {
  it("returns matched policy IDs and steps", () => {
    const ctx = { ...defaultCtx, totalAmount: 6000, vendorIsNew: true };
    const { matchedPolicyIds, steps } = previewApprovalChain(defaultPolicies, ctx);
    expect(matchedPolicyIds).toContain("policy-manager-approval");
    expect(matchedPolicyIds).toContain("policy-finance-exec");
    expect(matchedPolicyIds).toContain("policy-new-vendor");
    expect(steps.length).toBeGreaterThan(0);
  });

  it("returns empty arrays when no policies match", () => {
    const ctx = { ...defaultCtx, totalAmount: 50 };
    const { matchedPolicyIds, steps } = previewApprovalChain(defaultPolicies, ctx);
    expect(matchedPolicyIds).toHaveLength(0);
    expect(steps).toHaveLength(0);
  });
});
