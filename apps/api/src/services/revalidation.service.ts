import { and, eq, inArray } from "drizzle-orm";

import type { RevalidationMetadata } from "@portalai/core/models";

import { DbService } from "./db.service.js";
import { JobsService } from "./jobs.service.js";
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
        inArray(jobs.status, [...ACTIVE_STATUSES]),
      ),
    );

    return activeJobs.find((j) => {
      const meta = j.metadata as Record<string, unknown>;
      return meta.connectorEntityId === connectorEntityId;
    }) ?? null;
  }

  /**
   * Throws a 409 error if there is an active revalidation job for the entity.
   * Call this before any mutation on records, field mappings, or column definitions
   * that belong to the given connector entity.
   */
  static async assertNoActiveJob(connectorEntityId: string) {
    const activeJob = await RevalidationService.findActiveJob(connectorEntityId);
    if (activeJob) {
      throw new ApiError(
        409,
        ApiCode.REVALIDATION_ACTIVE,
        `A revalidation job is currently active for this entity (job ${activeJob.id}). Wait for it to complete before making changes.`,
      );
    }
  }

  /**
   * Assert no active revalidation job exists for any entity that uses
   * the given column definition. Used to guard column definition mutations.
   */
  static async assertNoActiveJobForColumnDefinition(columnDefinitionId: string) {
    const mappings = await DbService.repository.fieldMappings.findByColumnDefinitionId(columnDefinitionId);
    const entityIds = [...new Set(mappings.map((m) => m.connectorEntityId))];

    for (const entityId of entityIds) {
      await RevalidationService.assertNoActiveJob(entityId);
    }
  }

  /**
   * Enqueue a revalidation job for the given connector entity.
   * If a revalidation job is already active, this is a no-op (returns the existing job).
   */
  static async enqueue(connectorEntityId: string, organizationId: string, userId: string) {
    const existing = await RevalidationService.findActiveJob(connectorEntityId);
    if (existing) {
      logger.info(
        { connectorEntityId, jobId: existing.id },
        "Revalidation job already active, skipping enqueue",
      );
      return existing;
    }

    const metadata: RevalidationMetadata = { connectorEntityId, organizationId };

    const job = await JobsService.create(userId, {
      type: "revalidation",
      organizationId,
      metadata: metadata as Record<string, unknown>,
    });

    logger.info(
      { connectorEntityId, jobId: job.id },
      "Revalidation job enqueued",
    );

    return job;
  }
}
