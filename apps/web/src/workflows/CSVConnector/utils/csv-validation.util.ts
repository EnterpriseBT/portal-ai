import { z } from "zod";

import type { FormErrors } from "../../../utils/form-validation.util";
import type { RecommendedColumn, RecommendedEntity } from "./upload-workflow.util";

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

const NormalizedKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "Normalized key must be lowercase snake_case");

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

    // Per-column schema validation
    for (let ci = 0; ci < entities[ei].columns.length; ci++) {
      const col = entities[ei].columns[ci];
      const isRef = col.recommended.type === "reference" || col.recommended.type === "reference-array";
      const schema = isRef ? ReferenceColumnSchema : BaseColumnSchema;
      const result = schema.safeParse(col.recommended);
      if (!result.success) {
        const fieldErrors: FormErrors = {};
        for (const issue of result.error.issues) {
          const key = issue.path.join(".");
          if (!fieldErrors[key]) fieldErrors[key] = issue.message;
        }
        colErrors[ci] = fieldErrors;
      }

      // Validate validationPattern is a valid regex
      const vp = col.recommended.validationPattern;
      if (vp) {
        try {
          new RegExp(vp);
        } catch {
          colErrors[ci] = {
            ...(colErrors[ci] ?? {}),
            validationPattern: "Invalid regular expression",
          };
        }
      }

      // Validate normalizedKey
      const nk = col.normalizedKey ?? col.recommended.key;
      const nkResult = NormalizedKeySchema.safeParse(nk);
      if (!nkResult.success) {
        colErrors[ci] = {
          ...(colErrors[ci] ?? {}),
          normalizedKey: nkResult.error.issues[0].message,
        };
      }
    }

    // Uniqueness check for normalizedKey within the entity
    const seen = new Map<string, number>();
    for (let ci = 0; ci < entities[ei].columns.length; ci++) {
      const col = entities[ei].columns[ci];
      const nk = col.normalizedKey ?? col.recommended.key;
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
  // Cross-entity consistency check: create_new columns sharing the same key
  // must agree on column-definition-level fields (type, label, validation, etc.)
  const COL_DEF_FIELDS = ["type", "label", "validationPattern", "validationMessage", "canonicalFormat"] as const;
  const seen = new Map<string, { entityIndex: number; columnIndex: number; rec: RecommendedColumn["recommended"] }>();

  for (let ei = 0; ei < entities.length; ei++) {
    for (let ci = 0; ci < entities[ei].columns.length; ci++) {
      const col = entities[ei].columns[ci];
      if (col.action !== "create_new") continue;

      const key = col.recommended.key;
      if (!key) continue;

      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, { entityIndex: ei, columnIndex: ci, rec: col.recommended });
        continue;
      }

      const conflicts: string[] = [];
      for (const field of COL_DEF_FIELDS) {
        const a = existing.rec[field] ?? null;
        const b = col.recommended[field] ?? null;
        if (a !== b) conflicts.push(field);
      }

      if (conflicts.length > 0) {
        const msg = `Conflicts with "${key}" in entity "${entities[existing.entityIndex].connectorEntity.label}": ${conflicts.join(", ")}`;
        if (!allErrors[ei]) allErrors[ei] = {};
        allErrors[ei][ci] = {
          ...(allErrors[ei][ci] ?? {}),
          key: msg,
        };
      }
    }
  }

  return allErrors;
}

export function hasColumnStepErrors(errors: ColumnStepErrors): boolean {
  return Object.keys(errors).length > 0;
}
