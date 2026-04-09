import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";

/**
 * Shared validation logic for column definition operations.
 * Used by both the REST router and entity management tools.
 */
export class ColumnDefinitionValidationService {
  /**
   * Validate that `validationPattern` is a syntactically valid regular expression.
   * Throws 400 if the pattern cannot be compiled.
   */
  static validatePattern(validationPattern: string | null | undefined): void {
    if (validationPattern == null) return;
    try {
      new RegExp(validationPattern);
    } catch {
      throw new ApiError(
        400,
        ApiCode.COLUMN_DEFINITION_INVALID_VALIDATION_PATTERN,
        `Invalid validationPattern: "${validationPattern}" is not a valid regular expression`
      );
    }
  }

  /**
   * Validate that a column definition can be deleted.
   * Blocks if any field mappings reference it (directly or via refColumnDefinitionId).
   */
  static async validateDelete(columnDefinitionId: string): Promise<void> {
    const [depsByColumn, depsByRef] = await Promise.all([
      DbService.repository.fieldMappings.findByColumnDefinitionId(
        columnDefinitionId,
      ),
      DbService.repository.fieldMappings.findByRefColumnDefinitionId(
        columnDefinitionId,
      ),
    ]);

    if (depsByColumn.length > 0 || depsByRef.length > 0) {
      throw new ApiError(
        422,
        ApiCode.COLUMN_DEFINITION_HAS_DEPENDENCIES,
        "Column definition has dependent field mappings",
        {
          fieldMappings: depsByColumn.map((fm) => fm.id),
          refFieldMappings: depsByRef.map((fm) => fm.id),
        },
      );
    }
  }
}
