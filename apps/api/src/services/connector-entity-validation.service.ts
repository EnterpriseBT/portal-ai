import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { assertWriteCapability } from "../utils/resolve-capabilities.util.js";

export interface ConnectorEntityCascadeCounts {
  entityRecords: number;
  fieldMappings: number;
  entityTagAssignments: number;
  entityGroupMembers: number;
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
        "Connector entity not found",
      );
    }

    await assertWriteCapability(connectorEntityId);

    const externalRefs =
      await DbService.repository.fieldMappings.findByRefEntityKey(
        entity.key,
        connectorEntityId,
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
        },
      );
    }
  }

  /**
   * Execute a cascade soft-delete of a connector entity and all dependents
   * inside a single transaction.
   */
  static async executeDelete(
    connectorEntityId: string,
    userId: string,
  ): Promise<ConnectorEntityCascadeCounts> {
    const entityIds = [connectorEntityId];

    return DbService.transaction(async (tx) => {
      const [entityGroupMembers, entityTagAssignments, fieldMappings, entityRecords] =
        await Promise.all([
          DbService.repository.entityGroupMembers.softDeleteByConnectorEntityIds(entityIds, userId, tx),
          DbService.repository.entityTagAssignments.softDeleteByConnectorEntityIds(entityIds, userId, tx),
          DbService.repository.fieldMappings.softDeleteByConnectorEntityIds(entityIds, userId, tx),
          DbService.repository.entityRecords.softDeleteByConnectorEntityIds(entityIds, userId, tx),
        ]);

      await DbService.repository.connectorEntities.softDelete(
        connectorEntityId,
        userId,
        tx,
      );

      return { entityRecords, fieldMappings, entityTagAssignments, entityGroupMembers };
    });
  }
}
