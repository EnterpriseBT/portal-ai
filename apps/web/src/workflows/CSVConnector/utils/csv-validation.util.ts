import { z } from "zod";

import type { FormErrors } from "../../../utils/form-validation.util";
import type { RecommendedEntity } from "./upload-workflow.util";

// ── Entity Step (Step 2) ────────────────────────────────────────────

const EntityFieldSchema = z.object({
  key: z.string().trim().min(1, "Entity key is required"),
  label: z.string().trim().min(1, "Entity label is required"),
});

export type EntityStepErrors = Record<number, FormErrors>;

export function validateEntityStep(entities: RecommendedEntity[]): EntityStepErrors {
  const allErrors: EntityStepErrors = {};
  for (let i = 0; i < entities.length; i++) {
    const result = EntityFieldSchema.safeParse(entities[i].connectorEntity);
    if (!result.success) {
      const fieldErrors: FormErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join(".");
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      allErrors[i] = fieldErrors;
    }
  }
  return allErrors;
}

export function hasEntityStepErrors(errors: EntityStepErrors): boolean {
  return Object.keys(errors).length > 0;
}

// ── Column Mapping Step (Step 3) ────────────────────────────────────

const NormalizedKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "Normalized key must be lowercase snake_case");

/** Per-entity → per-column error map. Key format: `entityIndex.columnIndex.fieldName` */
export type ColumnStepErrors = Record<number, Record<number, FormErrors>>;

export function validateColumnStep(entities: RecommendedEntity[]): ColumnStepErrors {
  const allErrors: ColumnStepErrors = {};
  for (let ei = 0; ei < entities.length; ei++) {
    const colErrors: Record<number, FormErrors> = {};

    // Per-column validation
    for (let ci = 0; ci < entities[ei].columns.length; ci++) {
      const col = entities[ei].columns[ci];
      const fieldErrors: FormErrors = {};

      // Validate existingColumnDefinitionId is present
      if (!col.existingColumnDefinitionId) {
        fieldErrors.existingColumnDefinitionId = "Column definition must be selected";
      }

      // Validate normalizedKey
      const nk = col.normalizedKey;
      if (!nk) {
        fieldErrors.normalizedKey = "Normalized key is required";
      } else {
        const nkResult = NormalizedKeySchema.safeParse(nk);
        if (!nkResult.success) {
          fieldErrors.normalizedKey = nkResult.error.issues[0].message;
        }
      }

      if (Object.keys(fieldErrors).length > 0) {
        colErrors[ci] = fieldErrors;
      }
    }

    // Uniqueness check for normalizedKey within the entity
    const seen = new Map<string, number>();
    for (let ci = 0; ci < entities[ei].columns.length; ci++) {
      const col = entities[ei].columns[ci];
      const nk = col.normalizedKey;
      if (!nk) continue;
      const nkResult = NormalizedKeySchema.safeParse(nk);
      if (!nkResult.success) continue; // skip invalid keys for uniqueness check
      const prev = seen.get(nk);
      if (prev !== undefined) {
        colErrors[ci] = {
          ...(colErrors[ci] ?? {}),
          normalizedKey: `Duplicate normalized key "${nk}"`,
        };
      }
      seen.set(nk, ci);
    }

    if (Object.keys(colErrors).length > 0) {
      allErrors[ei] = colErrors;
    }
  }

  return allErrors;
}

export function hasColumnStepErrors(errors: ColumnStepErrors): boolean {
  return Object.keys(errors).length > 0;
}
