import { and, eq, inArray } from "drizzle-orm";

import type { RevalidationMetadata } from "@portalai/core/models";

import { DbService } from "./db.service.js";
import { JobLockService } from "./job-lock.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { jobs } from "../db/schema/index.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "revalidation-service" });

/** Non-terminal statuses that indicate a revalidation job is still running. */
const ACTIVE_STATUSES = ["pending", "active"] as const;

export class RevalidationService {
  /**
   * Check whether there is an active revalidation job for the given connector entity.
   * Returns the job if one exists, or null otherwise.
   */
  static async findActiveJob(connectorEntityId: string) {
    const activeJobs = await DbService.repository.jobs.findMany(
      and(
        eq(jobs.type, "revalidation"),
        inArray(jobs.status, [...ACTIVE_STATUSES])
      )
    );

    return (
      activeJobs.find((j) => {
        const meta = j.metadata as Record<string, unknown>;
        return meta.connectorEntityId === connectorEntityId;
      }) ?? null
    );
  }

  /**
   * Throws a 409 error if there is an active revalidation job for the entity.
   * Call this before any mutation on records, field mappings, or column definitions
   * that belong to the given connector entity.
   */
  static async assertNoActiveJob(connectorEntityId: string) {
    const activeJob =
      await RevalidationService.findActiveJob(connectorEntityId);
    if (activeJob) {
      throw new ApiError(
        409,
        ApiCode.REVALIDATION_ACTIVE,
        `A revalidation job is currently active for this entity (job ${activeJob.id}). Wait for it to complete before making changes.`
      );
    }
  }

  /**
   * Assert no active revalidation job exists for any entity that uses
   * the given column definition. Used to guard column definition mutations.
   */
  static async assertNoActiveJobForColumnDefinition(
    columnDefinitionId: string
  ) {
    const mappings =
      await DbService.repository.fieldMappings.findByColumnDefinitionId(
        columnDefinitionId
      );
    const entityIds = [...new Set(mappings.map((m) => m.connectorEntityId))];

    for (const entityId of entityIds) {
      await RevalidationService.assertNoActiveJob(entityId);
    }
  }

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
