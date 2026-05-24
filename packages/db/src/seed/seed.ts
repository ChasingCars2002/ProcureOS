import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../client.js";
import {
  departments,
  users,
  vendors,
  approvalPolicies,
  type PolicyConditions,
  type PolicyActions,
} from "../schema/index.js";

async function seed() {
  console.log("Seeding FlowProcure database...");

  // ─── Departments ──────────────────────────────────────────────────────────
  const [engineering, finance, operations, marketing] = await db
    .insert(departments)
    .values([
      { name: "Engineering", costCenterCode: "CC-ENG-001" },
      { name: "Finance", costCenterCode: "CC-FIN-001" },
      { name: "Operations", costCenterCode: "CC-OPS-001" },
      { name: "Marketing", costCenterCode: "CC-MKT-001" },
    ])
    .returning();

  console.log("Created departments:", [engineering, finance, operations, marketing].map(d => d.name));

  // ─── Users ────────────────────────────────────────────────────────────────
  const [admin, financeUser, cto, manager1, requester1] = await db
    .insert(users)
    .values([
      {
        email: "admin@flowprocure.dev",
        fullName: "Alex Admin",
        role: "admin",
        departmentId: finance.id,
      },
      {
        email: "finance@flowprocure.dev",
        fullName: "Fiona Finance",
        role: "finance",
        departmentId: finance.id,
      },
      {
        email: "cto@flowprocure.dev",
        fullName: "Chris CTO",
        role: "approver",
        departmentId: engineering.id,
      },
      {
        email: "manager@flowprocure.dev",
        fullName: "Morgan Manager",
        role: "approver",
        departmentId: operations.id,
      },
      {
        email: "requester@flowprocure.dev",
        fullName: "Riley Requester",
        role: "requester",
        departmentId: engineering.id,
      },
    ])
    .returning();

  // Set budget owners for departments
  await db.update(departments).set({ budgetOwnerId: cto.id }).where(eq(departments.id, engineering.id));
  await db.update(departments).set({ budgetOwnerId: financeUser.id }).where(eq(departments.id, finance.id));
  await db.update(departments).set({ budgetOwnerId: manager1.id }).where(eq(departments.id, operations.id));

  console.log("Created users:", [admin, financeUser, cto, manager1, requester1].map(u => u.email));

  // ─── Vendors ──────────────────────────────────────────────────────────────
  await db.insert(vendors).values([
    {
      name: "Acme Office Supplies",
      contactEmail: "orders@acme.example",
      paymentTerms: "NET30",
      isNew: false,
      complianceReviewed: true,
      complianceReviewedBy: financeUser.id,
      complianceReviewedAt: new Date(),
    },
    {
      name: "TechGear Pro",
      contactEmail: "sales@techgear.example",
      paymentTerms: "NET60",
      isNew: false,
      complianceReviewed: true,
      complianceReviewedBy: financeUser.id,
      complianceReviewedAt: new Date(),
    },
    {
      name: "NewVendor Corp",
      contactEmail: "billing@newvendor.example",
      paymentTerms: "NET30",
      isNew: true,
      complianceReviewed: false,
    },
  ]);

  console.log("Created 3 vendors");

  // ─── Approval Policies ────────────────────────────────────────────────────
  const policies: Array<{
    name: string;
    description: string;
    priority: number;
    conditions: PolicyConditions;
    actions: PolicyActions;
  }> = [
    {
      name: "Manager Approval (>$500)",
      description: "Requests over $500 require department budget owner approval",
      priority: 10,
      conditions: {
        operator: "AND",
        rules: [
          { field: "total_amount", operator: "gte", value: 500 },
        ],
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
      name: "Finance + Executive Approval (>$5,000)",
      description: "Requests over $5,000 require finance review and executive sign-off",
      priority: 20,
      conditions: {
        operator: "AND",
        rules: [
          { field: "total_amount", operator: "gte", value: 5000 },
        ],
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
      name: "New Vendor Compliance Review",
      description: "All requests with new vendors require a compliance review",
      priority: 30,
      conditions: {
        operator: "AND",
        rules: [
          { field: "vendor_is_new", operator: "eq", value: "true" },
        ],
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
      name: "Engineering CTO Routing",
      description: "Engineering department spend auto-routes to CTO for approval",
      priority: 40,
      conditions: {
        operator: "AND",
        rules: [
          { field: "department_id", operator: "eq", value: engineering.id },
          { field: "total_amount", operator: "gte", value: 500 },
        ],
      },
      actions: {
        steps: [
          {
            step_number: 1,
            label: "CTO Approval",
            assignee_type: "user",
            assignee_value: cto.id,
            requires_all: false,
            timeout_hours: 48,
          },
        ],
      },
    },
  ];

  await db.insert(approvalPolicies).values(
    policies.map((p) => ({ ...p, createdBy: admin.id }))
  );

  console.log(`Created ${policies.length} approval policies`);
  console.log("Seed complete.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
