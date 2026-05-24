import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { purchaseRequests } from "./requests.js";

export const erpSystemEnum = pgEnum("erp_system", [
  "quickbooks",
  "netsuite",
]);

export const erpOperationEnum = pgEnum("erp_operation", [
  "export_po",
  "sync_vendor",
  "sync_payment",
]);

export const erpSyncStatusEnum = pgEnum("erp_sync_status", [
  "queued",
  "processing",
  "success",
  "failed",
  "retrying",
]);

export type ErpAttemptLog = {
  attempt: number;
  timestamp: string;
  error: string;
  errorCode: string;
  durationMs: number;
};

export const erpSyncJobs = pgTable("erp_sync_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id")
    .notNull()
    .references(() => purchaseRequests.id),
  erpSystem: erpSystemEnum("erp_system").notNull(),
  operation: erpOperationEnum("operation").notNull().default("export_po"),
  status: erpSyncStatusEnum("status").notNull().default("queued"),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  errorLog: jsonb("error_log").notNull().default([]).$type<ErpAttemptLog[]>(),
  payload: jsonb("payload").notNull().default({}),
  result: jsonb("result"),
  pgBossJobId: text("pg_boss_job_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const erpSyncJobsRelations = relations(erpSyncJobs, ({ one }) => ({
  request: one(purchaseRequests, {
    fields: [erpSyncJobs.requestId],
    references: [purchaseRequests.id],
  }),
}));

export type ErpSyncJob = typeof erpSyncJobs.$inferSelect;
export type NewErpSyncJob = typeof erpSyncJobs.$inferInsert;
export type ErpSystem = (typeof erpSystemEnum.enumValues)[number];
export type ErpSyncStatus = (typeof erpSyncStatusEnum.enumValues)[number];
