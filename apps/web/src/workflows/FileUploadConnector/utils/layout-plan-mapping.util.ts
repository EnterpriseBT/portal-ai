import type {
  InterpretRequestBody,
  LayoutPlan,
  RegionHint,
  WorkbookData,
} from "@portalai/core/contracts";

import type {
  ColumnBindingDraft,
  EntityOption,
  RegionDraft,
  Workbook,
} from "../../../modules/RegionEditor";

type BackendRegion = LayoutPlan["regions"][number];
type BackendBinding = BackendRegion["columnBindings"][number];
type BackendLocator = BackendBinding["sourceLocator"];

type SheetIndex = {
  byId: Map<string, Workbook["sheets"][number]>;
  byName: Map<string, Workbook["sheets"][number]>;
};

function indexSheets(workbook: Workbook): SheetIndex {
  const byId = new Map<string, Workbook["sheets"][number]>();
  const byName = new Map<string, Workbook["sheets"][number]>();
  for (const sheet of workbook.sheets) {
    byId.set(sheet.id, sheet);
    byName.set(sheet.name, sheet);
  }
  return { byId, byName };
}

/**
 * Serialise a backend `BindingSourceLocator` to the opaque string form the
 * frontend uses for `ColumnBindingDraft.sourceLocator`. Exported so the
 * workflow hook can match drafts against plan bindings without duplicating
 * the format.
 */
export function serializeLocator(locator: BackendLocator): string {
  switch (locator.kind) {
    case "byHeaderName":
      return `header:${locator.axis}:${locator.name}`;
    case "byPositionIndex":
      return `pos:${locator.axis}:${locator.index}`;
    default: {
      const exhaustive: never = locator;
      throw new Error(`Unhandled locator kind: ${String(exhaustive)}`);
    }
  }
}

function bindingToDraft(binding: BackendBinding): ColumnBindingDraft {
  const draft: ColumnBindingDraft = {
    sourceLocator: serializeLocator(binding.sourceLocator),
    columnDefinitionId: binding.columnDefinitionId,
    confidence: binding.confidence,
    rationale: binding.rationale,
  };
  if (binding.excluded !== undefined) draft.excluded = binding.excluded;
  if (binding.normalizedKey !== undefined) {
    draft.normalizedKey = binding.normalizedKey;
  }
  if (binding.required !== undefined) draft.required = binding.required;
  if (binding.defaultValue !== undefined) {
    draft.defaultValue = binding.defaultValue;
  }
  if (binding.format !== undefined) draft.format = binding.format;
  if (binding.enumValues !== undefined) draft.enumValues = binding.enumValues;
  if (binding.refEntityKey !== undefined) {
    draft.refEntityKey = binding.refEntityKey;
  }
  if (binding.refNormalizedKey !== undefined) {
    draft.refNormalizedKey = binding.refNormalizedKey;
  }
  return draft;
}

/**
 * Merge user-set overrides from a prior `ColumnBindingDraft` onto the
 * interpret-returned `ColumnBinding`. The `columnDefinitionId` override wins
 * too — if the user rebound the column before Interpret, preserve it; the
 * classifier will otherwise pick its own answer on every run.
 */
function mergeBindingOverrides(
  plan: BackendBinding,
  prior: ColumnBindingDraft
): BackendBinding {
  const merged: BackendBinding = { ...plan };
  if (prior.columnDefinitionId && prior.columnDefinitionId !== plan.columnDefinitionId) {
    merged.columnDefinitionId = prior.columnDefinitionId;
  }
  if (prior.excluded !== undefined) merged.excluded = prior.excluded;
  if (prior.normalizedKey !== undefined) {
    merged.normalizedKey = prior.normalizedKey;
  }
  if (prior.required !== undefined) merged.required = prior.required;
  if (prior.defaultValue !== undefined) {
    merged.defaultValue = prior.defaultValue;
  }
  if (prior.format !== undefined) merged.format = prior.format;
  if (prior.enumValues !== undefined) merged.enumValues = prior.enumValues;
  if (prior.refEntityKey !== undefined) {
    merged.refEntityKey = prior.refEntityKey;
  }
  if (prior.refNormalizedKey !== undefined) {
    merged.refNormalizedKey = prior.refNormalizedKey;
  }
  return merged;
}

type BackendSkipRule = BackendRegion["skipRules"][number];

