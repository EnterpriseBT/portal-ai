import type {
  DriftKind,
  DriftReport,
  Region,
  RegionDrift,
} from "../plan/index.js";
import type { Sheet, WorkbookCell } from "../workbook/types.js";
import { resolveHeaders } from "./resolve-headers.js";
import { resolveRegionBounds } from "./resolve-bounds.js";

type Severity = "none" | "info" | "warn" | "blocker";

function cellText(cell: WorkbookCell | undefined): string {
  if (!cell || cell.value === null) return "";
  if (cell.value instanceof Date) return cell.value.toISOString();
  if (typeof cell.value === "boolean") return cell.value ? "true" : "false";
  return String(cell.value);
}

function severityRank(s: Severity): number {
  return { none: 0, info: 1, warn: 2, blocker: 3 }[s];
}

function maxSeverity(a: Severity, b: Severity): Severity {
  return severityRank(a) >= severityRank(b) ? a : b;
}

interface DriftDetail {
  severity: Severity;
  identityChanging: boolean;
  addedColumns: string[];
  removedColumns: string[];
  identityBlanks: number;
  duplicateIdentityValues: number;
  renamedAnchor?: { prior: string; current: string };
}

/**
 * Evaluate drift for a single region against the current workbook. Returns a
 * `RegionDrift` populated with the kinds observed, a `withinTolerance` flag
 * computed against the region's own drift knobs, and a pre-computed
 * severity/identityChanging pair inside `details` so `rollUpDrift` can
 * aggregate without needing region context.
 */
export function detectRegionDrift(region: Region, sheet: Sheet): RegionDrift {
  const bounds = resolveRegionBounds(region, sheet);
  const headers = resolveHeaders(region, sheet, bounds);
  const kinds: DriftKind[] = [];
  const detail: DriftDetail = {
    severity: "none",
    identityChanging: false,
    addedColumns: [],
    removedColumns: [],
    identityBlanks: 0,
    duplicateIdentityValues: 0,
  };

  // ── Removed columns ────────────────────────────────────────────────────
  for (const binding of region.columnBindings) {
    if (binding.sourceLocator.kind === "byHeaderName") {
      if (!headers.coordByLabel.has(binding.sourceLocator.name)) {
        detail.removedColumns.push(binding.sourceLocator.name);
      }
    }
  }
  if (detail.removedColumns.length > 0) kinds.push("removed-columns");

  // ── Added columns ──────────────────────────────────────────────────────
  if (headers.direction !== "none") {
    const boundNames = new Set(
      region.columnBindings
        .filter((b) => b.sourceLocator.kind === "byHeaderName")
        .map((b) =>
          b.sourceLocator.kind === "byHeaderName" ? b.sourceLocator.name : ""
        )
    );
    for (const label of headers.labels) {
      if (label === "") continue;
      if (!boundNames.has(label)) {
        detail.addedColumns.push(label);
      }
    }
    if (detail.addedColumns.length > 0) kinds.push("added-columns");
  }

  // ── Identity column checks (rows-as-records with column identity only) ─
  if (
    region.orientation === "rows-as-records" &&
    region.identityStrategy.kind === "column" &&
    region.identityStrategy.sourceLocator.kind === "column"
  ) {
    const idCol = region.identityStrategy.sourceLocator.col;
    const headerRow =
      headers.direction === "row" ? headers.index : bounds.startRow - 1;
    const seen = new Map<string, number>();
    for (let r = headerRow + 1; r <= bounds.endRow; r++) {
      const txt = cellText(sheet.cell(r, idCol));
      if (txt === "") {
        detail.identityBlanks++;
      } else {
        seen.set(txt, (seen.get(txt) ?? 0) + 1);
      }
    }
    let duplicates = 0;
    for (const count of seen.values()) {
      if (count > 1) duplicates += count - 1;
    }
    detail.duplicateIdentityValues = duplicates;
    if (detail.identityBlanks > 0) kinds.push("identity-column-has-blanks");
    if (duplicates > 0) kinds.push("duplicate-identity-values");
  }

  // ── Records-axis anchor rename (pivoted / crosstab regions) ────────────
  if (
    region.recordsAxisName &&
    region.recordsAxisName.source === "anchor-cell" &&
    region.axisAnchorCell
  ) {
    const anchorText = cellText(
      sheet.cell(region.axisAnchorCell.row, region.axisAnchorCell.col)
    );
    if (anchorText !== "" && anchorText !== region.recordsAxisName.name) {
      detail.renamedAnchor = {
        prior: region.recordsAxisName.name,
        current: anchorText,
      };
      kinds.push("records-axis-value-renamed");
    }
  }

  // ── Tolerance roll-up ──────────────────────────────────────────────────
  let withinTolerance = true;
  if (
    detail.addedColumns.length > 0 &&
    region.drift.addedColumns !== "auto-apply"
  ) {
    withinTolerance = false;
  }
  if (
    detail.removedColumns.length > 0 &&
    (detail.removedColumns.length > region.drift.removedColumns.max ||
      region.drift.removedColumns.action === "halt")
  ) {
    if (detail.removedColumns.length > region.drift.removedColumns.max) {
      withinTolerance = false;
    }
  }
  if (detail.identityBlanks > 0 || detail.duplicateIdentityValues > 0) {
    withinTolerance = false;
  }
  if (detail.renamedAnchor) {
    withinTolerance = false;
  }

  // Pre-compute severity + identityChanging at detect time so rollUpDrift
  // doesn't need the region context again.
  for (const kind of kinds) {
    detail.severity = maxSeverity(
      detail.severity,
      kindSeverity(kind, region, detail)
    );
    if (kindIsIdentityChanging(kind)) detail.identityChanging = true;
  }

  return {
    regionId: region.id,
    kinds,
    details: detail,
    withinTolerance,
  };
}

