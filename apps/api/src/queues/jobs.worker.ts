import { Worker, Job as BullJob } from "bullmq";

import type { JobType, JobTypeMap } from "@portalai/core/models";
import { classifyBatchOutcome } from "@portalai/core/models";

import { environment } from "../environment.js";
import { createLogger } from "../utils/logger.util.js";
import { JOBS_QUEUE_NAME } from "./jobs.queue.js";

const logger = createLogger({ module: "jobs-worker" });

/** Untyped processor — accepts any BullMQ job. Used by the registry map. */
export type JobProcessor = (job: BullJob) => Promise<unknown>;

/**
 * Build a failure message that surfaces the actual root cause.
 *
 * Drizzle wraps postgres errors so that `.message` only contains the
 * failed SQL + bound params — not the reason. The underlying postgres
 * error (e.g. "duplicate key value violates unique constraint") lives
 * on `.cause`. We walk the cause chain and prefer postgres's `detail` /
 * `code` / `message` fields when present, falling back to the wrapper
 * message on plain errors.
 */
function formatJobError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  let cursor: unknown = err;
  let depth = 0;
  while (cursor instanceof Error && depth < 5) {
    const causeCandidate = (cursor as { cause?: unknown }).cause;
    if (causeCandidate instanceof Error) {
      cursor = causeCandidate;
      depth++;
      continue;
    }
    break;
  }

  const root = cursor instanceof Error ? cursor : err;
  const pg = root as Error & {
    code?: string;
    detail?: string;
    constraint_name?: string;
    table_name?: string;
  };

  const parts: string[] = [];
  if (pg.message) parts.push(pg.message);
  if (pg.detail) parts.push(`detail: ${pg.detail}`);
  if (pg.code) parts.push(`code: ${pg.code}`);
  if (pg.constraint_name) parts.push(`constraint: ${pg.constraint_name}`);
  return parts.join(" | ");
}

/** BullMQ job data shape for a given job type (jobId + type + typed metadata). */
export type JobData<T extends JobType = JobType> = {
  jobId: string;
  type: T;
} & JobTypeMap[T]["metadata"];

/** Typed processor — constrains both input data and return type per job type. */
export type TypedJobProcessor<T extends JobType> = (
  job: BullJob<JobData<T>, JobTypeMap[T]["result"]>
) => Promise<JobTypeMap[T]["result"]>;

/**
 * Lazily import JobEventsService to avoid circular dependency
 * and allow the service to be created in a separate step.
 */
const getJobEventsService = async () => {
  const { JobEventsService } =
    await import("../services/job-events.service.js");
  return JobEventsService;
};

/**
 * Best-effort terminal-status hook for `bulk_transform` jobs (#85
 * Phase 2 slice 3). Persists the synthetic assistant message + emits
 * the portal-events SSE. Failures are logged but do not bubble — the
 * job's primary result is already persisted.
 */
/**
 * The `error` message for a batch job classified as failed (#410).
 *
 * Nothing threw — every item failed inside its own try/catch — so there is no
 * exception to format. Without a message the job row reads `failed` with an
 * empty reason, which is its own debugging dead end. Points at
 * `partialFailures`, which carries the per-row cause.
 */
function totalFailureMessage(result: unknown): string {
  const failed = (result as { recordsFailed?: unknown } | null)?.recordsFailed;
  const count = typeof failed === "number" ? failed : 0;
  return `Every record failed (${count} of ${count}). See partialFailures in the job result for the per-row reason.`;
}

