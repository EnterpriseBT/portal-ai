import type { RevalidationMetadata } from "@portalai/core/models";

import { JobLockService } from "./job-lock.service.js";
import { ApiError } from "./http.service.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "revalidation-service" });

export class RevalidationService {
  /**
   * Enqueue a revalidation job for the given connector entity (#769: through
   * `JobLockService.enqueueExclusive`). Refused with `409
   * ENTITY_LOCKED_BY_JOB` while another job holds the entity or its
   * connector; a revalidation already running on it is returned instead.
   */
  static async enqueue(
    connectorEntityId: string,
    organizationId: string,
    userId: string
  ) {
    const metadata: RevalidationMetadata = {
      connectorEntityId,
      organizationId,
    };

    const job = await JobLockService.enqueueExclusive(
      userId,
      {
        type: "revalidation",
        organizationId,
        metadata: metadata as Record<string, unknown>,
      },
      { onSameJob: "reuse" }
    );

    logger.info(
      { connectorEntityId, jobId: job.id },
      "Revalidation job enqueued (or already running)"
    );

    return job;
  }

  /**
   * #769: queue a revalidation after an edit that changes what it computes
   * (a field mapping or column definition), once that edit has committed.
   * A job holding the entity by then is not an error for the edit: it's
   * logged, and the running job (or the user's next Re-validate All) covers
   * it.
   */
  static async enqueueAfterEdit(
    connectorEntityId: string,
    organizationId: string,
    userId: string
  ): Promise<void> {
    try {
      await RevalidationService.enqueue(
        connectorEntityId,
        organizationId,
        userId
      );
    } catch (error) {
      logger.warn(
        {
          connectorEntityId,
          code: error instanceof ApiError ? error.code : undefined,
          error: error instanceof Error ? error.message : String(error),
        },
        "Revalidation after an edit was not queued"
      );
    }
  }
}
