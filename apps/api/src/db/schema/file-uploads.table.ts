import { bigint, index, pgTable, text } from "drizzle-orm/pg-core";

import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

/**
 * Audit + state row for a single presigned-upload lifecycle.
 *
 * State machine (enforced at the service layer):
 *
 *   pending   — created by /presign; bytes not yet in S3
 *   uploaded  — client finished PUT + called /confirm; HEAD verified
 *   parsed    — /parse streamed from S3, workbook cached in Redis,
 *               row is linked to an `uploadSessionId`
 *   committed — /layout-plans/commit succeeded; S3 object deleted
 *   failed    — upload abandoned or parse/commit errored; swept later
 *
 * See `docs/LARGE_WORKBOOK_STREAMING.plan.md` §Phase 0 for the full design.
 */
export const fileUploads = pgTable(
  "file_uploads",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    filename: text("filename").notNull(),
    contentType: text("content_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    s3Key: text("s3_key").notNull().unique(),
    status: text("status").notNull(),
    /** Ties this upload into a parse session shared with other uploads in the same batch. */
    uploadSessionId: text("upload_session_id"),
  },
  (table) => [
    index("file_uploads_by_org_idx").on(table.organizationId),
    index("file_uploads_by_session_idx").on(table.uploadSessionId),
    index("file_uploads_by_status_idx").on(table.status),
  ]
);
