import { z } from "zod";

import type { FormErrors } from "../../../utils/form-validation.util";
import type {
  ColumnBindingDraft,
  RegionDraft,
} from "./region-editor.types";
import type { ColumnDataType } from "@portalai/core/models";

/** Per-region flat error map. Keys use dot-notation (e.g. "bounds.endRow"). */
export type RegionErrors = FormErrors;

/**
 * Per-field-plus-region error bag used by the workflow container.
 * Keyed by region id; absence of an entry means the region passed validation.
 */
export type RegionEditorErrors = Record<string, RegionErrors>;

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const BoundsSchema = z
  .object({
    startRow: z.number().int().nonnegative(),
    endRow: z.number().int().nonnegative(),
    startCol: z.number().int().nonnegative(),
    endCol: z.number().int().nonnegative(),
  })
  .refine((b) => b.startRow <= b.endRow, {
    message: "startRow must be ≤ endRow",
    path: ["endRow"],
  })
  .refine((b) => b.startCol <= b.endCol, {
    message: "startCol must be ≤ endCol",
    path: ["endCol"],
  });

const RecordsAxisNameSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  source: z.enum(["user", "ai", "anchor-cell"]),
  confidence: z.number().min(0).max(1).optional(),
});

const CellMatchesSkipRuleSchema = z.object({
  kind: z.literal("cellMatches"),
  crossAxisIndex: z
    .number({ message: "Position is required" })
    .int()
    .nonnegative(),
  pattern: z.string().trim().min(1, "Pattern is required"),
  axis: z.enum(["row", "column"]).optional(),
});

const BlankSkipRuleSchema = z.object({ kind: z.literal("blank") });

const SkipRuleSchema = z.discriminatedUnion("kind", [
  BlankSkipRuleSchema,
  CellMatchesSkipRuleSchema,
]);

// ---------------------------------------------------------------------------
// Region-level validation
// ---------------------------------------------------------------------------

/**
 * Validate a single region draft. Returns a flat `FormErrors` keyed by
 * dot-notation field paths (`"bounds.endRow"`, `"recordsAxisName"`, etc.)
 * so the side panel can render inline errors.
 */