async function runBulkTransformTerminalHook(
  jobId: string,
  data: JobData<"bulk_transform">,
  result: JobTypeMap["bulk_transform"]["result"] | null,
  status: "completed" | "failed" | "cancelled",
  errorMessage?: string
): Promise<void> {
  const portalId = (data as unknown as { portalId?: string }).portalId;
  if (!portalId) {
    logger.warn(
      { jobId },
      "bulk_transform terminal hook: missing portalId in metadata"
    );
    return;
  }
  try {
    const { PortalService } = await import("../services/portal.service.js");
    await PortalService.notifyJobTerminal(portalId, jobId, {
      status,
      recordsProcessed: result?.recordsProcessed ?? 0,
      recordsFailed: result?.recordsFailed ?? 0,
      durationMs: result?.durationMs ?? 0,
      partialFailures: result?.partialFailures?.map((f) => ({
        sourceKey: f.sourceKey,
        error: f.error as Record<string, unknown>,
      })),
      errorMessage,
    });
  } catch (err) {
    logger.error(
      { jobId, portalId, err },
      "bulk_transform terminal hook failed"
    );
  }
}

export const createJobsWorker = (
  processors: Record<string, JobProcessor>
): Worker => {
  const worker = new Worker(
    JOBS_QUEUE_NAME,
    async (bullJob) => {
      const { jobId, type } = bullJob.data;
      const processor = processors[type];
      if (!processor) {
        throw new Error(`No processor registered for job type: ${type}`);
      }

      const JobEventsService = await getJobEventsService();

      await JobEventsService.transition(jobId, "active", { progress: 0 });
      try {
        const result = await processor(bullJob);
        // #410: a batch job whose every item failed must not report
        // `completed`. Every item's work sits inside a per-item try/catch, so
        // reaching here only means the loop did not throw — a total provider
        // outage looked identical to complete success, which is how app-dev's
        // geocoding stayed broken with nobody noticing.
        //
        // The classifier reads the result's shape, so the seven all-or-nothing
        // job types are unaffected and a future batch type is covered without
        // registering anything here.
        const outcome = classifyBatchOutcome(result);
        await JobEventsService.transition(jobId, outcome, {
          progress: 100,
          // The result is persisted on BOTH outcomes: a failed batch's
          // `partialFailures` is the only record of WHY each row failed, and
          // the job-details view renders on the result's presence rather than
          // on status, so it survives.
          result: result as Record<string, unknown>,
          // Nothing threw, so there is no error to format — synthesize one, or
          // the job reads as failed with no stated reason.
          ...(outcome === "failed"
            ? { error: totalFailureMessage(result) }
            : {}),
        });
        // Terminal hook: bulk_transform jobs notify their portal so
        // the chat-input lock can release + the assistant message
        // lands (#85 Phase 2 slice 3). Best-effort; we don't fail the
        // job if notification fails (the result is already persisted).
        if (type === "bulk_transform") {
          await runBulkTransformTerminalHook(
            jobId,
            bullJob.data as JobData<"bulk_transform">,
            result as JobTypeMap["bulk_transform"]["result"],
            // Classified, not hardcoded: the hook drives the portal's
            // chat-input lock release and the assistant message, so telling it
            // `completed` while the job row says `failed` would put the two
            // surfaces in disagreement.
            outcome
          );
        }
        return result;
      } catch (err) {
        const message = formatJobError(err);
        logger.error({ jobId, err }, "Job failed");
        await JobEventsService.transition(jobId, "failed", { error: message });
        if (type === "bulk_transform") {
          await runBulkTransformTerminalHook(
            jobId,
            bullJob.data as JobData<"bulk_transform">,
            null,
            "failed",
            message
          );
        }
        throw err;
      }
    },
    {
      connection: {
        url: environment.REDIS_URL,
        maxRetriesPerRequest: null,
      },
      // Capped at 2 to bound concurrent memory pressure from streaming XLSX /
      // CSV parsers (each holds an exceljs sharedStrings cache for the
      // duration of a workbook). All job types share this worker; cranking
      // back up requires separate workers per type.
      concurrency: 2,
    }
  );

  // Forward BullMQ progress events
  worker.on("progress", async (bullJob, progress) => {
    if (typeof progress === "number") {
      const JobEventsService = await getJobEventsService();
      await JobEventsService.updateProgress(bullJob.data.jobId, progress);
    }
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.data?.jobId, err }, "Job failed");
  });

  worker.on("completed", (job) => {
    logger.info({ jobId: job?.data?.jobId }, "Job completed");
  });

  return worker;
};