function draftSkipRuleToBackend(
  rule: NonNullable<RegionDraft["skipRules"]>[number]
): BackendSkipRule | null {
  if (rule.kind === "blank") return { kind: "blank" };
  // Drafts can hold an undefined crossAxisIndex while the user is mid-edit —
  // those rules are invalid for the backend and must be dropped, not coerced.
  if (rule.crossAxisIndex === undefined) return null;
  return {
    kind: "cellMatches",
    crossAxisIndex: rule.crossAxisIndex,
    pattern: rule.pattern,
    ...(rule.axis ? { axis: rule.axis } : {}),
  };
}

/**
 * Merge user-configured knobs from the prior draft list into a plan freshly
 * returned from `interpret()`. The interpret RPC today doesn't accept every
 * configuration field the user can tweak in the editor (boundsMode, skipRules,
 * …), so without this merge those selections would be clobbered by defaults on
 * every Interpret click. Matching follows `regionDraftsToHints` — drafts
 * without a target entity are dropped, and the remaining drafts line up with
 * the plan's regions by index.
 */
export function preserveUserRegionConfig(
  plan: LayoutPlan,
  priorDrafts: RegionDraft[]
): LayoutPlan {
  const considered = priorDrafts.filter(
    (d) => d.targetEntityDefinitionId !== null
  );
  if (considered.length === 0) return plan;

  return {
    ...plan,
    regions: plan.regions.map((region, i) => {
      const prior = considered[i];
      if (!prior) return region;
      const merged: BackendRegion = { ...region };
      // PR-1 stopgap: the draft still carries pre-schema knobs (`boundsMode`,
      // `boundsPattern`, `untilEmptyTerminatorCount`) that no longer exist on
      // the canonical Region. PR-4 reintroduces the same controls via the
      // `recordAxisTerminator` + dynamic-segment model; until then those user
      // tweaks are not round-tripped through Interpret.
      if (prior.columnOverrides) {
        merged.columnOverrides = { ...prior.columnOverrides };
      }
      if (prior.skipRules) {
        const mapped = prior.skipRules
          .map(draftSkipRuleToBackend)
          .filter((r): r is BackendSkipRule => r !== null);
        merged.skipRules = mapped;
      }
      if (prior.columnBindings && prior.columnBindings.length > 0) {
        const priorByLocator = new Map<string, ColumnBindingDraft>();
        for (const b of prior.columnBindings) {
          priorByLocator.set(b.sourceLocator, b);
        }
        merged.columnBindings = region.columnBindings.map((binding) => {
          const priorBinding = priorByLocator.get(
            serializeLocator(binding.sourceLocator)
          );
          return priorBinding
            ? mergeBindingOverrides(binding, priorBinding)
            : binding;
        });
      }
      return merged;
    }),
  };
}

type BackendAxis = "row" | "column";

function draftHeaderAxes(draft: RegionDraft): BackendAxis[] {
  if (draft.headerAxis === "none") return [];
  if (draft.orientation === "cells-as-records") return ["row", "column"];
  return [draft.headerAxis];
}

export function regionDraftsToHints(
  workbook: Workbook,
  drafts: RegionDraft[]
): RegionHint[] {
  if (drafts.length === 0) return [];
  const { byId } = indexSheets(workbook);

  const hints: RegionHint[] = [];
  for (const draft of drafts) {
    if (draft.targetEntityDefinitionId === null) continue;
    const sheet = byId.get(draft.sheetId);
    if (!sheet) {
      throw new Error(
        `regionDraftsToHints: unknown sheetId "${draft.sheetId}"`
      );
    }

    const headerAxes = draftHeaderAxes(draft);
    const rowSpan = draft.bounds.endCol - draft.bounds.startCol + 1;
    const colSpan = draft.bounds.endRow - draft.bounds.startRow + 1;

    // PR-1 stopgap: the editor doesn't yet know about segments, so every
    // declared axis gets a single field segment spanning its full extent.
    // PR-4 will teach the editor to author pivot segments directly.
    const segmentsByAxis: RegionHint["segmentsByAxis"] = {};
    for (const axis of headerAxes) {
      const positionCount = axis === "row" ? rowSpan : colSpan;
      segmentsByAxis[axis] = [{ kind: "field", positionCount }];
    }

    const hint: RegionHint = {
      sheet: sheet.name,
      bounds: {
        startRow: draft.bounds.startRow + 1,
        startCol: draft.bounds.startCol + 1,
        endRow: draft.bounds.endRow + 1,
        endCol: draft.bounds.endCol + 1,
      },
      targetEntityDefinitionId: draft.targetEntityDefinitionId,
      headerAxes,
    };
    if (headerAxes.length > 0) {
      hint.segmentsByAxis = segmentsByAxis;
    }
    if (headerAxes.length === 0) {
      hint.recordsAxis =
        draft.orientation === "columns-as-records" ? "column" : "row";
    }

    if (draft.cellValueName?.name && draft.cellValueName.source === "user") {
      hint.cellValueField = {
        name: draft.cellValueName.name,
        nameSource: "user",
      };
    }
    if (draft.axisAnchorCell) {
      hint.axisAnchorCell = {
        row: draft.axisAnchorCell.row + 1,
        col: draft.axisAnchorCell.col + 1,
      };
    }
    if (draft.proposedLabel !== undefined) {
      hint.proposedLabel = draft.proposedLabel;
    }

    hints.push(hint);
  }

  return hints;
}

