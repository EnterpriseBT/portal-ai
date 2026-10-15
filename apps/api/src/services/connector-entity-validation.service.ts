import { DbService } from "./db.service.js";
import { CuratedViewDeleteService } from "./curated-view-delete.service.js";
import { EntityDataDeleteService } from "./entity-data-delete.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { assertWriteCapability } from "../utils/resolve-capabilities.util.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import type { JobSelect } from "../db/schema/zod.js";

/** What the delete tombstoned in its transaction. Records aren't here: they
 *  go off-request, in the `entity_data_delete` job (#802). */
export interface ConnectorEntityCascadeCounts {
  fieldMappings: number;
  entityTagAssignments: number;
  entityGroupMembers: number;
  /** #802: the curated views over the entity, deleted with it. */
  curatedViews: number;
}

export interface ConnectorEntityDeleteOutcome {
  cascaded: ConnectorEntityCascadeCounts;
  /** #802: the `entity_data_delete` job, inserted in the delete's
   *  transaction. The caller dispatches it after that commits. */
  recordsJob: JobSelect;
}

/**
 * Shared validation and cascade logic for connector entity deletion.
 * Used by both the REST router and entity management tools.
 */
export class ConnectorEntityValidationService {
  /**
   * Validate that a connector entity can be deleted:
   * 1. Write capability must be enabled on the owning instance
   * 2. No external field mapping references exist
   */
  static async validateDelete(connectorEntityId: string): Promise<void> {
    const entity =
      await DbService.repository.connectorEntities.findById(connectorEntityId);
    if (!entity) {
      throw new ApiError(
        404,
        ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
        "Connector entity not found"
      );
    }

    await assertWriteCapability(connectorEntityId);

    const externalRefs =
      await DbService.repository.fieldMappings.findByRefEntityKey(
        entity.key,
        connectorEntityId
      );
    if (externalRefs.length > 0) {
      throw new ApiError(
        422,
        ApiCode.ENTITY_HAS_EXTERNAL_REFERENCES,
        "Cannot delete entity — other entities have field mappings referencing it via refEntityKey",
        {
          refFieldMappings: externalRefs.map((fm) => ({
            id: fm.id,
            connectorEntityId: fm.connectorEntityId,
          })),
        }
      );
    }
  }

  /**
   * Execute a cascade soft-delete of a connector entity and its dependents:
   * its curated views, group memberships, tag assignments, field mappings and
   * the entity itself, plus an `entity_data_delete` job row for its records
   * and wide table (#802).
   *
   * When `client` is provided the operations run on that client directly
   * (useful for joining an outer transaction). Otherwise a new transaction
   * is created internally. Either way the caller must
   * `EntityDataDeleteService.dispatch(outcome.recordsJob)` (non-blocking) once that
   * transaction has committed.
   */
  static async executeDelete(
    connectorEntityId: string,
    organizationId: string,
    userId: string,
    client?: DbClient
  ): Promise<ConnectorEntityDeleteOutcome> {
    const run = async (tx: DbClient): Promise<ConnectorEntityDeleteOutcome> => {
      const entityIds = [connectorEntityId];

      // #802: claim the entity first. Its row lock makes a concurrent delete
      // of the same entity wait here, and once this commits that delete finds
      // the entity already deleted: it answers 404 and rolls back, instead of
      // re-running the cascade and queuing a second records job.
      const claimed = await DbService.repository.connectorEntities.softDelete(
        connectorEntityId,
        userId,
        tx
      );
      if (!claimed) {
        throw new ApiError(
          404,
          ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
          "Connector entity not found"
        );
      }

      // #802: a view is meaningless without its entity — it would 500 on
      // open and stay attached to its stations. Delete the entity's views
      // (projection rows, attachments, grants) in the same transaction.
      const viewIds =
        await CuratedViewDeleteService.findIdsByConnectorEntityIds(
          organizationId,
          entityIds,
          tx
        );
      const views = await CuratedViewDeleteService.deleteByIds(
        organizationId,
        viewIds,
        userId,
        tx
      );

      // #802: everything user-visible goes in this transaction; the records
      // (400K+ took longer than a request may) and the wide table go to the
      // entity_data_delete job inserted below.
      const [entityGroupMembers, entityTagAssignments, fieldMappings] =
        await Promise.all([
          DbService.repository.entityGroupMembers.softDeleteByConnectorEntityIds(
            entityIds,
            userId,
            tx
          ),
          DbService.repository.entityTagAssignments.softDeleteByConnectorEntityIds(
            entityIds,
            userId,
            tx
          ),
          DbService.repository.fieldMappings.softDeleteByConnectorEntityIds(
            entityIds,
            userId,
            tx
          ),
        ]);

      const recordsJob = await EntityDataDeleteService.insertJob(
        {
          organizationId,
          userId,
          connectorEntityIds: entityIds,
          connectorInstanceId: null,
        },
        tx
      );

      return {
        cascaded: {
          fieldMappings,
          entityTagAssignments,
          entityGroupMembers,
          curatedViews: views.curatedViews,
        },
        recordsJob,
      };
    };

    if (client) return run(client);
    return DbService.transaction(run);
  }
}
