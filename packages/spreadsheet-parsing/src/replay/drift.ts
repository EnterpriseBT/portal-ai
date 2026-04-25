import {
  recordsAxisOf,
  type DriftKind,
  type DriftReport,
  type Region,
  type RegionDrift,
  type Segment,
} from "../plan/index.js";
import type { Sheet, WorkbookCell } from "../workbook/types.js";
import { resolveHeaders, type HeaderLayout } from "./resolve-headers.js";
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

function firstHeaderLayout(
  region: Region,
  sheet: Sheet,
  bounds: { startRow: number; startCol: number; endRow: number; endCol: number }
): HeaderLayout | undefined {
  for (const axis of region.headerAxes) {
    const layout = resolveHeaders(region, axis, sheet, bounds);
    if (layout) return layout;
  }
  return undefined;
}

function pivotSegmentsWithAnchor(region: Region): Segment[] {
  const out: Segment[] = [];
  for (const axis of ["row", "column"] as const) {
    for (const seg of region.segmentsByAxis?.[axis] ?? []) {
      if (seg.kind === "pivot" && seg.axisNameSource === "anchor-cell") {
        out.push(seg);
      }
    }
  }
  return out;
}

/**
 * Walk the segments along `axis` and emit, for each header position, the
 * `kind` of segment it lives in (`"field"` | `"pivot"` | `"skip"`). Caller
 * walks `header.labels` in lockstep — index `i` of the labels array
 * corresponds to the i-th position covered by `segmentKindByHeaderIndex`.
 *
 * Used by the addedColumns drift gate: only `field`-segment positions
 * count as "static columns the user has bound by name". Pivot positions
 * are expected to vary across syncs (within `positionCount` limits) and
 * skip positions are explicitly opt-out, so neither should trigger an
 * `added-columns` drift signal.
 */
function segmentKindByHeaderIndex(
  region: Region,
  axis: "row" | "column"
): Segment["kind"][] {
  const out: Segment["kind"][] = [];
  for (const seg of region.segmentsByAxis?.[axis] ?? []) {
    for (let i = 0; i < seg.positionCount; i++) {
      out.push(seg.kind);
    }
  }
  return out;
}

/**
 * Evaluate drift for a single region against the current workbook.
 */
export function detectRegionDrift(region: Region, sheet: Sheet): RegionDrift {
  const bounds = resolveRegionBounds(region, sheet);
  const header = firstHeaderLayout(region, sheet, bounds);
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
      const axisHeader = resolveHeaders(
        region,
        binding.sourceLocator.axis,
        sheet,
        bounds
      );
      if (
        !axisHeader ||
        !axisHeader.coordByLabel.has(binding.sourceLocator.name)
      ) {
        detail.removedColumns.push(binding.sourceLocator.name);
      }
    }
  }
  if (detail.removedColumns.length > 0) kinds.push("removed-columns");

  // ── Added columns ──────────────────────────────────────────────────────
  if (header) {
    const boundNames = new Set(
      region.columnBindings
        .filter(
          (b) =>
            b.sourceLocator.kind === "byHeaderName" &&
            b.sourceLocator.axis === header.axis
        )
        .map((b) =>
          b.sourceLocator.kind === "byHeaderName" ? b.sourceLocator.name : ""
        )
    );
    // Only positions inside a `kind: "field"` segment count for the
    // addedColumns gate — pivot positions are expected to vary across
    // syncs (their axisName is the binding, not the per-position label),
    // and skip positions are opt-out by definition. Falling back to
    // checking every label would (and previously did) flag every pivot
    // header value as an "added column", making any pivot region
    // un-committable without an `addedColumns: "auto-apply"` workaround.
    const kindByIndex = segmentKindByHeaderIndex(region, header.axis);
    for (let i = 0; i < header.labels.length; i++) {
      const label = header.labels[i];
      if (label === "") continue;
      if (kindByIndex[i] !== "field") continue;
      if (!boundNames.has(label)) {
        detail.addedColumns.push(label);
      }
    }
    if (detail.addedColumns.length > 0) kinds.push("added-columns");
  }

  // ── Identity column checks (records-are-rows with column identity only) ─
  const recAxis = recordsAxisOf(region);
  if (
    recAxis === "row" &&
    region.identityStrategy.kind === "column" &&
    region.identityStrategy.sourceLocator.kind === "column"
  ) {
    const idCol = region.identityStrategy.sourceLocator.col;
    const headerRow =
      header?.axis === "row" ? header.index : bounds.startRow - 1;
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

  // ── Records-axis anchor rename (pivoted regions with anchor-cell source) ─
  if (region.axisAnchorCell) {
    const anchorText = cellText(
      sheet.cell(region.axisAnchorCell.row, region.axisAnchorCell.col)
    );
    for (const seg of pivotSegmentsWithAnchor(region)) {
      if (seg.kind !== "pivot") continue;
      if (anchorText !== "" && anchorText !== seg.axisName) {
        detail.renamedAnchor = {
          prior: seg.axisName,
          current: anchorText,
        };
        kinds.push("records-axis-value-renamed");
        break;
      }
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
  if (kind === "records-axis-value-renamed") return true;
  if (kind === "duplicate-identity-values") return true;
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
