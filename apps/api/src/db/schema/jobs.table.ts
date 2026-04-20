import {
  bigint,
  integer,
  jsonb,
  pgTable,
  text,
  pgEnum,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";

export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "active",
  "completed",
  "failed",
  "stalled",
  "cancelled",
  "awaiting_confirmation",
]);

export const jobTypeEnum = pgEnum("job_type", [
  "file_upload",
  "system_check",
  "revalidation",
]);

/**
 * Jobs table.
 * Each row represents an async background job tracked by the system
 * and processed via BullMQ.
 */
export const jobs = pgTable("jobs", {
  ...baseColumns,
  organizationId: text("organization_id").notNull(),
  type: jobTypeEnum("type").notNull(),
  status: jobStatusEnum("status").notNull().default("pending"),
  progress: integer("progress").notNull().default(0),
  metadata: jsonb("metadata")
    .notNull()
    .default({})
    .$type<Record<string, unknown>>(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  error: text("error"),
  startedAt: bigint("started_at", { mode: "number" }),
  completedAt: bigint("completed_at", { mode: "number" }),
  bullJobId: text("bull_job_id"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
});
