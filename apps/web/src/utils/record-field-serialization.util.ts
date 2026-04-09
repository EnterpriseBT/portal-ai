import type { ResolvedColumn } from "@portalai/core/contracts";

/**
 * Serialize form values into normalizedData for API submission.
 * Returns { data, errors } — errors is non-empty if fields are invalid.
 */
export function serializeRecordFields(
  columns: ResolvedColumn[],
  values: Record<string, unknown>
): { data: Record<string, unknown>; errors: Record<string, string> } {
  const data: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const col of columns) {
    const raw = values[col.normalizedKey];

    switch (col.type) {
      case "string":
      case "date":
      case "datetime":
      case "reference":
      case "enum": {
        const str = String(raw ?? "");
        data[col.normalizedKey] = str === "" ? null : str;
        break;
      }

      case "number": {
        const str = String(raw ?? "");
        if (str === "") {
          data[col.normalizedKey] = null;
        } else {
          const num = Number(str);
          if (isNaN(num)) {
            errors[col.normalizedKey] = "Must be a valid number";
            data[col.normalizedKey] = null;
          } else {
            data[col.normalizedKey] = num;
          }
        }
        break;
      }

      case "boolean": {
        data[col.normalizedKey] = raw;
        break;
      }

      case "json": {
        const str = String(raw ?? "");
        if (str === "") {
          data[col.normalizedKey] = null;
        } else {
          try {
            data[col.normalizedKey] = JSON.parse(str);
          } catch (e) {
            errors[col.normalizedKey] = `Invalid JSON: ${(e as Error).message}`;
            data[col.normalizedKey] = null;
          }
        }
        break;
      }

      case "array": {
        const str = String(raw ?? "");
        if (str === "") {
          data[col.normalizedKey] = null;
        } else {
          try {
            const parsed = JSON.parse(str);
            if (!Array.isArray(parsed)) {
              errors[col.normalizedKey] = "Value must be a JSON array";
              data[col.normalizedKey] = null;
            } else {
              data[col.normalizedKey] = parsed;
            }
          } catch (e) {
            errors[col.normalizedKey] = `Invalid JSON: ${(e as Error).message}`;
            data[col.normalizedKey] = null;
          }
        }
        break;
      }

      case "reference-array": {
        const str = String(raw ?? "");
        if (str === "") {
          data[col.normalizedKey] = null;
        } else {
          data[col.normalizedKey] = str
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
        break;
      }

      default:
        data[col.normalizedKey] = raw;
    }
  }

  return { data, errors };
}

/**
 * Validate required fields. Returns errors for required columns with empty/null values.
 */
export function validateRequiredFields(
  columns: ResolvedColumn[],
  values: Record<string, unknown>
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const col of columns) {
    if (!col.required) continue;
    // Boolean fields always pass — no empty state
    if (col.type === "boolean") continue;

    const val = values[col.normalizedKey];
    if (val === null || val === undefined || val === "") {
      errors[col.normalizedKey] = `${col.label} is required`;
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
  columns: ResolvedColumn[],
  existingData?: Record<string, unknown>
): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  for (const col of columns) {
    if (existingData && col.normalizedKey in existingData) {
      const val = existingData[col.normalizedKey];

      switch (col.type) {
        case "json":
        case "array":
          // Deserialize objects/arrays to pretty-printed JSON string
          values[col.normalizedKey] =
            val !== null && typeof val === "object"
              ? JSON.stringify(val, null, 2)
              : val !== null && val !== undefined
                ? String(val)
                : "";
          break;

        case "number":
          values[col.normalizedKey] =
            val !== null && val !== undefined ? String(val) : "";
          break;

        case "boolean":
          values[col.normalizedKey] = val;
          break;

        default:
          values[col.normalizedKey] = val ?? "";
          break;
      }
    } else {
      // Create mode — use defaults
      switch (col.type) {
        case "boolean":
          values[col.normalizedKey] = false;
          break;

        default:
          values[col.normalizedKey] = col.defaultValue ?? "";
          break;
      }
    }
  }

  return values;
}
