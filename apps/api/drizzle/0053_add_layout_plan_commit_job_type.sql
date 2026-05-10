-- Add `layout_plan_commit` to the `job_type` postgres enum so the two
-- HTTP commit endpoints (POST /api/layout-plans/commit for draft commit,
-- POST /api/connector-instances/:id/layout-plan/:planId/commit for
-- recommit) can enqueue commit work to the shared async-jobs queue. On
-- ~400k-row uploads the synchronous commit could take long enough to
-- race the ALB 180 s idle timeout and leave the user staring at a
-- spinner with no progress signal.
--
-- Both endpoints validate inputs synchronously, mint UUIDs (draft path
-- only), enqueue the job, and return 202 with `{ connectorInstanceId,
-- planId, jobId, status: "pending" }`. The worker owns every DB write
-- — it creates the connector_instance + plan rows for fresh draft
-- commits and rolls them back on failure, so the request never leaves
-- behind orphan rows.
--
-- Completion is broadcast over the existing `/api/sse/jobs/:id/events`
-- stream the file_upload_parse + connector_sync flows already use.

ALTER TYPE "job_type" ADD VALUE 'layout_plan_commit';
