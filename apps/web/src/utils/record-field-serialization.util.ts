import type { ColumnDefinitionSummary } from "@portalai/core/contracts";

/**
 * Serialize form values into normalizedData for API submission.
 * Returns { data, errors } — errors is non-empty if fields are invalid.
 */
export function serializeRecordFields(
  columns: ColumnDefinitionSummary[],
  values: Record<string, unknown>
): { data: Record<string, unknown>; errors: Record<string, string> } {
  const data: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const col of columns) {
    const raw = values[col.key];

    switch (col.type) {
      case "string":
      case "date":
      case "datetime":
      case "reference":
      case "enum": {
        const str = String(raw ?? "");
        data[col.key] = str === "" ? null : str;
        break;
      }

      case "number":
      case "currency": {
        const str = String(raw ?? "");
        if (str === "") {
          data[col.key] = null;
        } else {
          const num = Number(str);
          if (isNaN(num)) {
            errors[col.key] = "Must be a valid number";
            data[col.key] = null;
          } else {
            data[col.key] = num;
          }
        }
        break;
      }

      case "boolean": {
        data[col.key] = raw;
        break;
      }

      case "json": {
        const str = String(raw ?? "");
        if (str === "") {
          data[col.key] = null;
        } else {
          try {
            data[col.key] = JSON.parse(str);
          } catch (e) {
            errors[col.key] = `Invalid JSON: ${(e as Error).message}`;
            data[col.key] = null;
          }
        }
        break;
      }

      case "array": {
        const str = String(raw ?? "");
        if (str === "") {
          data[col.key] = null;
        } else {
          try {
            const parsed = JSON.parse(str);
            if (!Array.isArray(parsed)) {
              errors[col.key] = "Value must be a JSON array";
              data[col.key] = null;
            } else {
              data[col.key] = parsed;
            }
          } catch (e) {
            errors[col.key] = `Invalid JSON: ${(e as Error).message}`;
            data[col.key] = null;
          }
        }
        break;
      }

      case "reference-array": {
        const str = String(raw ?? "");
        if (str === "") {
          data[col.key] = null;
        } else {
          data[col.key] = str
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
        break;
      }

      default:
        data[col.key] = raw;
    }
  }

  return { data, errors };
}

/**
 * Validate required fields. Returns errors for required columns with empty/null values.
 */
export function validateRequiredFields(
  columns: ColumnDefinitionSummary[],
  values: Record<string, unknown>
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const col of columns) {
    if (!col.required) continue;
    // Boolean fields always pass — no empty state
    if (col.type === "boolean") continue;

    const val = values[col.key];
    if (val === null || val === undefined || val === "") {
      errors[col.key] = `${col.label} is required`;
    }
  }

  return errors;
}

/**
 * Build initial form values from column definitions.
 * Used by CreateEntityRecordDialog for default values.
 * Used by EditEntityRecordDialog to deserialize existing normalizedData.
 */
export function initializeRecordFields(
  columns: ColumnDefinitionSummary[],
  existingData?: Record<string, unknown>
): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  for (const col of columns) {
    if (existingData && col.key in existingData) {
      const val = existingData[col.key];

      switch (col.type) {
        case "json":
        case "array":
          // Deserialize objects/arrays to pretty-printed JSON string
          values[col.key] =
            val !== null && typeof val === "object"
              ? JSON.stringify(val, null, 2)
              : val !== null && val !== undefined
                ? String(val)
                : "";
          break;

        case "number":
        case "currency":
          values[col.key] =
            val !== null && val !== undefined ? String(val) : "";
          break;

        case "boolean":
          values[col.key] = val;
          break;

        default:
          values[col.key] = val ?? "";
          break;
      }
    } else {
      // Create mode — use defaults
      switch (col.type) {
        case "boolean":
          values[col.key] = false;
          break;

        default:
          values[col.key] = col.defaultValue ?? "";
          break;
      }
    }
  }

  return values;
}