function boundsToFrontend(
  bounds: BackendRegion["bounds"]
): RegionDraft["bounds"] {
  return {
    startRow: bounds.startRow - 1,
    endRow: bounds.endRow - 1,
    startCol: bounds.startCol - 1,
    endCol: bounds.endCol - 1,
  };
}

function regionToDraftOrientation(
  region: BackendRegion
): RegionDraft["orientation"] {
  if (region.headerAxes.length === 2) return "cells-as-records";
  if (region.headerAxes.length === 0) {
    return region.recordsAxis === "column"
      ? "columns-as-records"
      : "rows-as-records";
  }
  return region.headerAxes[0] === "column"
    ? "columns-as-records"
    : "rows-as-records";
}

function regionToDraftHeaderAxis(
  region: BackendRegion
): RegionDraft["headerAxis"] {
  if (region.headerAxes.length === 0) return "none";
  // PR-1 stopgap: a pre-PR `headerAxis` enum only had a single value, so
  // crosstabs pick the row axis as the primary. PR-4 reworks the editor
  // around `headerAxes` directly and removes this collapse.
  return region.headerAxes.includes("row") ? "row" : "column";
}

function firstPivotAxisName(
  region: BackendRegion,
  axis: BackendAxis
): { name: string; source: "user" | "ai" | "anchor-cell" } | undefined {
  const segments = region.segmentsByAxis?.[axis];
  if (!segments) return undefined;
  for (const seg of segments) {
    if (seg.kind === "pivot") {
      return { name: seg.axisName, source: seg.axisNameSource };
    }
  }
  return undefined;
}