export function validateRegion(region: RegionDraft): RegionErrors {
  const errors: RegionErrors = {};

  // --- Entity ---
  if (!region.targetEntityDefinitionId) {
    errors.targetEntityDefinitionId = "Target entity is required";
  }

  // --- Bounds ---
  const boundsResult = BoundsSchema.safeParse(region.bounds);
  if (!boundsResult.success) {
    for (const issue of boundsResult.error.issues) {
      const key = `bounds.${issue.path.join(".")}`;
      if (!errors[key]) errors[key] = issue.message;
    }
  }

  // --- Orientation / header-axis combos ---
  const crosstab = region.orientation === "cells-as-records";
  const pivoted =
    crosstab ||
    (region.orientation === "columns-as-records" &&
      region.headerAxis === "row") ||
    (region.orientation === "rows-as-records" &&
      region.headerAxis === "column");

  if (pivoted) {
    if (!region.recordsAxisName?.name || !region.recordsAxisName.name.trim()) {
      errors.recordsAxisName = crosstab
        ? "Row-axis name is required for crosstab regions"
        : "Records-axis name is required for pivoted regions";
    } else {
      const parsed = RecordsAxisNameSchema.safeParse(region.recordsAxisName);
      if (!parsed.success) {
        errors.recordsAxisName =
          parsed.error.issues[0]?.message ?? "Invalid records-axis name";
      }
    }
  }

  if (crosstab) {
    if (
      !region.secondaryRecordsAxisName?.name ||
      !region.secondaryRecordsAxisName.name.trim()
    ) {
      errors.secondaryRecordsAxisName =
        "Column-axis name is required for crosstab regions";
    }
    if (!region.cellValueName?.name || !region.cellValueName.name.trim()) {
      errors.cellValueName = "Cell value name is required for crosstab regions";
    }
  }

  // --- Axis-anchor-cell override (optional; only meaningful for pivoted shapes) ---
  if (region.axisAnchorCell) {
    const { row, col } = region.axisAnchorCell;
    if (
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      row < 0 ||
      col < 0
    ) {
      errors.axisAnchorCell =
        "Anchor cell row and column must be non-negative integers";
    } else if (
      row < region.bounds.startRow ||
      row > region.bounds.endRow ||
      col < region.bounds.startCol ||
      col > region.bounds.endCol
    ) {
      errors.axisAnchorCell = "Anchor cell must be within the region's bounds";
    } else if (!pivoted) {
      errors.axisAnchorCell = "Anchor cell only applies to pivoted regions";
    }
  }

  // --- Extent ---
  if (region.boundsMode === "matchesPattern") {
    const p = region.boundsPattern?.trim();
    if (!p) {
      errors.boundsPattern =
        "Stop pattern is required when extent is Matches pattern";
    } else {
      try {
        new RegExp(p);
      } catch {
        errors.boundsPattern = "Stop pattern is not a valid regular expression";
      }
    }
  }

  if (
    region.boundsMode === "untilEmpty" &&
    region.untilEmptyTerminatorCount !== undefined
  ) {
    if (
      !Number.isFinite(region.untilEmptyTerminatorCount) ||
      region.untilEmptyTerminatorCount < 1
    ) {
      errors.untilEmptyTerminatorCount = "Terminator count must be at least 1";
    }
  }

  // --- Skip rules ---
  if (region.skipRules) {
    for (let i = 0; i < region.skipRules.length; i++) {
      const rule = region.skipRules[i];
      const result = SkipRuleSchema.safeParse(rule);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const key = `skipRules.${i}.${issue.path.join(".") || "rule"}`;
          if (!errors[key]) errors[key] = issue.message;
        }
      } else if (result.data.kind === "cellMatches") {
        try {
          new RegExp(result.data.pattern);
        } catch {
          errors[`skipRules.${i}.pattern`] =
            "Pattern is not a valid regular expression";
        }
      }
    }
  }

  return errors;
}

/**
 * Validate every region in a list. Returns a keyed error map — regions that
 * pass validation are absent from the result.
 *
 * Also runs a cross-region pass: under C1 (one region per entity) two regions
 * binding to the same `targetEntityDefinitionId` would merge at commit; we
 * flag both offenders here so the UI can present the conflict before Commit.
 */
export function validateRegions(regions: RegionDraft[]): RegionEditorErrors {
  const all: RegionEditorErrors = {};
  for (const region of regions) {
    const errors = validateRegion(region);
    if (Object.keys(errors).length > 0) {
      all[region.id] = errors;
    }
  }

  const idsByTarget = new Map<string, string[]>();
  for (const region of regions) {
    if (!region.targetEntityDefinitionId) continue;
    const list = idsByTarget.get(region.targetEntityDefinitionId) ?? [];
    list.push(region.id);
    idsByTarget.set(region.targetEntityDefinitionId, list);
  }
  for (const [, ids] of idsByTarget) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      const existing = all[id] ?? {};
      existing.targetEntityDefinitionId =
        "This entity is already bound to another region in this upload.";
      all[id] = existing;
    }
  }

  return all;
}

