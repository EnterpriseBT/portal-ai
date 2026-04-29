/**
 * Google-sheets-specific stage on top of the shared `useConnectorWorkflow`.
 *
 * The pre-stage owns: connector instance id (from OAuth callback),
 * account info, currently-selected spreadsheetId, and a `loadSheet`
 * action that calls `selectSheet` on the SDK and feeds the resulting
 * `Workbook` into the shared core via `core.setWorkbook(...)`.
 *
 * Step model:
 *   step 0 — Authorize           (no connectorInstanceId yet)
 *   step 1 — Select sheet        (connectorInstanceId set, no workbook)
 *   step 2 — Draw regions        (core.phase === "draw")
 *   step 3 — Review              (core.phase === "review")
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-C.plan.md` §Slice 7.
 */

import { useCallback, useState } from "react";

import type { StepConfig } from "@portalai/core/ui";
import type {
  GoogleSheetsSelectSheetResponsePayload,
  PublicAccountInfo,
} from "@portalai/core/contracts";
import type { LayoutPlan } from "@portalai/core/contracts";

import type {
  CellBounds,
  CellValue,
  ColumnBindingDraft,
  RegionDraft,
  SheetPreview,
  Workbook,
} from "../../../modules/RegionEditor";
import type { ServerError } from "../../../utils/api.util";
import {
  toServerErrorFromUnknown,
  useConnectorWorkflow,
} from "../../_shared/use-connector-workflow.util";

export const GOOGLE_SHEETS_WORKFLOW_STEPS: StepConfig[] = [
  { label: "Authorize", description: "Connect your Google account" },
  { label: "Select sheet", description: "Pick a spreadsheet to import" },
  { label: "Draw regions", description: "Outline records on each sheet" },
  { label: "Review", description: "Confirm bindings and commit" },
];

export type GoogleSheetsStep = 0 | 1 | 2 | 3;

export interface GoogleSheetsWorkflowCallbacks {
  /**
   * Calls the API's select-sheet endpoint after the user picks a
   * spreadsheet from the searchable list. Returns the parseSession-
   * shape payload the wrapper converts into a `Workbook`.
   */
  loadSheet: (input: {
    connectorInstanceId: string;
    spreadsheetId: string;
  }) => Promise<GoogleSheetsSelectSheetResponsePayload>;
  runInterpret: (regions: RegionDraft[]) => Promise<{
    regions: RegionDraft[];
    plan: LayoutPlan;
    overallConfidence: number;
  }>;
  runCommit: (
    plan: LayoutPlan
  ) => Promise<{ connectorInstanceId: string }>;
  onCommitSuccess?: (connectorInstanceId: string) => void;
}

export interface UseGoogleSheetsWorkflowReturn {
  step: GoogleSheetsStep;

  // Auth stage
  connectorInstanceId: string | null;
  accountInfo: PublicAccountInfo | null;
  setAuthorized: (input: {
    connectorInstanceId: string;
    accountInfo: PublicAccountInfo;
  }) => void;

  // Select-sheet stage
  spreadsheetId: string | null;
  isLoadingSheet: boolean;
  selectSpreadsheet: (spreadsheetId: string) => Promise<void>;

  // Shared (post-workbook) state, surfaced from the core
  workbook: Workbook | null;
  regions: RegionDraft[];
  selectedRegionId: string | null;
  activeSheetId: string | null;
  serverError: ServerError | null;
  isInterpreting: boolean;
  isCommitting: boolean;
  plan: LayoutPlan | null;
  overallConfidence?: number;

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
}

/**
 * Convert the API's `parseSession`-shape response into the dense
 * `Workbook` the RegionEditor renders. Sliced sheets come back with
 * `cells: []` and stay empty — the canvas treats every row as
 * unloaded and fetches via `loadSlice` as it scrolls.
 */
export function selectSheetResponseToWorkbook(
  payload: GoogleSheetsSelectSheetResponsePayload,
  sourceLabel: string
): Workbook {
  const out: SheetPreview[] = payload.sheets.map((sheet) => {
    const rows = sheet.dimensions.rows;
    const cols = sheet.dimensions.cols;
    const cells: CellValue[][] =
      sheet.cells.length === 0
        ? []
        : Array.from({ length: rows }, (_, r) =>
            Array.from({ length: cols }, (_, c) => {
              const raw = sheet.cells[r]?.[c];
              if (raw === undefined || raw === null) return "";
              return raw as CellValue;
            })
          );
    return {
      id: sheet.id,
      name: sheet.name,
      rowCount: rows,
      colCount: cols,
      cells,
    };
  });
  return { sheets: out, sourceLabel };
}

