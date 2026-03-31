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

const BaseColumnSchema = z.object({
  key: z.string().trim().min(1, "Column key is required"),
  label: z.string().trim().min(1, "Column label is required"),
  type: z.string().min(1, "Column type is required"),
});

const ReferenceColumnSchema = BaseColumnSchema.extend({
  type: z.enum(["reference", "reference-array"]),
  refEntityKey: z.union([
    z.string().min(1, "Reference entity is required"),
    z.null(),
  ]).refine((v) => v !== null && v.length > 0, {
    message: "Reference entity is required",
  }),
  refColumnKey: z.string().min(1).nullable(),
  refColumnDefinitionId: z.string().min(1).nullable(),
}).refine(
  (data) => !!data.refColumnKey || !!data.refColumnDefinitionId,
  { message: "Reference column is required", path: ["refColumnKey"] }
);

/** Per-entity → per-column error map. Key format: `entityIndex.columnIndex.fieldName` */
export type ColumnStepErrors = Record<number, Record<number, FormErrors>>;

export function validateColumnStep(entities: RecommendedEntity[]): ColumnStepErrors {
  const allErrors: ColumnStepErrors = {};
  for (let ei = 0; ei < entities.length; ei++) {
    const colErrors: Record<number, FormErrors> = {};
    for (let ci = 0; ci < entities[ei].columns.length; ci++) {
      const col = entities[ei].columns[ci].recommended;
      const isRef = col.type === "reference" || col.type === "reference-array";
      const schema = isRef ? ReferenceColumnSchema : BaseColumnSchema;
      const result = schema.safeParse(col);
      if (!result.success) {
        const fieldErrors: FormErrors = {};
        for (const issue of result.error.issues) {
          const key = issue.path.join(".");
          if (!fieldErrors[key]) fieldErrors[key] = issue.message;
        }
        colErrors[ci] = fieldErrors;
      }
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
