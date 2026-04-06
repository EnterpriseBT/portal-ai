import { eq } from "drizzle-orm";

import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { fieldMappings } from "../db/schema/index.js";
import { Repository, type DbClient } from "../db/repositories/base.repository.js";

export interface FieldMappingCascadeResult {
  cascadedEntityGroupMembers: number;
  bidirectionalCleared: boolean;
}

/**
 * Shared validation and cascade logic for field mapping deletion.
 * Used by both the REST router and entity management tools.
 */
export class FieldMappingValidationService {
  /**
   * Validate that a field mapping can be deleted.
   * Blocks if the connector entity has any records.
   */
  static async validateDelete(fieldMappingId: string): Promise<void> {
    const mapping =
      await DbService.repository.fieldMappings.findById(fieldMappingId);
    if (!mapping) {
      throw new ApiError(
        404,
        ApiCode.FIELD_MAPPING_NOT_FOUND,
        "Field mapping not found",
      );
    }

    const recordCount =
      await DbService.repository.entityRecords.countByConnectorEntityId(
        mapping.connectorEntityId,
      );
    if (recordCount > 0) {
      throw new ApiError(
        409,
        ApiCode.FIELD_MAPPING_DELETE_HAS_RECORDS,
        `Cannot delete field mapping: the connector entity has ${recordCount} record${recordCount !== 1 ? "s" : ""}. Delete the records first.`,
      );
    }
  }

  /**
   * Execute a cascade soft-delete of a field mapping, its dependent
   * entity group members, and clear bidirectional counterpart reference.
   *
   * When `client` is provided the operations run on that client directly
   * (useful for joining an outer transaction). Otherwise a new transaction
   * is created internally.
   */
  static async executeDelete(
    fieldMappingId: string,
    userId: string,
    client?: DbClient,
  ): Promise<FieldMappingCascadeResult> {
    const mapping =
      await DbService.repository.fieldMappings.findById(fieldMappingId);
    if (!mapping) {
      throw new ApiError(
        404,
        ApiCode.FIELD_MAPPING_NOT_FOUND,
        "Field mapping not found",
      );
    }

    const run = async (tx: DbClient): Promise<FieldMappingCascadeResult> => {
      await DbService.repository.fieldMappings.softDelete(
        fieldMappingId,
        userId,
        tx,
      );
      const cascadedEntityGroupMembers =
        await DbService.repository.entityGroupMembers.softDeleteByLinkFieldMappingId(
          fieldMappingId,
          userId,
          tx,
        );

      let bidirectionalCleared = false;
      if (mapping.refBidirectionalFieldMappingId) {
        await DbService.repository.fieldMappings.updateWhere(
          eq(fieldMappings.id, mapping.refBidirectionalFieldMappingId),
          {
            refBidirectionalFieldMappingId: null,
            updated: Date.now(),
            updatedBy: userId,
          } as never,
          tx,
        );
        bidirectionalCleared = true;
      }

      return { cascadedEntityGroupMembers, bidirectionalCleared };
    };

    if (client) return run(client);
    return Repository.transaction(run);
  }
}
