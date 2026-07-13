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
  if (
    prior.columnDefinitionId &&
    prior.columnDefinitionId !== plan.columnDefinitionId
  ) {
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
      .filter(
        (s): s is Extract<BackendSegment, { kind: "pivot" }> =>
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
      if (prior.intersectionCellValueFields) {
        // Per-intersection cell-value names are user knobs (set in the
        // config panel) — keep the user's name/nameSource for each entry
        // and pick up the response's columnDefinitionId where the
        // classifier produced one. Entries the user dropped from the
        // prior draft do not reappear in the merged plan.
        const responseEntries = region.intersectionCellValueFields ?? {};
        const next: NonNullable<BackendRegion["intersectionCellValueFields"]> =
          {};
        for (const [id, priorField] of Object.entries(
          prior.intersectionCellValueFields
        )) {
          const fromResponse = responseEntries[id];
          next[id] = {
            ...priorField,
            ...(fromResponse?.columnDefinitionId !== undefined && {
              columnDefinitionId: fromResponse.columnDefinitionId,
            }),
          };
        }
        merged.intersectionCellValueFields = next;
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
    if (draft.intersectionCellValueFields) {
      // Mirror the panel-level per-intersection edits onto the hint so
      // re-interpret retains the user's chosen names. Each entry is a
      // full `CellValueField` (name + nameSource, plus optional
      // columnDefinitionId / excluded carried through).
      hint.intersectionCellValueFields = {};
      for (const [id, field] of Object.entries(
        draft.intersectionCellValueFields
      )) {
        hint.intersectionCellValueFields[id] = {
          name: field.name,
          nameSource: field.nameSource,
          ...(field.columnDefinitionId !== undefined && {
            columnDefinitionId: field.columnDefinitionId,
          }),
          ...(field.excluded !== undefined && {
            excluded: field.excluded,
          }),
        };
      }
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
    if (draft.identityStrategy?.source === "user") {
      // Only user-locked identities round-trip through the hint. A heuristic-
      // sourced strategy is omitted so interpret() re-detects against the
      // current workbook on every pass.
      const strat = draft.identityStrategy;
      if (strat.kind === "rowPosition") {
        hint.identityStrategy = {
          kind: "rowPosition",
          confidence: strat.confidence ?? 0,
          source: "user",
        };
      } else if (strat.kind === "column" && strat.rawLocator) {
        hint.identityStrategy = {
          kind: "column",
          sourceLocator: strat.rawLocator,
          confidence: strat.confidence ?? 0.7,
          source: "user",
        };
      }
      // Composite user-lock isn't user-constructable yet (Phase D limits the
      // override to single-locator + rowPosition); a heuristic-emitted
      // composite that gets locked falls back to skip — interpret() re-runs.
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
    if (region.intersectionCellValueFields) {
      const next: NonNullable<RegionDraft["intersectionCellValueFields"]> = {};
      for (const [id, field] of Object.entries(
        region.intersectionCellValueFields
      )) {
        next[id] = {
          name: field.name,
          nameSource: field.nameSource,
          ...(field.columnDefinitionId !== undefined && {
            columnDefinitionId: field.columnDefinitionId,
          }),
          ...(field.excluded !== undefined && { excluded: field.excluded }),
        };
      }
      draft.intersectionCellValueFields = next;
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
      // columnBindings. We preserve the structured locator on `rawLocator` so
      // `regionDraftsToHints` can round-trip a user-locked choice back into
      // the next interpret pass; the editor's decoration layer reads `kind`
      // for display.
      const draftIdentity: NonNullable<RegionDraft["identityStrategy"]> = {
        kind: region.identityStrategy.kind,
        source: region.identityStrategy.source ?? "heuristic",
        confidence: region.identityStrategy.confidence,
      };
      if (region.identityStrategy.kind === "column") {
        draftIdentity.rawLocator = region.identityStrategy.sourceLocator;
      }
      draft.identityStrategy = draftIdentity;
    }

    return draft;
  });
}

function boundsToBackend(
  bounds: RegionDraft["bounds"]
): BackendRegion["bounds"] {
  return {
    startRow: bounds.startRow + 1,
    endRow: bounds.endRow + 1,
    startCol: bounds.startCol + 1,
    endCol: bounds.endCol + 1,
  };
}

/**
 * Inverse of `serializeLocator`. Parses the opaque string back into the
 * structured `BindingSourceLocator` the backend stores in
 * `LayoutPlan.regions[*].columnBindings[*].sourceLocator`.
 *
 * Throws on malformed input rather than guessing — `draftsToRegions`
 * surfaces any failure to the caller (the Save Draft toast) instead of
 * silently shipping a wrong locator to PATCH.
 */
function deserializeLocator(serialized: string): BackendLocator {
  const [kindToken, axisToken, ...rest] = serialized.split(":");
  if (axisToken !== "row" && axisToken !== "column") {
    throw new Error(
      `deserializeLocator: invalid axis token in "${serialized}"`
    );
  }
  if (kindToken === "header") {
    const name = rest.join(":");
    if (name === "") {
      throw new Error(
        `deserializeLocator: missing header name in "${serialized}"`
      );
    }
    return { kind: "byHeaderName", axis: axisToken, name };
  }
  if (kindToken === "pos") {
    const indexRaw = rest.join(":");
    const index = Number.parseInt(indexRaw, 10);
    if (!Number.isInteger(index)) {
      throw new Error(
        `deserializeLocator: non-integer index in "${serialized}"`
      );
    }
    return { kind: "byPositionIndex", axis: axisToken, index };
  }
  throw new Error(`deserializeLocator: unknown kind token in "${serialized}"`);
}

function bindingDraftToBinding(
  draft: ColumnBindingDraft,
  priorByLocator: ReadonlyMap<string, BackendBinding>
): BackendBinding {
  const prior = priorByLocator.get(draft.sourceLocator);
  // `confidence` and `rationale` are LLM-emitted metadata on the prior
  // region — they're informational, not user-edited. Carry them across
  // a Save Draft so the next interpret pass and the review-step copy
  // stay coherent. For freshly-drawn bindings with no prior, fall back
  // to defaults that won't make the LayoutPlanSchema choke.
  const out: BackendBinding = {
    sourceLocator: deserializeLocator(draft.sourceLocator),
    columnDefinitionId: draft.columnDefinitionId,
    confidence: draft.confidence ?? prior?.confidence ?? 0,
    rationale: draft.rationale ?? prior?.rationale ?? "",
  };
  if (draft.excluded !== undefined) out.excluded = draft.excluded;
  if (draft.normalizedKey !== undefined)
    out.normalizedKey = draft.normalizedKey;
  if (draft.required !== undefined) out.required = draft.required;
  if (draft.defaultValue !== undefined) out.defaultValue = draft.defaultValue;
  if (draft.format !== undefined) out.format = draft.format;
  if (draft.enumValues !== undefined) out.enumValues = draft.enumValues;
  if (draft.refEntityKey !== undefined) out.refEntityKey = draft.refEntityKey;
  if (draft.refNormalizedKey !== undefined)
    out.refNormalizedKey = draft.refNormalizedKey;
  return out;
}

/**
 * Default drift knobs for freshly-drawn regions that don't have a
 * prior to inherit from. Mirrors what `LayoutPlanInterpretService.analyze`
 * emits today for any new region — every gate set to "halt" so the user
 * has to make an explicit choice before drift can auto-apply.
 */
const DEFAULT_DRIFT_KNOBS: BackendRegion["drift"] = {
  headerShiftRows: 0,
  addedColumns: "halt",
  removedColumns: { max: 0, action: "halt" },
};

/**
 * Pick the identity strategy for a saved region. The editor preserves
 * the structured locator on `rawLocator` (set by `planRegionsToDrafts`)
 * so a column-identity round-trips losslessly; for `rowPosition` no
 * locator is needed; for `composite` the editor doesn't compose new
 * strategies today, so we carry the prior verbatim. Drafts with no
 * strategy and no prior throw — `LayoutPlanSchema` requires every
 * region to have one.
 */
function resolveIdentityStrategy(
  draft: RegionDraft,
  prior: BackendRegion | undefined
): BackendRegion["identityStrategy"] {
  if (!draft.identityStrategy) {
    if (prior?.identityStrategy) return prior.identityStrategy;
    throw new Error(
      `draftsToRegions: region "${draft.id}" has no identity strategy — cannot save.`
    );
  }
  // `planRegionsToDrafts` defaults `draft.identityStrategy.source` to
  // `"heuristic"` when the persisted region didn't carry one. Don't
  // ship that default back to the backend — only forward `source`
  // when it's a user-set choice (i.e. the prior region actually had
  // a `source` field set, or the draft's source differs from the
  // forward-path default).
  const priorSource = prior?.identityStrategy?.source;
  const carrySource =
    (draft.identityStrategy.source !== undefined &&
      draft.identityStrategy.source !== "heuristic") ||
    priorSource !== undefined;
  const source = carrySource
    ? (draft.identityStrategy.source ?? priorSource)
    : undefined;

  if (draft.identityStrategy.kind === "column") {
    const priorLocator =
      prior?.identityStrategy?.kind === "column"
        ? prior.identityStrategy.sourceLocator
        : undefined;
    const sourceLocator = draft.identityStrategy.rawLocator ?? priorLocator;
    if (!sourceLocator) {
      throw new Error(
        `draftsToRegions: region "${draft.id}" has a column-identity strategy without a source locator — cannot save.`
      );
    }
    return {
      kind: "column",
      confidence: draft.identityStrategy.confidence ?? 0,
      sourceLocator,
      ...(source !== undefined && { source }),
    };
  }
  if (draft.identityStrategy.kind === "rowPosition") {
    return {
      kind: "rowPosition",
      confidence: draft.identityStrategy.confidence ?? 0,
      ...(source !== undefined && { source }),
    };
  }
  // `composite` — the editor doesn't compose new ones; carry the prior.
  if (prior?.identityStrategy) return prior.identityStrategy;
  throw new Error(
    `draftsToRegions: region "${draft.id}" has a composite identity strategy without a prior to inherit from — cannot save.`
  );
}

/**
 * Inverse of `planRegionsToDrafts`. Converts the editor-side
 * `RegionDraft[]` back to the persisted `LayoutPlan.regions[]` shape
 * the PATCH endpoint expects — bounds re-shifted to 1-based, locators
 * deserialized, axis-anchor cells re-shifted, etc.
 *
 * Fields the editor doesn't surface (drift knobs, header strategies,
 * region-level confidence breakdown, warnings) are carried over from
 * the matching region in `originalPlan` (by `id`) so a Save Draft only
 * changes the bits the user actually touched. Newly-drawn regions
 * with no prior fall back to minimal defaults; if those don't satisfy
 * the backend's `LayoutPlanSchema`, the route's 400 surfaces to the
 * caller through the normal error path.
 *
 * Throws on a draft without a `targetEntityDefinitionId` (the editor
 * lets the user defer the entity assignment while drawing; Save Draft
 * refuses to ship an unbound region — PATCH would reject it anyway).
 */
export function draftsToRegions(
  drafts: RegionDraft[],
  workbook: Workbook,
  originalPlan: Pick<LayoutPlan, "regions">
): BackendRegion[] {
  const { byId } = indexSheets(workbook);
  const originalById = new Map(
    originalPlan.regions.map((r) => [r.id, r] as const)
  );

  return drafts.map((draft) => {
    if (draft.targetEntityDefinitionId === null) {
      throw new Error(
        `draftsToRegions: region "${draft.id}" has no target entity — assign one before saving the plan.`
      );
    }
    const sheet = byId.get(draft.sheetId);
    if (!sheet) {
      throw new Error(
        `draftsToRegions: unknown sheetId "${draft.sheetId}" for region "${draft.id}"`
      );
    }
    const prior = originalById.get(draft.id);
    const priorBindingsByLocator = new Map<string, BackendBinding>(
      (prior?.columnBindings ?? []).map(
        (b) => [serializeLocator(b.sourceLocator), b] as const
      )
    );

    // Identity strategy must end up on the persisted region. If the
    // draft doesn't carry one and there's no prior to inherit from,
    // refuse to save — PATCH would reject the schema-invalid payload
    // anyway, but failing here gives a clearer error message.
    const identityStrategy = resolveIdentityStrategy(draft, prior);

    const region: BackendRegion = {
      id: draft.id,
      sheet: sheet.name,
      bounds: boundsToBackend(draft.bounds),
      targetEntityDefinitionId: draft.targetEntityDefinitionId,
      headerAxes: [...(draft.headerAxes ?? [])],
      identityStrategy,
      columnBindings: (draft.columnBindings ?? []).map((b) =>
        bindingDraftToBinding(b, priorBindingsByLocator)
      ),
      skipRules: (draft.skipRules ?? [])
        .filter(
          (rule) =>
            rule.kind === "blank" ||
            (typeof rule.crossAxisIndex === "number" &&
              typeof rule.pattern === "string")
        )
        .map((rule) =>
          rule.kind === "blank"
            ? { kind: "blank" as const }
            : {
                kind: "cellMatches" as const,
                crossAxisIndex: rule.crossAxisIndex as number,
                pattern: rule.pattern,
                ...(rule.axis ? { axis: rule.axis } : {}),
              }
        ),
      // Carry over interpret-emitted metadata that the editor doesn't
      // surface. Fresh-drawn regions (no prior) get minimal defaults.
      drift: prior?.drift ?? DEFAULT_DRIFT_KNOBS,
      confidence: prior?.confidence ?? {
        region: draft.confidence ?? 0,
        aggregate: draft.confidence ?? 0,
      },
      warnings: prior?.warnings ?? [],
      headerStrategyByAxis: prior?.headerStrategyByAxis ?? {},
    };

    if (draft.segmentsByAxis) {
      const segs: BackendRegion["segmentsByAxis"] = {};
      if (draft.segmentsByAxis.row) segs.row = draft.segmentsByAxis.row;
      if (draft.segmentsByAxis.column)
        segs.column = draft.segmentsByAxis.column;
      if (segs.row || segs.column) region.segmentsByAxis = segs;
    }
    if (draft.cellValueField) {
      region.cellValueField = {
        name: draft.cellValueField.name,
        nameSource: draft.cellValueField.nameSource,
        ...(draft.cellValueField.columnDefinitionId !== undefined && {
          columnDefinitionId: draft.cellValueField.columnDefinitionId,
        }),
      };
    }
    if (draft.intersectionCellValueFields) {
      const next: NonNullable<BackendRegion["intersectionCellValueFields"]> =
        {};
      for (const [id, field] of Object.entries(
        draft.intersectionCellValueFields
      )) {
        next[id] = {
          name: field.name,
          nameSource: field.nameSource,
          ...(field.columnDefinitionId !== undefined && {
            columnDefinitionId: field.columnDefinitionId,
          }),
          ...(field.excluded !== undefined && { excluded: field.excluded }),
        };
      }
      region.intersectionCellValueFields = next;
    }
    if (draft.recordAxisTerminator) {
      region.recordAxisTerminator = draft.recordAxisTerminator;
    }
    if (draft.recordsAxis) region.recordsAxis = draft.recordsAxis;
    if (draft.axisAnchorCell) {
      region.axisAnchorCell = {
        row: draft.axisAnchorCell.row + 1,
        col: draft.axisAnchorCell.col + 1,
      };
    }
    if (draft.columnOverrides) {
      region.columnOverrides = { ...draft.columnOverrides };
    }
    return region;
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
