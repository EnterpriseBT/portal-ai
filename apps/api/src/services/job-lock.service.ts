/**
 * Entity-level locking against in-flight async jobs.
 *
 * Encodes the convention documented in CLAUDE.md §"Async Job State &
 * Data Locking": while a job is in flight, the entity it owns is
 * read-only across the entire stack. Mutation routes call
 * `assertConnectorInstanceUnlocked` (or its sibling, when other
 * lockable entity types arrive) before any DB write so the user
 * doesn't race the worker. The frontend reads the same blocking-jobs
 * list from `findRunningForConnectorInstance` to drive the
 * `<EntityLockAlert>` chip + disabled mutation buttons.
 *
 * Locks release when each job reaches a terminal status (see
 * `TERMINAL_JOB_STATUSES` in `@portalai/core/models/job.model.ts`).
 * No manual unlock paths.
 */

import type { JobSelect } from "../db/schema/zod.js";
import {
  ApiCode,
  ApiCodeDefaultRecommendation,
} from "../constants/api-codes.constants.js";
import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";

/**
 * Trimmed job summary returned to API consumers — the full row's
 * `metadata` / `result` columns can carry the entire layout plan or
 * upload payload, which is too much to leak to a 409 details body or
 * a frontend lock chip.
 */
export interface RunningJobSummary {
  id: string;
  type: JobSelect["type"];
  status: JobSelect["status"];
  startedAt: number | null;
  created: number;
}

function toSummary(row: JobSelect): RunningJobSummary {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    startedAt: row.startedAt,
    created: row.created,
  };
}

export class JobLockService {
  /**
   * Return every non-terminal job locking the given connector
   * instance — `connector_sync` plus both kinds of
   * `layout_plan_commit`. Empty array when the instance is free to
   * mutate. Org-scoped so a leak across orgs is structurally
   * impossible even if the caller forgets to authz the instance
   * itself.
   */
  static async findRunningForConnectorInstance(
    connectorInstanceId: string,
    organizationId: string
  ): Promise<RunningJobSummary[]> {
    const rows =
      await DbService.repository.jobs.findRunningForConnectorInstance(
        connectorInstanceId,
        organizationId
      );
    return rows.map(toSummary);
  }

  /**
   * Throw `409 ENTITY_LOCKED_BY_JOB` if any non-terminal job locks
   * the connector instance. Call this at the head of every route /
   * service entry point that mutates the instance, its plan, its
   * entities, or its records — the goal is that a single check
   * across the affected mutation paths produces a uniform UX.
   *
   * The thrown error's `details.runningJobs` carries the same
   * `RunningJobSummary[]` shape the GET-running-jobs endpoint
   * returns, so the frontend can reuse one renderer for both the
   * proactive chip and the post-attempt error toast.
   */
  static async assertConnectorInstanceUnlocked(
    connectorInstanceId: string,
    organizationId: string
  ): Promise<void> {
    const runningJobs = await JobLockService.findRunningForConnectorInstance(
      connectorInstanceId,
      organizationId
    );
    if (runningJobs.length === 0) return;
    throw new ApiError(
      409,
      ApiCode.ENTITY_LOCKED_BY_JOB,
      "Connector instance is locked by an in-flight job",
      { runningJobs }
    );
  }

  /**
   * Lock check for mutations against one or more connector entities.
   * Two layers:
   *
   *  1. Instance-level: resolves each entity's parent connector
   *     instance and delegates to `assertConnectorInstanceUnlocked` so
   *     connector-sync / layout-plan-commit jobs lock the entity
   *     transitively. Unique instance ids only — overlapping inputs
   *     don't hit the DB twice.
   *  2. Entity-level: single array-overlap query for non-terminal
   *     `bulk_transform` jobs whose metadata declares any of these
   *     entities as a target (#99). When the throw fires, the error
   *     details enumerate every entity in the input that's blocked
   *     plus the jobs locking them, so the caller can surface the
   *     whole conflict at once rather than one entity at a time.
   *
   * No-op for any id whose entity doesn't exist; the caller's own
   * 404 handling fires for missing rows. Empty input is a no-op.
   *
   * Org-scoped end-to-end — leak across orgs is structurally
   * impossible even if the caller forgets to authz the entities.
   */
  static async assertConnectorEntityUnlocked(
    connectorEntityIds: string[],
    organizationId: string
  ): Promise<void> {
    if (connectorEntityIds.length === 0) return;

    const entities = await Promise.all(
      connectorEntityIds.map((id) =>
        DbService.repository.connectorEntities.findById(id)
      )
    );
    const liveEntities = entities.filter(
      (e): e is NonNullable<typeof e> => e !== null && e !== undefined
    );
    if (liveEntities.length === 0) return;

    // Layer 1: instance-level lock per unique instance.
    const uniqueInstanceIds = Array.from(
      new Set(liveEntities.map((e) => e.connectorInstanceId))
    );
    for (const instanceId of uniqueInstanceIds) {
      await JobLockService.assertConnectorInstanceUnlocked(
        instanceId,
        organizationId
      );
    }

    // Layer 2: entity-level lock (bulk_transform; #85, #99).
    const liveEntityIds = liveEntities.map((e) => e.id);
    const entityLockingJobs =
      await DbService.repository.jobs.findRunningByTargetEntityIds(
        liveEntityIds,
        organizationId
      );
    if (entityLockingJobs.length === 0) return;

    // Enumerate the requested entity ids each locking job blocks.
    const blockedSet = new Set<string>();
    for (const job of entityLockingJobs) {
      const metadataIds =
        (
          job.metadata as {
            targetConnectorEntityIds?: string[];
          }
        )?.targetConnectorEntityIds ?? [];
      for (const id of metadataIds) {
        if (liveEntityIds.includes(id)) blockedSet.add(id);
      }
    }
    const blockedEntities = Array.from(blockedSet).sort();
    const messageLead =
      blockedEntities.length === 1
        ? `Target entity '${blockedEntities[0]}' is locked by an in-flight bulk job`
        : `Target entities ${blockedEntities
            .map((e) => `'${e}'`)
            .join(", ")} are locked by in-flight bulk jobs`;
    throw new ApiError(409, ApiCode.BULK_JOB_TARGET_LOCKED, messageLead, {
      recommendation:
        ApiCodeDefaultRecommendation[ApiCode.BULK_JOB_TARGET_LOCKED],
      details: {
        lockingJobs: entityLockingJobs.map(toSummary),
        blockedEntities,
      },
    });
  }

  /**
   * Lock check for mutations on a single entity record — walks
   * record → connector entity → connector instance and asserts.
   * No-op when the record doesn't exist; the caller's own 404
   * handling fires.
   */
  static async assertEntityRecordUnlocked(
    entityRecordId: string,
    organizationId: string
  ): Promise<void> {
    const record =
      await DbService.repository.entityRecords.findById(entityRecordId);
    if (!record) return;
    await JobLockService.assertConnectorEntityUnlocked(
      [record.connectorEntityId],
      organizationId
    );
  }

  /**
   * Lock check for mutations on a single field mapping — walks
   * mapping → connector entity → connector instance and asserts.
   * No-op when the mapping doesn't exist; the caller's own 404
   * handling fires.
   */
  static async assertFieldMappingUnlocked(
    fieldMappingId: string,
    organizationId: string
  ): Promise<void> {
    const mapping =
      await DbService.repository.fieldMappings.findById(fieldMappingId);
    if (!mapping) return;
    await JobLockService.assertConnectorEntityUnlocked(
      [mapping.connectorEntityId],
      organizationId
    );
  }
}