/** True when at least one region has validation errors. */
export function hasRegionErrors(errors: RegionEditorErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Region ids with at least one validation error — ordered by input list. */
export function regionsWithErrors(
  regions: RegionDraft[],
  errors: RegionEditorErrors
): string[] {
  return regions.map((r) => r.id).filter((id) => errors[id] !== undefined);
}

// ---------------------------------------------------------------------------
// Binding-level validation (overrides — see docs/BINDING_OVERRIDES.spec.md)
// ---------------------------------------------------------------------------

const NORMALIZED_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

const REFERENCE_TYPES: ReadonlySet<ColumnDataType> = new Set([
  "reference",
  "reference-array",
]);

/** Flat field-errors map for a single binding draft. */
export type BindingErrors = FormErrors;

/** Errors keyed by serialised `sourceLocator` for bindings that failed validation. */
export type RegionBindingErrors = Record<string, BindingErrors>;

export interface BindingValidationContext {
  /**
   * The bound `ColumnDefinition`'s type — the caller passes it from the org
   * catalog. Drives reference-field validation. When omitted, reference
   * validation is skipped (commit enforces it regardless).
   */
  columnDefinitionType?: ColumnDataType;
}

/**
 * Validate a single binding draft in isolation (no cross-binding collision
 * checks — that's `validateRegionBindings`'s job). Skips required-field
 * checks when the binding is excluded: a user omitting the column shouldn't
 * need to fill in anything else first.
 */
export function validateBindingDraft(
  binding: ColumnBindingDraft,
  ctx: BindingValidationContext = {}
): BindingErrors {
  const errors: BindingErrors = {};
  if (binding.excluded) return errors;

  if (!binding.columnDefinitionId) {
    errors.columnDefinitionId = "Column definition is required.";
  }
  if (
    binding.normalizedKey !== undefined &&
    binding.normalizedKey !== "" &&
    !NORMALIZED_KEY_PATTERN.test(binding.normalizedKey)
  ) {
    errors.normalizedKey =
      "Must be lowercase snake_case (letters, digits, underscores; start with a letter).";
  }
  if (
    ctx.columnDefinitionType &&
    REFERENCE_TYPES.has(ctx.columnDefinitionType) &&
    (binding.refEntityKey === undefined ||
      binding.refEntityKey === null ||
      binding.refEntityKey === "")
  ) {
    errors.refEntityKey =
      "Reference-typed columns must point at a target entity.";
  }
  if (binding.enumValues && binding.enumValues.length > 0) {
    if (binding.enumValues.some((v) => typeof v !== "string" || !v.trim())) {
      errors.enumValues = "Each enum value must be a non-empty string.";
    }
  }
  return errors;
}

/**
 * Validate every binding in a region, including a cross-binding collision
 * check on the resolved normalized key — two bindings with different
 * `columnDefinitionId`s but the same (override or implicit) `normalizedKey`
 * would silently overwrite the same `FieldMapping` row at commit.
 *
 * Returns a map keyed by `sourceLocator`; absence of an entry means the
 * binding passed. Excluded bindings are ignored entirely.
 */
export function validateRegionBindings(
  region: RegionDraft,
  ctxByLocator: Record<string, BindingValidationContext | undefined> = {}
): RegionBindingErrors {
  const result: RegionBindingErrors = {};
  const bindings = region.columnBindings ?? [];

  // Per-binding checks.
  for (const binding of bindings) {
    if (binding.excluded) continue;
    const ctx = ctxByLocator[binding.sourceLocator] ?? {};
    const errors = validateBindingDraft(binding, ctx);
    if (Object.keys(errors).length > 0) {
      result[binding.sourceLocator] = errors;
    }
  }

  // Cross-binding normalized-key collision — only the explicit overrides
  // collide reliably; a missing override falls back to the catalog at commit
  // (which we don't have here), so we conservatively only flag explicit dups.
  const byKey = new Map<string, string[]>();
  for (const binding of bindings) {
    if (binding.excluded) continue;
    const key = binding.normalizedKey;
    if (!key) continue;
    const locs = byKey.get(key) ?? [];
    locs.push(binding.sourceLocator);
    byKey.set(key, locs);
  }
  for (const [, locators] of byKey.entries()) {
    if (locators.length < 2) continue;
    for (const locator of locators) {
      const existing = result[locator] ?? {};
      existing.normalizedKey =
        "Duplicate normalizedKey override — conflicts with another binding.";
      result[locator] = existing;
    }
  }

  return result;
}

/**
 * True when *any* binding in *any* region in the input has validation errors.
 * Used by `ReviewStepUI` to gate the Commit button.
 */
export function hasAnyBindingErrors(
  regions: RegionDraft[],
  ctxByRegion: Record<
    string,
    Record<string, BindingValidationContext | undefined>
  > = {}
): boolean {
  for (const region of regions) {
    const errors = validateRegionBindings(region, ctxByRegion[region.id]);
    if (Object.keys(errors).length > 0) return true;
  }
  return false;
}
