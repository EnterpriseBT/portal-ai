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
import { ApiCode } from "../constants/api-codes.constants.js";
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
   * Lock check for mutations on a connector entity — resolves the
   * parent connector instance via the entity row, then delegates.
   * No-op when the entity doesn't exist; the caller's own 404
   * handling fires for missing rows so the API surfaces an
   * entity-specific code rather than a generic lock 409.
   *
   * The connector-instance lookup inside the delegate is
   * org-scoped, so a leak across orgs is structurally impossible
   * even if the caller forgets to authz the entity itself.
   */
  static async assertConnectorEntityUnlocked(
    connectorEntityId: string,
    organizationId: string
  ): Promise<void> {
    const entity =
      await DbService.repository.connectorEntities.findById(connectorEntityId);
    if (!entity) return;
    await JobLockService.assertConnectorInstanceUnlocked(
      entity.connectorInstanceId,
      organizationId
    );
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
      record.connectorEntityId,
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
      mapping.connectorEntityId,
      organizationId
    );
  }
}
