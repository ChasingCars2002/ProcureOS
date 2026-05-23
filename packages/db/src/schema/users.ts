import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { departments } from "./departments.js";

export const userRoleEnum = pgEnum("user_role", [
  "requester",
  "approver",
  "finance",
  "admin",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  avatarUrl: text("avatar_url"),
  role: userRoleEnum("role").notNull().default("requester"),
  departmentId: uuid("department_id").references(() => departments.id, {
    onDelete: "set null",
  }),
  managerId: uuid("manager_id"),
  isActive: boolean("is_active").notNull().default(true),
  ssoProvider: text("sso_provider"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const usersRelations = relations(users, ({ one, many }) => ({
  department: one(departments, {
    fields: [users.departmentId],
    references: [departments.id],
  }),
  manager: one(users, {
    fields: [users.managerId],
    references: [users.id],
    relationName: "manager",
  }),
  reports: many(users, { relationName: "manager" }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserRole = (typeof userRoleEnum.enumValues)[number];
