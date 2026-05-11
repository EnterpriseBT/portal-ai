import type { TypedJobProcessor } from "../jobs.worker.js";
import { LayoutPlanDraftService } from "../../services/layout-plan-draft.service.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "layout-plan-commit-processor" });

/**
 * Processor for `layout_plan_commit` jobs.
 *
 * Both HTTP commit endpoints (`POST /api/layout-plans/commit` for draft
 * commit, `POST /api/connector-instances/:id/layout-plan/:planId/commit`
 * for recommit) enqueue this processor after synchronous validation
 * and (draft only) UUID minting. Dispatches by `metadata.kind`:
 *
 *   - `draft`    — `LayoutPlanDraftService.runCommitDraft` owns every
 *                  DB write: creates the connector_instance row (when
 *                  not `isExistingInstance`), creates the plan row,
 *                  runs the records-write pipeline, and rolls back
 *                  on failure so a half-created connector is never
 *                  visible.
 *   - `recommit` — `LayoutPlanDraftService.runRecommit` resolves the
 *                  cached workbook and re-runs the existing commit
 *                  pipeline against the existing instance + plan.
 *
 * The worker's job lifecycle (active/completed/failed transitions and
 * progress events) is owned by `jobs.worker.ts`; on success the
 * returned `LayoutPlanCommitJobResult` is stored on the job row and
 * broadcast via Redis Pub/Sub → SSE to the awaiting frontend.
 */
export const layoutPlanCommitProcessor: TypedJobProcessor<
  "layout_plan_commit"
> = async (bullJob) => {
  const metadata = bullJob.data;
  const { jobId, kind, connectorInstanceId, planId, organizationId } = metadata;

  logger.info(
    { jobId, kind, connectorInstanceId, planId, organizationId },
    "layout_plan_commit started"
  );

  // Forward write-phase progress to Bull so the SSE stream (and the
  // job list + detail views) advance mid-flight. The service throttles
  // to 5-point buckets so a ~400-chunk write fires ~15 events.
  const onProgress = (percent: number) => {
    void bullJob.updateProgress(percent);
  };
  const result =
    metadata.kind === "draft"
      ? await LayoutPlanDraftService.runCommitDraft(metadata, onProgress)
      : await LayoutPlanDraftService.runRecommit(metadata, onProgress);

  logger.info(
    {
      jobId,
      kind,
      connectorInstanceId,
      planId,
      connectorEntityCount: result.connectorEntityIds.length,
      recordCounts: result.recordCounts,
    },
    "layout_plan_commit completed"
  );

  return result;
};
