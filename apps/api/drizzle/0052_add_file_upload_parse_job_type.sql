-- Add `file_upload_parse` to the `job_type` postgres enum so the
-- file-upload pipeline can enqueue parse work to the shared async-jobs
-- queue. See docs/LARGE_FILE_PARSE_STREAMING.plan.md §Phase 3 — the
-- HTTP route mints the uploadSessionId + the job, returns 202
-- immediately, and the worker drives the streaming parse straight
-- into the chunked Redis cache. Completion is broadcast over the
-- existing `/api/sse/jobs/:id/events` stream the connector_sync flow
-- already uses.

ALTER TYPE "job_type" ADD VALUE 'file_upload_parse';