interface AuthStageState {
  connectorInstanceId: string | null;
  accountInfo: PublicAccountInfo | null;
  spreadsheetId: string | null;
  isLoadingSheet: boolean;
}

const EMPTY_AUTH_STAGE: AuthStageState = {
  connectorInstanceId: null,
  accountInfo: null,
  spreadsheetId: null,
  isLoadingSheet: false,
};

export function useGoogleSheetsWorkflow(
  callbacks: GoogleSheetsWorkflowCallbacks
): UseGoogleSheetsWorkflowReturn {
  const core = useConnectorWorkflow({
    runInterpret: callbacks.runInterpret,
    runCommit: callbacks.runCommit,
    onCommitSuccess: callbacks.onCommitSuccess,
  });
  const [stage, setStage] = useState<AuthStageState>(EMPTY_AUTH_STAGE);

  const step: GoogleSheetsStep =
    core.phase === "review"
      ? 3
      : core.phase === "draw"
        ? 2
        : stage.connectorInstanceId
          ? 1
          : 0;

  const setAuthorized = useCallback(
    (input: {
      connectorInstanceId: string;
      accountInfo: PublicAccountInfo;
    }) => {
      setStage((prev) => ({
        ...prev,
        connectorInstanceId: input.connectorInstanceId,
        accountInfo: input.accountInfo,
      }));
    },
    []
  );

  const selectSpreadsheet = useCallback(
    async (spreadsheetId: string) => {
      const ciId = stage.connectorInstanceId;
      if (!ciId) {
        core.setServerError({
          message: "Missing connector instance — re-authorize first",
          code: "GOOGLE_SHEETS_INVALID_INSTANCE_ID",
        });
        return;
      }

      // Switching spreadsheets after a previous selection: clear any
      // stale workbook + plan + regions so the next fetch starts clean.
      if (stage.spreadsheetId && stage.spreadsheetId !== spreadsheetId) {
        core.reset();
      }

      const token = core.claimRunToken();
      setStage((prev) => ({
        ...prev,
        spreadsheetId,
        isLoadingSheet: true,
      }));
      core.setServerError(null);

      try {
        const response = await callbacks.loadSheet({
          connectorInstanceId: ciId,
          spreadsheetId,
        });
        if (token !== core.currentRunToken()) return;
        const workbook = selectSheetResponseToWorkbook(
          response,
          spreadsheetId
        );
        setStage((prev) => ({ ...prev, isLoadingSheet: false }));
        core.setWorkbook(workbook, ciId);
      } catch (err) {
        if (token !== core.currentRunToken()) return;
        setStage((prev) => ({ ...prev, isLoadingSheet: false }));
        core.setServerError(toServerErrorFromUnknown(err));
      }
    },
    [callbacks, core, stage.connectorInstanceId, stage.spreadsheetId]
  );

  const reset = useCallback(() => {
    core.reset();
    setStage(EMPTY_AUTH_STAGE);
  }, [core]);

  return {
    step,
    connectorInstanceId: stage.connectorInstanceId,
    accountInfo: stage.accountInfo,
    setAuthorized,
    spreadsheetId: stage.spreadsheetId,
    isLoadingSheet: stage.isLoadingSheet,
    selectSpreadsheet,

    workbook: core.workbook,
    regions: core.regions,
    selectedRegionId: core.selectedRegionId,
    activeSheetId: core.activeSheetId,
    serverError: core.serverError,
    isInterpreting: core.isInterpreting,
    isCommitting: core.isCommitting,
    plan: core.plan,
    overallConfidence: core.overallConfidence,

    onActiveSheetChange: core.onActiveSheetChange,
    onSelectRegion: core.onSelectRegion,
    onRegionDraft: core.onRegionDraft,
    onRegionUpdate: core.onRegionUpdate,
    onRegionDelete: core.onRegionDelete,
    onJumpToRegion: core.onJumpToRegion,
    onUpdateBinding: core.onUpdateBinding,
    onToggleBindingExcluded: core.onToggleBindingExcluded,
    onInterpret: core.onInterpret,
    onSkipToReview: core.onSkipToReview,
    onCommit: core.onCommit,
    goBack: core.goBack,
    reset,
  };
}
