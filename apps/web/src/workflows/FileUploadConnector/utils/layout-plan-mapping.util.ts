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

type BackendSegment = NonNullable<
  BackendRegion["segmentsByAxis"]
>["row"] extends (infer S)[] | undefined
  ? S
  : never;

type BackendSkipRule = BackendRegion["skipRules"][number];

/**
 * Re-apply the response's freshly-classified `columnDefinitionId` onto the
 * preserved prior segments. The prior draft holds the user's edits to
 * `axisName` / `axisNameSource` / `positionCount`, but its segment
 * `columnDefinitionId` is whatever the previous interpret call wrote (or
 * undefined for first-pass drafts) — re-interpret should land the latest
 * classifier output on the chip, not a stale value. Match by segment id;
 * unmatched prior segments keep their existing columnDefinitionId so user
 * overrides aren't lost when classify-logical-fields couldn't bind a
 * pivot.
 */
function adoptResponseSegmentBindings(
  prior: BackendSegment[] | undefined,
  fromResponse: BackendSegment[] | undefined
): BackendSegment[] | undefined {
  if (!prior) return prior;
  if (!fromResponse) return prior;
  const responseById = new Map(
    fromResponse
      .filter((s): s is Extract<BackendSegment, { kind: "pivot" }> =>
        s.kind === "pivot"
      )
      .map((s) => [s.id, s])
  );
  return prior.map((seg) => {
    if (seg.kind !== "pivot") return seg;
    const fresh = responseById.get(seg.id);
    if (!fresh || fresh.columnDefinitionId === undefined) return seg;
    return { ...seg, columnDefinitionId: fresh.columnDefinitionId };
  });
}

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
 * returned from `interpret()`. Preserves the user's segment edits
 * (headerAxes, segmentsByAxis, cellValueField, recordAxisTerminator) as well
 * as column-level overrides (skipRules, columnOverrides, columnBindings)
 * that the interpret response would otherwise clobber with defaults.
 * Matching follows `regionDraftsToHints` — drafts without a target entity
 * are dropped, and the remaining drafts line up with the plan's regions by
 * index.
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
      if (prior.headerAxes) {
        merged.headerAxes = [...prior.headerAxes];
      }
      if (prior.segmentsByAxis) {
        // Preserve the user's segment edits but adopt the response's
        // freshly-classified `columnDefinitionId` per pivot — those are
        // classifier output, not user knobs, and a re-interpret must
        // surface the latest binding on the review chip.
        merged.segmentsByAxis = {
          row: adoptResponseSegmentBindings(
            prior.segmentsByAxis.row,
            region.segmentsByAxis?.row
          ),
          column: adoptResponseSegmentBindings(
            prior.segmentsByAxis.column,
            region.segmentsByAxis?.column
          ),
        };
      }
      if (prior.cellValueField) {
        // Same idea for cellValueField: keep the user's name/nameSource,
        // but pick up the response's columnDefinitionId so the chip
        // reflects the freshly-classified binding (or text-fallback) rather
        // than a stale value from the prior draft.
        merged.cellValueField = {
          ...prior.cellValueField,
          ...(region.cellValueField?.columnDefinitionId !== undefined && {
            columnDefinitionId: region.cellValueField.columnDefinitionId,
          }),
        };
      }
      if (prior.recordAxisTerminator) {
        merged.recordAxisTerminator = prior.recordAxisTerminator;
      }
      if (prior.recordsAxis && merged.headerAxes.length === 0) {
        merged.recordsAxis = prior.recordsAxis;
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

    const headerAxes: BackendAxis[] = [...(draft.headerAxes ?? [])];

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

    const segmentsByAxis: RegionHint["segmentsByAxis"] = {};
    for (const axis of headerAxes) {
      const segs = draft.segmentsByAxis?.[axis];
      if (segs && segs.length > 0) {
        segmentsByAxis[axis] = segs;
      }
    }
    if (headerAxes.length > 0 && Object.keys(segmentsByAxis).length > 0) {
      hint.segmentsByAxis = segmentsByAxis;
    }
    if (headerAxes.length === 0) {
      hint.recordsAxis = draft.recordsAxis ?? "row";
    }

    if (draft.cellValueField?.name) {
      hint.cellValueField = {
        name: draft.cellValueField.name,
        nameSource: draft.cellValueField.nameSource,
      };
    }
    if (draft.recordAxisTerminator) {
      hint.recordAxisTerminator = draft.recordAxisTerminator;
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
      // overrides) into the commit payload.
      id: region.id,
      sheetId: sheet.id,
      bounds: boundsToFrontend(region.bounds),
      headerAxes: [...region.headerAxes],
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

    if (region.segmentsByAxis) {
      const segs: RegionDraft["segmentsByAxis"] = {};
      if (region.segmentsByAxis.row) {
        segs.row = region.segmentsByAxis.row;
      }
      if (region.segmentsByAxis.column) {
        segs.column = region.segmentsByAxis.column;
      }
      if (segs.row || segs.column) draft.segmentsByAxis = segs;
    }
    if (region.cellValueField) {
      draft.cellValueField = {
        name: region.cellValueField.name,
        nameSource: region.cellValueField.nameSource,
        ...(region.cellValueField.columnDefinitionId !== undefined && {
          columnDefinitionId: region.cellValueField.columnDefinitionId,
        }),
      };
    }
    if (region.recordAxisTerminator) {
      draft.recordAxisTerminator = region.recordAxisTerminator;
    }
    if (region.recordsAxis) {
      draft.recordsAxis = region.recordsAxis;
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
