import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  boolean,
  date,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { users } from "./users.js";
import { departments } from "./departments.js";
import { vendors } from "./vendors.js";

export const requestStatusEnum = pgEnum("request_status", [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "cancelled",
  "ordered",
  "received",
]);

export const purchaseRequests = pgTable("purchase_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestNumber: text("request_number").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  status: requestStatusEnum("status").notNull().default("draft"),
  requesterId: uuid("requester_id")
    .notNull()
    .references(() => users.id),
  departmentId: uuid("department_id")
    .notNull()
    .references(() => departments.id),
  vendorId: uuid("vendor_id").references(() => vendors.id, {
    onDelete: "set null",
  }),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  currency: text("currency").notNull().default("USD"),
  neededByDate: date("needed_by_date"),
  businessJustification: text("business_justification"),
  currentApprovalStep: integer("current_approval_step").notNull().default(1),
  erpExported: boolean("erp_exported").notNull().default(false),
  erpExportReference: text("erp_export_reference"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const lineItems = pgTable("line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id")
    .notNull()
    .references(() => purchaseRequests.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  glAccountCode: text("gl_account_code"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const purchaseRequestsRelations = relations(
  purchaseRequests,
  ({ one, many }) => ({
    requester: one(users, {
      fields: [purchaseRequests.requesterId],
      references: [users.id],
    }),
    department: one(departments, {
      fields: [purchaseRequests.departmentId],
      references: [departments.id],
    }),
    vendor: one(vendors, {
      fields: [purchaseRequests.vendorId],
      references: [vendors.id],
    }),
    lineItems: many(lineItems),
  })
);

export const lineItemsRelations = relations(lineItems, ({ one }) => ({
  request: one(purchaseRequests, {
    fields: [lineItems.requestId],
    references: [purchaseRequests.id],
  }),
}));

export type PurchaseRequest = typeof purchaseRequests.$inferSelect;
export type NewPurchaseRequest = typeof purchaseRequests.$inferInsert;
export type RequestStatus = (typeof requestStatusEnum.enumValues)[number];
export type LineItem = typeof lineItems.$inferSelect;
export type NewLineItem = typeof lineItems.$inferInsert;
