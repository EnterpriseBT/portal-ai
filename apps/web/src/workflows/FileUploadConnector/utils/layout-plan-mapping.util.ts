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

function serializeLocator(locator: BackendLocator): string {
  switch (locator.kind) {
    case "byHeaderName":
      return `header:${locator.name}`;
    case "byColumnIndex":
      return `col:${locator.col}`;
    default: {
      const exhaustive: never = locator;
      throw new Error(`Unhandled locator kind: ${String(exhaustive)}`);
    }
  }
}

function bindingToDraft(binding: BackendBinding): ColumnBindingDraft {
  return {
    sourceLocator: serializeLocator(binding.sourceLocator),
    columnDefinitionId: binding.columnDefinitionId,
    confidence: binding.confidence,
    rationale: binding.rationale,
  };
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
      if (prior.boundsMode) merged.boundsMode = prior.boundsMode;
      if (prior.boundsPattern !== undefined) {
        merged.boundsPattern = prior.boundsPattern;
      }
      if (prior.untilEmptyTerminatorCount !== undefined) {
        merged.untilEmptyTerminatorCount = prior.untilEmptyTerminatorCount;
      }
      if (prior.columnOverrides) {
        merged.columnOverrides = { ...prior.columnOverrides };
      }
      if (prior.skipRules) {
        const mapped = prior.skipRules
          .map(draftSkipRuleToBackend)
          .filter((r): r is BackendSkipRule => r !== null);
        merged.skipRules = mapped;
      }
      return merged;
    }),
  };
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

    const hint: RegionHint = {
      sheet: sheet.name,
      bounds: {
        startRow: draft.bounds.startRow + 1,
        startCol: draft.bounds.startCol + 1,
        endRow: draft.bounds.endRow + 1,
        endCol: draft.bounds.endCol + 1,
      },
      targetEntityDefinitionId: draft.targetEntityDefinitionId,
      orientation: draft.orientation,
      headerAxis: draft.headerAxis,
    };

    if (draft.recordsAxisName?.name) {
      hint.recordsAxisName = draft.recordsAxisName.name;
    }
    if (draft.secondaryRecordsAxisName?.name) {
      hint.secondaryRecordsAxisName = draft.secondaryRecordsAxisName.name;
    }
    if (draft.cellValueName?.name) {
      hint.cellValueName = draft.cellValueName.name;
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

function regionId(region: BackendRegion, sheetId: string): string {
  const { startRow, startCol, endRow, endCol } = region.bounds;
  return `${sheetId}-r${startRow}_${startCol}_${endRow}_${endCol}`;
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
      id: regionId(region, sheet.id),
      sheetId: sheet.id,
      bounds: boundsToFrontend(region.bounds),
      orientation: region.orientation,
      headerAxis: region.headerAxis,
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

    if (region.recordsAxisName) {
      draft.recordsAxisName = region.recordsAxisName;
    }
    if (region.secondaryRecordsAxisName) {
      draft.secondaryRecordsAxisName = region.secondaryRecordsAxisName;
    }
    if (region.cellValueName) {
      draft.cellValueName = region.cellValueName;
    }
    if (region.axisAnchorCell) {
      draft.axisAnchorCell = {
        row: region.axisAnchorCell.row - 1,
        col: region.axisAnchorCell.col - 1,
      };
    }
    if (region.boundsMode) {
      draft.boundsMode = region.boundsMode;
    }
    if (region.boundsPattern !== undefined) {
      draft.boundsPattern = region.boundsPattern;
    }
    if (region.untilEmptyTerminatorCount !== undefined) {
      draft.untilEmptyTerminatorCount = region.untilEmptyTerminatorCount;
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
    if (region.headerStrategy) {
      draft.headerStrategy = {
        kind: region.headerStrategy.kind,
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
