/**
 * Spreadsheet-connector workflow state machine.
 *
 * Shared by every connector whose import flow ends in a `Workbook` →
 * `RegionEditor` → `LayoutPlan` pipeline:
 *
 *   - `useFileUploadWorkflow`    (FileUpload, .csv/.xlsx)
 *   - `useGoogleSheetsWorkflow`  (GoogleSheets)
 *   - `useExcelCloudWorkflow`    (Microsoft Excel cloud — next)
 *
 * The shared core owns the post-workbook lifecycle:
 *
 *   pending  → setWorkbook(workbook, sourceSessionId) →  draw  → onInterpret → review → onCommit
 *
 * Wrappers add their own pre-workbook stage (file upload / OAuth + select)
 * and call `setWorkbook(...)` once they have a `Workbook` ready. Everything
 * downstream — region drafting, binding patches, interpret/commit — is
 * shared.
 *
 * **Not for non-spreadsheet connectors.** SQL / API / event-stream
 * connectors do not have workbooks, regions, or LayoutPlans. They get
 * their own peer hook (e.g. `_shared/sql/use-sql-connector-workflow.util.ts`)
 * with a different state shape; do not bend this hook to fit them.
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-C.plan.md` §Slice 7.
 */

import { useCallback, useRef, useState } from "react";

import type { LayoutPlan } from "@portalai/core/contracts";

import type {
  CellBounds,
  ColumnBindingDraft,
  RegionDraft,
  Workbook,
} from "../../../modules/RegionEditor";
import { ApiError } from "../../../utils/api.util";
import type { ServerError } from "../../../utils/api.util";
import { serializeLocator } from "../../FileUploadConnector/utils/layout-plan-mapping.util";

// ── Shared types ────────────────────────────────────────────────────

export type SpreadsheetWorkflowPhase = "pending" | "draw" | "review";

export interface SpreadsheetWorkflowState {
  phase: SpreadsheetWorkflowPhase;
  workbook: Workbook | null;
  /**
   * Opaque session handle the wrapper supplied alongside the workbook
   * (`uploadSessionId` for file-upload, `connectorInstanceId` for
   * google-sheets). Held so `interpret`/`commit` callbacks can resolve
   * the workbook from the server cache without sending it inline.
   */
  sourceSessionId: string | null;
  regions: RegionDraft[];
  selectedRegionId: string | null;
  activeSheetId: string | null;
  serverError: ServerError | null;
  isInterpreting: boolean;
  isCommitting: boolean;
  plan: LayoutPlan | null;
  overallConfidence?: number;
}

export interface SpreadsheetWorkflowCallbacks {
  /**
   * Pure-compute interpret — server must NOT persist anything. The
   * returned `plan` is held in memory until commit.
   */
  runInterpret: (regions: RegionDraft[]) => Promise<{
    regions: RegionDraft[];
    plan: LayoutPlan;
    overallConfidence: number;
  }>;
  /**
   * Atomic commit — server creates the ConnectorInstance (or finalizes
   * the pending one), persists the plan, and writes records in one
   * call. On any failure past the instance insert, both rows roll back.
   */
  runCommit: (
    plan: LayoutPlan
  ) => Promise<{ connectorInstanceId: string }>;
  onCommitSuccess?: (connectorInstanceId: string) => void;
}

export interface UseSpreadsheetWorkflowReturn extends SpreadsheetWorkflowState {
  setWorkbook: (workbook: Workbook, sourceSessionId: string | null) => void;
  setServerError: (err: ServerError | null) => void;

  onActiveSheetChange: (sheetId: string) => void;
  onSelectRegion: (regionId: string | null) => void;
  onRegionDraft: (draft: { sheetId: string; bounds: CellBounds }) => void;
  onRegionUpdate: (regionId: string, updates: Partial<RegionDraft>) => void;
  onRegionDelete: (regionId: string) => void;
  onJumpToRegion: (regionId: string) => void;
  onUpdateBinding: (
    regionId: string,
    sourceLocator: string,
    patch: Partial<ColumnBindingDraft>
  ) => void;
  onToggleBindingExcluded: (
    regionId: string,
    sourceLocator: string,
    excluded: boolean
  ) => void;
  onInterpret: () => Promise<void>;
  onSkipToReview: () => void;
  onCommit: () => Promise<void>;
  goBack: () => void;
  reset: () => void;

