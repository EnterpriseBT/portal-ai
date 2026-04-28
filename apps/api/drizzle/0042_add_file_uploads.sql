-- file_uploads audit + state for the presigned-URL streaming pipeline
-- (see docs/LARGE_WORKBOOK_STREAMING.plan.md §Phase 0).

CREATE TABLE IF NOT EXISTS "file_uploads" (
  "id" text PRIMARY KEY NOT NULL,
  "created" bigint NOT NULL,
  "created_by" text NOT NULL,
  "updated" bigint,
  "updated_by" text,
  "deleted" bigint,
  "deleted_by" text,
  "organization_id" text NOT NULL,
  "filename" text NOT NULL,
  "content_type" text,
  "size_bytes" bigint,
  "s3_key" text NOT NULL,
  "status" text NOT NULL,
  "upload_session_id" text,
  CONSTRAINT "file_uploads_s3_key_unique" UNIQUE ("s3_key"),
  CONSTRAINT "file_uploads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "file_uploads_by_org_idx" ON "file_uploads" ("organization_id");
CREATE INDEX IF NOT EXISTS "file_uploads_by_session_idx" ON "file_uploads" ("upload_session_id");
CREATE INDEX IF NOT EXISTS "file_uploads_by_status_idx" ON "file_uploads" ("status");
