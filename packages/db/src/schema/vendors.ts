import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users.js";

export const vendors = pgTable("vendors", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ein: text("ein"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  paymentTerms: text("payment_terms"),
  isNew: boolean("is_new").notNull().default(true),
  complianceReviewed: boolean("compliance_reviewed").notNull().default(false),
  complianceReviewedBy: uuid("compliance_reviewed_by").references(
    () => users.id,
    { onDelete: "set null" }
  ),
  complianceReviewedAt: timestamp("compliance_reviewed_at", {
    withTimezone: true,
  }),
  preferredErpVendorId: text("preferred_erp_vendor_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const vendorsRelations = relations(vendors, ({ one }) => ({
  complianceReviewer: one(users, {
    fields: [vendors.complianceReviewedBy],
    references: [users.id],
  }),
}));

export type Vendor = typeof vendors.$inferSelect;
export type NewVendor = typeof vendors.$inferInsert;