  /**
   * Claim a fresh run token. Wrappers driving async pre-workbook flows
   * (parseFile, selectSheet, …) call this before the network call and
   * check against `currentRunToken()` before committing state, so a
   * reset mid-flight doesn't resurrect stale state.
   */
  claimRunToken: () => number;
  /** Read-only view of the current run token. */
  currentRunToken: () => number;
}

const EMPTY_STATE: SpreadsheetWorkflowState = {
  phase: "pending",
  workbook: null,
  sourceSessionId: null,
  regions: [],
  selectedRegionId: null,
  activeSheetId: null,
  serverError: null,
  isInterpreting: false,
  isCommitting: false,
  plan: null,
};

export function mintRegionId(sheetId: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${sheetId}-r${suffix}`;
}

export function toServerErrorFromUnknown(err: unknown): ServerError {
  if (err instanceof ApiError) {
    return { message: err.message, code: err.code || "UNKNOWN_CODE" };
  }
  if (err instanceof Error) {
    return { message: err.message, code: "UNKNOWN_ERROR" };
  }
  return { message: "Unknown error", code: "UNKNOWN_ERROR" };
}

// ── Binding patch helpers (generic over `{ regions, plan }`) ────────

/**
 * Fields shared between the frontend `ColumnBindingDraft` and the backend
 * `ColumnBinding`. `patchBinding` filters incoming patches against this
 * allowlist before mirroring into `state.plan` so frontend-only fields
 * never leak into the commit payload.
 */
const PLAN_MIRROR_KEYS = [
  "columnDefinitionId",
  "excluded",
  "normalizedKey",
  "required",
  "defaultValue",
  "format",
  "enumValues",
  "refEntityKey",
  "refNormalizedKey",
  "confidence",
  "rationale",
] as const;

function toPlanPatch(
  patch: Partial<ColumnBindingDraft>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PLAN_MIRROR_KEYS) {
    if (key in patch) {
      out[key] = (patch as Record<string, unknown>)[key];
    }
  }
  return out;
}

const SYNTHETIC_PATCH_KEYS = [
  "columnDefinitionId",
  "excluded",
  "sourceField",
] as const;
type SyntheticPatchKey = (typeof SYNTHETIC_PATCH_KEYS)[number];

function pickSyntheticPatch(
  patch: Partial<ColumnBindingDraft>
): Partial<Pick<ColumnBindingDraft, SyntheticPatchKey>> | null {
  const out: Partial<Pick<ColumnBindingDraft, SyntheticPatchKey>> = {};
  let touched = false;
  for (const key of SYNTHETIC_PATCH_KEYS) {
    if (key in patch) {
      (out as Record<string, unknown>)[key] = (
        patch as Record<string, unknown>
      )[key];
      touched = true;
    }
  }
  return touched ? out : null;
}

function applyPivotFields<
  S extends {
    kind: "pivot";
    axisName: string;
    axisNameSource: "user" | "ai" | "anchor-cell";
    columnDefinitionId?: string;
    excluded?: boolean;
  },
>(seg: S, patch: Partial<Pick<ColumnBindingDraft, SyntheticPatchKey>>): S {
  const next: S = { ...seg };
  if ("columnDefinitionId" in patch) {
    next.columnDefinitionId = patch.columnDefinitionId ?? undefined;
  }
  if ("excluded" in patch) {
    next.excluded = patch.excluded ?? undefined;
  }
  if (patch.sourceField !== undefined && patch.sourceField !== "") {
    next.axisName = patch.sourceField;
    next.axisNameSource = "user";
  }
  return next;
}

function applyCellValueFields<
  C extends {
    name: string;
    nameSource: "user" | "ai" | "anchor-cell";
    columnDefinitionId?: string;
    excluded?: boolean;
  },
>(field: C, patch: Partial<Pick<ColumnBindingDraft, SyntheticPatchKey>>): C {
  const next: C = { ...field };
  if ("columnDefinitionId" in patch) {
    next.columnDefinitionId = patch.columnDefinitionId ?? undefined;
  }
  if ("excluded" in patch) {
    next.excluded = patch.excluded ?? undefined;
  }
  if (patch.sourceField !== undefined && patch.sourceField !== "") {
    next.name = patch.sourceField;
    next.nameSource = "user";
  }
  return next;
}

/** Generic state shape that the binding-patch helpers operate on. */
type BindingPatchableState = {
  regions: RegionDraft[];
  plan: LayoutPlan | null;
};

function patchPivotSegmentBinding<S extends BindingPatchableState>(
  prev: S,
  regionId: string,
  segmentId: string,
  patch: Partial<ColumnBindingDraft>
): S {
  const synthetic = pickSyntheticPatch(patch);
  if (!synthetic) return prev;

  type DraftSegments = NonNullable<RegionDraft["segmentsByAxis"]>;
  type DraftSegment = NonNullable<DraftSegments["row"]>[number];
  const remapDraft = (
    segs: DraftSegment[] | undefined
  ): { next: DraftSegment[] | undefined; touched: boolean } => {
    if (!segs) return { next: segs, touched: false };
    let touched = false;
    const next = segs.map((s) => {
      if (s.kind !== "pivot" || s.id !== segmentId) return s;
      touched = true;
      return applyPivotFields(s, synthetic);
    });
    return { next, touched };
  };

  let regionTouched = false;
  const nextRegions = prev.regions.map((r) => {
    if (r.id !== regionId) return r;
    const row = remapDraft(r.segmentsByAxis?.row);
    const column = remapDraft(r.segmentsByAxis?.column);
    if (!row.touched && !column.touched) return r;
    regionTouched = true;
    return {
      ...r,
      segmentsByAxis: {
        ...r.segmentsByAxis,
        row: row.next,
        column: column.next,
      },
    };
  });
  if (!regionTouched) return prev;

  let nextPlan = prev.plan;
  if (prev.plan) {
    type PlanRegion = LayoutPlan["regions"][number];
    type PlanSegments = NonNullable<PlanRegion["segmentsByAxis"]>;
    type PlanSegment = NonNullable<PlanSegments["row"]>[number];
    const remapPlan = (segs: PlanSegment[] | undefined): PlanSegment[] | undefined => {
      if (!segs) return segs;
      return segs.map((s) =>
        s.kind === "pivot" && s.id === segmentId
          ? applyPivotFields(s, synthetic)
          : s
      );
    };
    nextPlan = {
      ...prev.plan,
      regions: prev.plan.regions.map((planRegion) => {
        if (planRegion.id !== regionId) return planRegion;
        const row = remapPlan(planRegion.segmentsByAxis?.row);
        const column = remapPlan(planRegion.segmentsByAxis?.column);
        return {
          ...planRegion,
          segmentsByAxis: {
            ...planRegion.segmentsByAxis,
            row,
            column,
          },
        };
      }),
    };
  }
  return { ...prev, regions: nextRegions, plan: nextPlan };
}

function patchIntersectionCellValueField<S extends BindingPatchableState>(
  prev: S,
  regionId: string,
  intersectionId: string,
  patch: Partial<ColumnBindingDraft>
): S {
  const synthetic = pickSyntheticPatch(patch);
  if (!synthetic) return prev;

  let regionTouched = false;
  const nextRegions = prev.regions.map((r) => {
    if (r.id !== regionId) return r;
    const prior = r.intersectionCellValueFields?.[intersectionId];
    if (!prior) return r;
    regionTouched = true;
    return {
      ...r,
      intersectionCellValueFields: {
        ...r.intersectionCellValueFields,
        [intersectionId]: applyCellValueFields(prior, synthetic),
      },
    };
  });
  if (!regionTouched) return prev;

  let nextPlan = prev.plan;
  if (prev.plan) {
    nextPlan = {
      ...prev.plan,
      regions: prev.plan.regions.map((planRegion) => {
        if (planRegion.id !== regionId) return planRegion;
        const prior =
          planRegion.intersectionCellValueFields?.[intersectionId];
        if (!prior) return planRegion;
        return {
          ...planRegion,
          intersectionCellValueFields: {
            ...planRegion.intersectionCellValueFields,
            [intersectionId]: applyCellValueFields(prior, synthetic),
          },
        };
      }),
    };
  }
  return { ...prev, regions: nextRegions, plan: nextPlan };
}

function patchCellValueFieldBinding<S extends BindingPatchableState>(
  prev: S,
  regionId: string,
  patch: Partial<ColumnBindingDraft>
): S {
  const synthetic = pickSyntheticPatch(patch);
  if (!synthetic) return prev;

  let regionTouched = false;
  const nextRegions = prev.regions.map((r) => {
    if (r.id !== regionId || !r.cellValueField) return r;
    regionTouched = true;
    return { ...r, cellValueField: applyCellValueFields(r.cellValueField, synthetic) };
  });
  if (!regionTouched) return prev;

  let nextPlan = prev.plan;
  if (prev.plan) {
    nextPlan = {
      ...prev.plan,
      regions: prev.plan.regions.map((planRegion) => {
        if (planRegion.id !== regionId || !planRegion.cellValueField) {
          return planRegion;
        }
        return {
          ...planRegion,
          cellValueField: applyCellValueFields(
            planRegion.cellValueField,
            synthetic
          ),
        };
      }),
    };
  }
  return { ...prev, regions: nextRegions, plan: nextPlan };
}

/**
 * The binding-patch dispatcher: routes a patch on a given (regionId,
 * sourceLocator) to the right helper depending on the locator's shape
 * (synthetic chips for pivot/cellValueField/intersection vs. ordinary
 * column bindings).
 */
export function patchBinding<S extends BindingPatchableState>(
  prev: S,
  regionId: string,
  sourceLocator: string,
  patch: Partial<ColumnBindingDraft>
): S {
  const region = prev.regions.find((r) => r.id === regionId);
  if (!region) return prev;

  if (sourceLocator === "cellValueField") {
    return patchCellValueFieldBinding(prev, regionId, patch);
  }
  if (sourceLocator.startsWith("pivot:")) {
    return patchPivotSegmentBinding(
      prev,
      regionId,
      sourceLocator.slice("pivot:".length),
      patch
    );
  }
  if (sourceLocator.startsWith("intersection:")) {
    return patchIntersectionCellValueField(
      prev,
      regionId,
      sourceLocator.slice("intersection:".length),
      patch
    );
  }

  const existingBindings = region.columnBindings ?? [];
  const bindingIndex = existingBindings.findIndex(
    (b) => b.sourceLocator === sourceLocator
  );
  if (bindingIndex === -1) return prev;

  const nextBindings: ColumnBindingDraft[] = existingBindings.map((b, i) =>
    i === bindingIndex ? { ...b, ...patch } : b
  );
  const nextRegions = prev.regions.map((r) =>
    r.id === regionId ? { ...r, columnBindings: nextBindings } : r
  );

  let nextPlan = prev.plan;
  if (prev.plan) {
    const planPatch = toPlanPatch(patch);
    nextPlan = {
      ...prev.plan,
      regions: prev.plan.regions.map((planRegion) => {
        if (planRegion.id !== regionId) return planRegion;
        return {
          ...planRegion,
          columnBindings: planRegion.columnBindings.map((pb) =>
            serializeLocator(pb.sourceLocator) === sourceLocator
              ? { ...pb, ...planPatch }
              : pb
          ),
        };
      }),
    };
  }
  return { ...prev, regions: nextRegions, plan: nextPlan };
}

// ── The shared hook ─────────────────────────────────────────────────

export function useSpreadsheetWorkflow(
  callbacks: SpreadsheetWorkflowCallbacks
): UseSpreadsheetWorkflowReturn {
  const [state, setState] = useState<SpreadsheetWorkflowState>(EMPTY_STATE);
  // Bumped on every reset; in-flight async resolutions check this before
  // committing state so a reset mid-flow doesn't resurrect stale state.
  const runTokenRef = useRef(0);

  const setWorkbook = useCallback(
    (workbook: Workbook, sourceSessionId: string | null) => {
      setState((prev) => ({
        ...prev,
        phase: "draw",
        workbook,
        sourceSessionId,
        activeSheetId: workbook.sheets[0]?.id ?? null,
      }));
    },
    []
  );

  const setServerError = useCallback((err: ServerError | null) => {
    setState((prev) => ({ ...prev, serverError: err }));
  }, []);

  const onActiveSheetChange = useCallback((sheetId: string) => {
    setState((prev) => ({ ...prev, activeSheetId: sheetId }));
  }, []);

  const onSelectRegion = useCallback((regionId: string | null) => {
    setState((prev) => ({ ...prev, selectedRegionId: regionId }));
  }, []);

  const onRegionDraft = useCallback(
    (draft: { sheetId: string; bounds: CellBounds }) => {
      const newRegion: RegionDraft = {
        id: mintRegionId(draft.sheetId),
        sheetId: draft.sheetId,
        bounds: draft.bounds,
        targetEntityDefinitionId: null,
      };
      setState((prev) => ({
        ...prev,
        regions: [...prev.regions, newRegion],
        selectedRegionId: newRegion.id,
        activeSheetId: prev.activeSheetId ?? draft.sheetId,
      }));
    },
    []
  );

  const onRegionUpdate = useCallback(
    (regionId: string, updates: Partial<RegionDraft>) => {
      setState((prev) => {
        if (!prev.regions.some((r) => r.id === regionId)) return prev;
        return {
          ...prev,
          regions: prev.regions.map((r) =>
            r.id === regionId ? { ...r, ...updates } : r
          ),
        };
      });
    },
    []
  );

  const onRegionDelete = useCallback((regionId: string) => {
    setState((prev) => ({
      ...prev,
      regions: prev.regions.filter((r) => r.id !== regionId),
      selectedRegionId:
        prev.selectedRegionId === regionId ? null : prev.selectedRegionId,
    }));
  }, []);

  const onJumpToRegion = useCallback((regionId: string) => {
    setState((prev) => {
      const target = prev.regions.find((r) => r.id === regionId);
      if (!target) return prev;
      return {
        ...prev,
        phase: "draw",
        selectedRegionId: regionId,
        activeSheetId: target.sheetId,
      };
    });
  }, []);

  const onUpdateBinding = useCallback(
    (
      regionId: string,
      sourceLocator: string,
      patch: Partial<ColumnBindingDraft>
    ) => {
      setState((prev) => patchBinding(prev, regionId, sourceLocator, patch));
    },
    []
  );

  const onToggleBindingExcluded = useCallback(
    (regionId: string, sourceLocator: string, excluded: boolean) => {
      setState((prev) =>
        patchBinding(prev, regionId, sourceLocator, { excluded })
      );
    },
    []
  );

  const onInterpret = useCallback(async () => {
    if (state.regions.length === 0) return;
    const token = ++runTokenRef.current;
    setState((prev) => ({
      ...prev,
      isInterpreting: true,
      serverError: null,
    }));
    try {
      const {
        regions: nextRegions,
        plan,
        overallConfidence,
      } = await callbacks.runInterpret(state.regions);
      if (token !== runTokenRef.current) return;
      setState((prev) => ({
        ...prev,
        regions: nextRegions,
        plan,
        overallConfidence,
        isInterpreting: false,
        phase: "review",
      }));
    } catch (err) {
      if (token !== runTokenRef.current) return;
      setState((prev) => ({
        ...prev,
        isInterpreting: false,
        serverError: toServerErrorFromUnknown(err),
      }));
    }
  }, [callbacks, state.regions]);

  const onSkipToReview = useCallback(() => {
    setState((prev) => {
      if (!prev.plan) return prev;
      return { ...prev, phase: "review" };
    });
  }, []);

  const onCommit = useCallback(async () => {
    if (!state.plan) return;
    const plan = state.plan;
    const token = ++runTokenRef.current;
    setState((prev) => ({
      ...prev,
      isCommitting: true,
      serverError: null,
    }));
    try {
      const result = await callbacks.runCommit(plan);
      if (token !== runTokenRef.current) return;
      setState((prev) => ({ ...prev, isCommitting: false }));
      callbacks.onCommitSuccess?.(result.connectorInstanceId);
    } catch (err) {
      if (token !== runTokenRef.current) return;
      setState((prev) => ({
        ...prev,
        isCommitting: false,
        serverError: toServerErrorFromUnknown(err),
      }));
    }
  }, [callbacks, state.plan]);

  const goBack = useCallback(() => {
    setState((prev) => {
      if (prev.phase === "review") return { ...prev, phase: "draw" };
      if (prev.phase === "draw") return { ...prev, phase: "pending" };
      return prev;
    });
  }, []);

  const reset = useCallback(() => {
    runTokenRef.current += 1;
    setState(EMPTY_STATE);
  }, []);

  return {
    ...state,
    setWorkbook,
    setServerError,
    onActiveSheetChange,
    onSelectRegion,
    onRegionDraft,
    onRegionUpdate,
    onRegionDelete,
    onJumpToRegion,
    onUpdateBinding,
    onToggleBindingExcluded,
    onInterpret,
    onSkipToReview,
    onCommit,
    goBack,
    reset,
    claimRunToken: () => ++runTokenRef.current,
    currentRunToken: () => runTokenRef.current,
  };
}