export function planRegionsToDrafts(
  plan: Pick<LayoutPlan, "regions" | "confidence">,
  workbook: Workbook
): RegionDraft[] {
  const { byName } = indexSheets(workbook);

  return plan.regions.map((region) => {
    const sheet = byName.get(region.sheet);
    if (!sheet) {
      throw new Error(
        `planRegionsToDrafts: unknown sheet name "${region.sheet}"`
      );
    }

    const draft: RegionDraft = {
      // Reuse the plan region's id so `state.regions[i].id` matches
      // `state.plan.regions[j].id` — the workflow hook's `patchBinding`
      // relies on this match to mirror per-binding edits (Omit, rebind,
      // overrides) into the commit payload. Without it, toggling Omit
      // updates only the draft, the plan still ships `excluded: undefined`,
      // and the backend rejects with `LAYOUT_PLAN_INVALID_REFERENCE` for
      // reference-typed bindings the user meant to drop.
      id: region.id,
      sheetId: sheet.id,
      bounds: boundsToFrontend(region.bounds),
      orientation: regionToDraftOrientation(region),
      headerAxis: regionToDraftHeaderAxis(region),
      targetEntityDefinitionId: region.targetEntityDefinitionId,
      columnBindings: region.columnBindings.map(bindingToDraft),
      confidence: region.confidence.aggregate,
      warnings: region.warnings.map((w) => ({
        code: w.code,
        severity: w.severity,
        message: w.message,
        suggestedFix: w.suggestedFix,
      })),
    };

    // PR-1 stopgap: the editor still displays "records axis name" fields per
    // the pre-PR UI. Map each axis's first pivot segment into the legacy
    // slot so labels keep rendering; PR-4 replaces the UI with a per-segment
    // editor driven directly by `segmentsByAxis`.
    const rowAxisName = firstPivotAxisName(region, "row");
    const colAxisName = firstPivotAxisName(region, "column");
    if (rowAxisName) draft.recordsAxisName = rowAxisName;
    if (colAxisName) {
      if (draft.recordsAxisName) {
        draft.secondaryRecordsAxisName = colAxisName;
      } else {
        draft.recordsAxisName = colAxisName;
      }
    }
    if (region.cellValueField) {
      draft.cellValueName = {
        name: region.cellValueField.name,
        source: region.cellValueField.nameSource,
      };
    }
    if (region.axisAnchorCell) {
      draft.axisAnchorCell = {
        row: region.axisAnchorCell.row - 1,
        col: region.axisAnchorCell.col - 1,
      };
    }
    if (region.columnOverrides) {
      draft.columnOverrides = { ...region.columnOverrides };
    }
    if (region.skipRules.length > 0) {
      draft.skipRules = region.skipRules.map((rule) =>
        rule.kind === "blank"
          ? { kind: "blank" as const }
          : {
              kind: "cellMatches" as const,
              crossAxisIndex: rule.crossAxisIndex,
              pattern: rule.pattern,
              ...(rule.axis ? { axis: rule.axis } : {}),
            }
      );
    }
    const headerStrategy =
      region.headerStrategyByAxis?.row ?? region.headerStrategyByAxis?.column;
    if (headerStrategy) {
      draft.headerStrategy = {
        kind: headerStrategy.kind,
      };
    }
    if (region.identityStrategy) {
      // The backend's identityStrategy locator is a Locator union (cell/range/
      // column/row) whose shape differs from the BindingSourceLocator used by
      // columnBindings. The frontend only needs `kind` + an opaque display
      // string for the decoration layer, so we skip locator serialization for
      // now; `onEditBinding` will synthesise the richer editor when it lands.
      draft.identityStrategy = {
        kind: region.identityStrategy.kind,
      };
    }

    return draft;
  });
}

export function overallConfidenceFromPlan(
  plan: Pick<LayoutPlan, "confidence">
): number {
  return plan.confidence.overall;
}

/**
 * Derive entity-picker options from the parsed workbook. The FileUpload
 * connector always creates a brand-new ConnectorInstance, so there are no
 * pre-existing DB-backed entities to choose from — every option is staged
 * with the sheet name as its label and the sheet id as its value. The
 * region-binding step then assigns one entity per sheet by default while
 * still letting users redirect a region to a different sheet's entity.
 */
export function entityOptionsFromWorkbook(
  workbook: Workbook | null
): EntityOption[] {
  if (!workbook) return [];
  return workbook.sheets.map((sheet) => ({
    value: sheet.id,
    label: sheet.name,
    source: "staged" as const,
  }));
}

/**
 * Merge sheet-derived options with user-staged extras. Staged entries that
 * collide on `value` with a sheet option are dropped — sheet-derived options
 * win because the sheet ids are stable across re-parses while the user's
 * arbitrary key may overlap accidentally. Order: sheet options first, then
 * staged extras in insertion order.
 */
export function mergeStagedEntityOptions(
  sheetOptions: EntityOption[],
  stagedExtras: EntityOption[]
): EntityOption[] {
  const taken = new Set(sheetOptions.map((o) => o.value));
  const extras = stagedExtras.filter((s) => !taken.has(s.value));
  return [...sheetOptions, ...extras];
}

export function workbookToBackend(
  workbook: Workbook
): InterpretRequestBody["workbook"] {
  const sheets: WorkbookData["sheets"] = workbook.sheets.map((sheet) => {
    const cells: WorkbookData["sheets"][number]["cells"] = [];
    for (let r = 0; r < sheet.cells.length; r++) {
      const row = sheet.cells[r];
      for (let c = 0; c < row.length; c++) {
        const value = row[c];
        if (value === null || value === "") continue;
        cells.push({ row: r + 1, col: c + 1, value });
      }
    }
    return {
      name: sheet.name,
      dimensions: { rows: sheet.rowCount, cols: sheet.colCount },
      cells,
    };
  });
  return { sheets };
}
