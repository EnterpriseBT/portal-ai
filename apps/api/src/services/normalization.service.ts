import { eq } from "drizzle-orm";

import type { ColumnDataType } from "@portalai/core/models";

import { DbService } from "./db.service.js";
import { fieldMappings } from "../db/schema/index.js";
import type {
  FieldMappingSelect,
  ColumnDefinitionSelect,
} from "../db/schema/zod.js";
import { coerce } from "../utils/coercion.util.js";
import {
  validateRequired,
  validatePattern,
  validateEnum,
} from "../utils/field-validation.util.js";
import { canonicalizeString } from "../utils/canonicalize.util.js";

export interface NormalizationResult {
  normalizedData: Record<string, unknown>;
  validationErrors: Array<{ field: string; error: string }> | null;
  isValid: boolean;
}

type MappingWithColumnDef = FieldMappingSelect & {
  columnDefinition: ColumnDefinitionSelect | null;
};

/**
 * Normalizes raw entity record data through field mappings.
 *
 * Pipeline per field: extract → default → required → coerce → validate → canonicalize → store.
 */
export class NormalizationService {
  /**
   * Normalize data for a connector entity. Fetches field mappings internally.
   */
  static async normalize(
    connectorEntityId: string,
    data: Record<string, unknown>
  ): Promise<NormalizationResult> {
    const mappings = (await DbService.repository.fieldMappings.findMany(
      eq(fieldMappings.connectorEntityId, connectorEntityId),
      { include: ["columnDefinition"] }
    )) as unknown as MappingWithColumnDef[];

    return NormalizationService.normalizeWithMappings(mappings, data);
  }

  /**
   * Normalize multiple data objects for the same connector entity.
   * Loads field mappings once and applies to all items.
   */
  static async normalizeMany(
    connectorEntityId: string,
    dataItems: Record<string, unknown>[]
  ): Promise<NormalizationResult[]> {
    const mappings = (await DbService.repository.fieldMappings.findMany(
      eq(fieldMappings.connectorEntityId, connectorEntityId),
      { include: ["columnDefinition"] }
    )) as unknown as MappingWithColumnDef[];

    return dataItems.map((data) =>
      NormalizationService.normalizeWithMappings(mappings, data)
    );
  }

  /**
   * Normalize data using pre-fetched field mappings. Use this for bulk
   * operations (e.g. CSV import) to avoid repeated DB queries.
   */
  static normalizeWithMappings(
    mappings: MappingWithColumnDef[],
    data: Record<string, unknown>
  ): NormalizationResult {
    const entityMappings = mappings.filter((m) => m.columnDefinition);

    if (entityMappings.length === 0) {
      return {
        normalizedData: { ...data },
        validationErrors: null,
        isValid: true,
      };
    }

    const normalizedData: Record<string, unknown> = {};
    const errors: Array<{ field: string; error: string }> = [];

    for (const mapping of entityMappings) {
      const cd = mapping.columnDefinition!;
      const key = mapping.normalizedKey;

      // 1. Extract — prefer `normalizedKey` (used by portal-origin writes)
      // and fall back to `sourceField` (used by connector sync payloads).
      let sourceValue: unknown =
        mapping.normalizedKey in data
          ? data[mapping.normalizedKey]
          : mapping.sourceField in data
            ? data[mapping.sourceField]
            : undefined;

      // 2. Default handling
      if (
        (sourceValue === null ||
          sourceValue === undefined ||
          sourceValue === "") &&
        mapping.defaultValue !== null
      ) {
        sourceValue = mapping.defaultValue;
      }

      // 3. Required check
      if (mapping.required) {
        const reqError = validateRequired(sourceValue);
        if (reqError) {
          errors.push({ field: key, error: reqError });
          normalizedData[key] = null;
          continue;
        }
      } else if (sourceValue === null || sourceValue === undefined) {
        normalizedData[key] = null;
        continue;
      }

      // 4. Coerce
      const coerced = coerce(
        cd.type as ColumnDataType,
        sourceValue,
        mapping.format
      );
      if (coerced.error) {
        errors.push({ field: key, error: coerced.error });
        normalizedData[key] = null;
        continue;
      }

      let finalValue = coerced.value;

      // 5. Enum validation
      if (mapping.enumValues != null && cd.type === "enum") {
        const enumError = validateEnum(
          finalValue,
          mapping.enumValues as string[]
        );
        if (enumError) {
          errors.push({ field: key, error: enumError });
        }
      }

      // 6. Pattern validation
      if (cd.validationPattern !== null) {
        const patternError = validatePattern(
          finalValue,
          cd.validationPattern,
          cd.validationMessage ?? null
        );
        if (patternError) {
          errors.push({ field: key, error: patternError });
        }
      }

      // 7. Canonicalize (string type only)
      if (
        cd.type === "string" &&
        cd.canonicalFormat !== null &&
        finalValue !== null
      ) {
        finalValue = canonicalizeString(String(finalValue), cd.canonicalFormat);
      }

      // 8. Store
      normalizedData[key] = finalValue;
    }

    return {
      normalizedData,
      validationErrors: errors.length > 0 ? errors : null,
      isValid: errors.length === 0,
    };
  }
}
