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
  "system_check",
  "revalidation",
  "entity_record_clear",
  "connector_sync",
  "file_upload_parse",
  "layout_plan_commit",
  "bulk_transform",
  "bulk_geocode",
  "sql_query",
  "dissolve_precompute",
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
  // Structured progress (#458): cumulative records processed + the known
  // total (null = genuinely unknown). NULL for jobs that never report one.
  // `progress` stays the coarse percent; surfaces prefer this when present.
  progressDetail: jsonb("progress_detail").$type<{
    processed: number;
    total: number | null;
  }>(),
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
  // Executions lost to process death and silently re-delivered by BullMQ
  // (#464). BullMQ does not increment `attempts` on a stall re-delivery, so a
  // job that ran twice would otherwise read `attempts: 1` with no other trace
  // an execution was redone. The resuming execution detects a still-`active`
  // row at its start and increments this.
  lostExecutions: integer("lost_executions").notNull().default(0),
});
