import {
  pgTable,
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  budgetOwnerId: uuid("budget_owner_id"),
  costCenterCode: text("cost_center_code"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const departmentsRelations = relations(departments, ({ one }) => ({
  budgetOwner: one(departments, {
    fields: [departments.budgetOwnerId],
    references: [departments.id],
    relationName: "budget_owner",
  }),
}));

export type Department = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;