function kindIsIdentityChanging(kind: DriftKind): boolean {
  // Records-axis rename always changes identity (spec).
  if (kind === "records-axis-value-renamed") return true;
  if (kind === "duplicate-identity-values") return true;
  // Removed-columns only counts as identity-changing when it affects the
  // identity strategy's columns (not covered by the simple header diff here);
  // for Phase 5 we treat removed identity-column blanks as identity-changing
  // separately via `identity-column-has-blanks`.
  if (kind === "identity-column-has-blanks") return true;
  return false;
}

function kindSeverity(
  kind: DriftKind,
  region: Region | undefined,
  detail: DriftDetail | undefined
): Severity {
  const knob = region?.drift;
  if (kind === "added-columns") {
    return knob?.addedColumns === "auto-apply" ? "info" : "warn";
  }
  if (kind === "removed-columns") {
    const removedCount = detail?.removedColumns.length ?? 0;
    if (knob && removedCount > knob.removedColumns.max) return "blocker";
    return knob?.removedColumns.action === "auto-apply" ? "info" : "warn";
  }
  if (kind === "header-shifted") return "info";
  if (kind === "bounds-overflow") return "warn";
  if (kind === "records-axis-value-renamed") return "warn";
  if (kind === "identity-column-has-blanks") return "warn";
  if (kind === "duplicate-identity-values") return "blocker";
  return "info";
}

/**
 * Roll up per-region drifts into a plan-level `DriftReport`. Severity and
 * identityChanging are pre-computed at `detectRegionDrift()` time inside
 * `drift.details` so this function doesn't need region context.
 */
export function rollUpDrift(regionDrifts: RegionDrift[]): DriftReport {
  let severity: Severity = "none";
  let identityChanging = false;

  for (const rd of regionDrifts) {
    const detail = rd.details as DriftDetail | undefined;
    if (detail) {
      severity = maxSeverity(severity, detail.severity);
      if (detail.identityChanging) identityChanging = true;
      continue;
    }
    // Fallback for synthetic drifts built by tests without going through
    // `detectRegionDrift()` — use the kind's default severity.
    for (const kind of rd.kinds) {
      severity = maxSeverity(
        severity,
        kindSeverity(kind, undefined, undefined)
      );
      if (kindIsIdentityChanging(kind)) identityChanging = true;
    }
  }

  return {
    regionDrifts,
    severity,
    identityChanging,
  };
}
