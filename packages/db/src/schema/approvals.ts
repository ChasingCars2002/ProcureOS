import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  unique,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { purchaseRequests } from "./requests.js";
import { approvalPolicies } from "./policies.js";
import { users } from "./users.js";

export const approvalStepStatusEnum = pgEnum("approval_step_status", [
  "pending",
  "approved",
  "rejected",
  "skipped",
]);

export const approvalDecisionEnum = pgEnum("approval_decision", [
  "pending",
  "approved",
  "rejected",
]);

export const approvalSteps = pgTable(
  "approval_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => purchaseRequests.id, { onDelete: "cascade" }),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => approvalPolicies.id),
    stepNumber: integer("step_number").notNull(),
    label: text("label").notNull(),
    status: approvalStepStatusEnum("status").notNull().default("pending"),
    requiresAll: boolean("requires_all").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    uniqueRequestStep: unique().on(table.requestId, table.stepNumber),
  })
);

export const approvalAssignments = pgTable("approval_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  stepId: uuid("step_id")
    .notNull()
    .references(() => approvalSteps.id, { onDelete: "cascade" }),
  assigneeId: uuid("assignee_id")
    .notNull()
    .references(() => users.id),
  decision: approvalDecisionEnum("decision").notNull().default("pending"),
  comment: text("comment"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
});

export const approvalStepsRelations = relations(
  approvalSteps,
  ({ one, many }) => ({
    request: one(purchaseRequests, {
      fields: [approvalSteps.requestId],
      references: [purchaseRequests.id],
    }),
    policy: one(approvalPolicies, {
      fields: [approvalSteps.policyId],
      references: [approvalPolicies.id],
    }),
    assignments: many(approvalAssignments),
  })
);

export const approvalAssignmentsRelations = relations(
  approvalAssignments,
  ({ one }) => ({
    step: one(approvalSteps, {
      fields: [approvalAssignments.stepId],
      references: [approvalSteps.id],
    }),
    assignee: one(users, {
      fields: [approvalAssignments.assigneeId],
      references: [users.id],
    }),
  })
);

export type ApprovalStep = typeof approvalSteps.$inferSelect;
export type NewApprovalStep = typeof approvalSteps.$inferInsert;
export type ApprovalAssignment = typeof approvalAssignments.$inferSelect;
export type NewApprovalAssignment = typeof approvalAssignments.$inferInsert;
export type ApprovalDecision =
  (typeof approvalDecisionEnum.enumValues)[number];
