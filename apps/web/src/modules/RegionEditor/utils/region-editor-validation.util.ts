import { z } from "zod";

import type { FormErrors } from "../../../utils/form-validation.util";
import type { RegionDraft } from "./region-editor.types";

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
  source: z.enum(["user", "ai"]),
  confidence: z.number().min(0).max(1).optional(),
});

const CellMatchesSkipRuleSchema = z.object({
  kind: z.literal("cellMatches"),
  crossAxisIndex: z.number({ message: "Position is required" }).int().nonnegative(),
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
    (region.orientation === "columns-as-records" && region.headerAxis === "row") ||
    (region.orientation === "rows-as-records" && region.headerAxis === "column");

  if (pivoted) {
    if (!region.recordsAxisName?.name || !region.recordsAxisName.name.trim()) {
      errors.recordsAxisName = crosstab
        ? "Row-axis name is required for crosstab regions"
        : "Records-axis name is required for pivoted regions";
    } else {
      const parsed = RecordsAxisNameSchema.safeParse(region.recordsAxisName);
      if (!parsed.success) {
        errors.recordsAxisName = parsed.error.issues[0]?.message ?? "Invalid records-axis name";
      }
    }
  }

  if (crosstab) {
    if (
      !region.secondaryRecordsAxisName?.name ||
      !region.secondaryRecordsAxisName.name.trim()
    ) {
      errors.secondaryRecordsAxisName = "Column-axis name is required for crosstab regions";
    }
    if (!region.cellValueName?.name || !region.cellValueName.name.trim()) {
      errors.cellValueName = "Cell value name is required for crosstab regions";
    }
  }

  // --- Extent ---
  if (region.boundsMode === "matchesPattern") {
    const p = region.boundsPattern?.trim();
    if (!p) {
      errors.boundsPattern = "Stop pattern is required when extent is Matches pattern";
    } else {
      try {
        new RegExp(p);
      } catch {
        errors.boundsPattern = "Stop pattern is not a valid regular expression";
      }
    }
  }

  if (region.boundsMode === "untilEmpty" && region.untilEmptyTerminatorCount !== undefined) {
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
          errors[`skipRules.${i}.pattern`] = "Pattern is not a valid regular expression";
        }
      }
    }
  }

  return errors;
}

/**
 * Validate every region in a list. Returns a keyed error map — regions that
 * pass validation are absent from the result.
 */
export function validateRegions(regions: RegionDraft[]): RegionEditorErrors {
  const all: RegionEditorErrors = {};
  for (const region of regions) {
    const errors = validateRegion(region);
    if (Object.keys(errors).length > 0) {
      all[region.id] = errors;
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
