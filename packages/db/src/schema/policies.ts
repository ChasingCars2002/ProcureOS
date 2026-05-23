import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { z } from "zod";
import { users } from "./users.js";

// ─── Zod schemas for the JSONB condition/action blobs ──────────────────────

const conditionRuleSchema = z.object({
  field: z.enum([
    "total_amount",
    "department_id",
    "vendor_is_new",
    "requester_role",
  ]),
  operator: z.enum(["gt", "gte", "lt", "lte", "eq", "neq", "in", "not_in"]),
  value: z.union([z.number(), z.string(), z.array(z.string())]),
});

type ConditionRule = z.infer<typeof conditionRuleSchema>;

interface ConditionGroup {
  operator: "AND" | "OR";
  rules: Array<ConditionRule | ConditionGroup>;
}

const conditionGroupSchema: z.ZodType<ConditionGroup> = z.lazy(() =>
  z.object({
    operator: z.enum(["AND", "OR"]),
    rules: z.array(z.union([conditionRuleSchema, conditionGroupSchema])),
  })
);

const approvalStepSchema = z.object({
  step_number: z.number().int().positive(),
  label: z.string().min(1),
  assignee_type: z.enum(["role", "user", "department_budget_owner"]),
  assignee_value: z.string(),
  requires_all: z.boolean().default(false),
  timeout_hours: z.number().nullable().default(null),
});

const policyActionsSchema = z.object({
  steps: z.array(approvalStepSchema).min(1),
});

export const policyConditionsSchema = conditionGroupSchema;
export const policyActionsZodSchema = policyActionsSchema;

export type PolicyConditions = ConditionGroup;
export type PolicyActions = z.infer<typeof policyActionsSchema>;
export type ApprovalStepConfig = z.infer<typeof approvalStepSchema>;
export type ConditionRuleType = ConditionRule;

// ─── Drizzle table ─────────────────────────────────────────────────────────

export const approvalPolicies = pgTable("approval_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  priority: integer("priority").notNull(),
  conditions: jsonb("conditions").notNull().$type<PolicyConditions>(),
  actions: jsonb("actions").notNull().$type<PolicyActions>(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const approvalPoliciesRelations = relations(
  approvalPolicies,
  ({ one }) => ({
    creator: one(users, {
      fields: [approvalPolicies.createdBy],
      references: [users.id],
    }),
  })
);

export type ApprovalPolicy = typeof approvalPolicies.$inferSelect;
export type NewApprovalPolicy = typeof approvalPolicies.$inferInsert;
