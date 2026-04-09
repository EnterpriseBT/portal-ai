import { eq, and } from "drizzle-orm";

import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { fieldMappings } from "../db/schema/index.js";
import { Repository, type DbClient } from "../db/repositories/base.repository.js";

const NORMALIZED_KEY_REGEX = /^[a-z][a-z0-9_]*$/;
const BOOLEAN_FORMAT_REGEX = /^.+\/.+$/;

export interface FieldMappingCascadeResult {
  cascadedEntityGroupMembers: number;
  bidirectionalCleared: boolean;
}

/**
 * Shared validation and cascade logic for field mapping operations.
 * Used by both the REST router and entity management tools.
 */
export class FieldMappingValidationService {
  /**
   * Validate that `normalizedKey` matches the required format: lowercase
   * letters, digits, and underscores, starting with a letter.
   */
  static validateNormalizedKey(normalizedKey: string): void {
    if (!NORMALIZED_KEY_REGEX.test(normalizedKey)) {
      throw new ApiError(
        400,
        ApiCode.FIELD_MAPPING_INVALID_NORMALIZED_KEY,
        `Invalid normalizedKey "${normalizedKey}": must match /^[a-z][a-z0-9_]*$/`
      );
    }
  }

  /**
   * Validate that `normalizedKey` is unique within the connector entity.
   * Pass `excludeId` when updating an existing mapping to exclude itself.
   */
  static async validateNormalizedKeyUniqueness(
    connectorEntityId: string,
    normalizedKey: string,
    excludeId?: string
  ): Promise<void> {
    const existing = await DbService.repository.fieldMappings.findMany(
      and(
        eq(fieldMappings.connectorEntityId, connectorEntityId),
        eq(fieldMappings.normalizedKey, normalizedKey),
      )
    );

    const conflicts = excludeId
      ? existing.filter((fm) => fm.id !== excludeId)
      : existing;

    if (conflicts.length > 0) {
      throw new ApiError(
        409,
        ApiCode.FIELD_MAPPING_DUPLICATE_NORMALIZED_KEY,
        "A field mapping with this normalizedKey already exists on the same connector entity"
      );
    }
  }

  /**
   * Validate that `enumValues` is an array of non-empty strings when provided.
   */
  static validateEnumValues(enumValues: string[] | null | undefined): void {
    if (enumValues == null) return;
    if (!Array.isArray(enumValues) || enumValues.length === 0) {
      throw new ApiError(
        400,
        ApiCode.FIELD_MAPPING_INVALID_ENUM_VALUES,
        "enumValues must be a non-empty array of strings"
      );
    }
    for (const val of enumValues) {
      if (typeof val !== "string" || val.trim().length === 0) {
        throw new ApiError(
          400,
          ApiCode.FIELD_MAPPING_INVALID_ENUM_VALUES,
          "Each enumValues entry must be a non-empty string"
        );
      }
    }
  }

  /**
   * Validate that `format` is compatible with the column definition type.
   * - For `boolean` type: format must follow `"trueLabel/falseLabel"` pattern.
   */
  static validateFormat(format: string | null | undefined, columnType: string): void {
    if (format == null) return;
    if (columnType === "boolean" && !BOOLEAN_FORMAT_REGEX.test(format)) {
      throw new ApiError(
        400,
        ApiCode.FIELD_MAPPING_INVALID_FORMAT,
        `Invalid format for boolean type: "${format}" must follow "trueLabel/falseLabel" pattern`
      );
    }
  }

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
