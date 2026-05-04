/**
 * Microsoft 365 Excel-specific stage on top of the shared
 * `useSpreadsheetWorkflow`.
 *
 * Pre-stage owns: connector instance id (from OAuth callback), account
 * info, currently-selected `driveItemId`, and a `loadWorkbook` action
 * that calls `selectWorkbook` on the SDK and feeds the resulting
 * `Workbook` into the shared core via `core.setWorkbook(...)`.
 *
 * Step model:
 *   step 0 — Authorize        (no connectorInstanceId yet)
 *   step 1 — Choose workbook  (connectorInstanceId set, no workbook)
 *   step 2 — Draw regions     (core.phase === "draw")
 *   step 3 — Review           (core.phase === "review")
 */

import { useCallback, useState } from "react";

import type { StepConfig } from "@portalai/core/ui";
import type {
  LayoutPlan,
  MicrosoftExcelSelectWorkbookResponsePayload,
  PublicAccountInfo,
} from "@portalai/core/contracts";

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
  useSpreadsheetWorkflow,
} from "../../_shared/spreadsheet/use-spreadsheet-workflow.util";

export const MICROSOFT_EXCEL_WORKFLOW_STEPS: StepConfig[] = [
  { label: "Authorize", description: "Connect your Microsoft 365 account" },
  { label: "Choose workbook", description: "Pick an Excel file to import" },
  { label: "Draw regions", description: "Outline records on each sheet" },
  { label: "Review", description: "Confirm bindings and commit" },
];

export type MicrosoftExcelStep = 0 | 1 | 2 | 3;

export interface MicrosoftExcelWorkflowCallbacks {
  /**
   * Calls the API's select-workbook endpoint after the user picks a
   * workbook from the searchable list. Returns the parseSession-shape
   * payload the wrapper converts into a `Workbook`.
   */
  loadWorkbook: (input: {
    connectorInstanceId: string;
    driveItemId: string;
  }) => Promise<MicrosoftExcelSelectWorkbookResponsePayload>;
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

export interface UseMicrosoftExcelWorkflowReturn {
  step: MicrosoftExcelStep;

  // Auth stage
  connectorInstanceId: string | null;
  accountInfo: PublicAccountInfo | null;
  setAuthorized: (input: {
    connectorInstanceId: string;
    accountInfo: PublicAccountInfo;
  }) => void;

  // Choose-workbook stage
  driveItemId: string | null;
  workbookTitle: string | null;
  isLoadingWorkbook: boolean;
  selectWorkbook: (driveItemId: string) => Promise<void>;

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
export function selectWorkbookResponseToWorkbook(
  payload: MicrosoftExcelSelectWorkbookResponsePayload,
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
  driveItemId: string | null;
  workbookTitle: string | null;
  isLoadingWorkbook: boolean;
}

const EMPTY_AUTH_STAGE: AuthStageState = {
  connectorInstanceId: null,
  accountInfo: null,
  driveItemId: null,
  workbookTitle: null,
  isLoadingWorkbook: false,
};

export function useMicrosoftExcelWorkflow(
  callbacks: MicrosoftExcelWorkflowCallbacks
): UseMicrosoftExcelWorkflowReturn {
  const core = useSpreadsheetWorkflow({
    runInterpret: callbacks.runInterpret,
    runCommit: callbacks.runCommit,
    onCommitSuccess: callbacks.onCommitSuccess,
  });
  const [stage, setStage] = useState<AuthStageState>(EMPTY_AUTH_STAGE);

  const step: MicrosoftExcelStep =
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

  const selectWorkbook = useCallback(
    async (driveItemId: string) => {
      const ciId = stage.connectorInstanceId;
      if (!ciId) {
        core.setServerError({
          message: "Missing connector instance — re-authorize first",
          code: "MICROSOFT_EXCEL_INVALID_INSTANCE_ID",
        });
        return;
      }

      // Switching workbooks after a previous selection: clear any stale
      // workbook + plan + regions so the next fetch starts clean.
      if (stage.driveItemId && stage.driveItemId !== driveItemId) {
        core.reset();
      }

      const token = core.claimRunToken();
      setStage((prev) => ({
        ...prev,
        driveItemId,
        isLoadingWorkbook: true,
      }));
      core.setServerError(null);

      try {
        const response = await callbacks.loadWorkbook({
          connectorInstanceId: ciId,
          driveItemId,
        });
        if (token !== core.currentRunToken()) return;
        const workbook = selectWorkbookResponseToWorkbook(
          response,
          response.title || driveItemId
        );
        setStage((prev) => ({
          ...prev,
          workbookTitle: response.title || null,
          isLoadingWorkbook: false,
        }));
        core.setWorkbook(workbook, ciId);
      } catch (err) {
        if (token !== core.currentRunToken()) return;
        setStage((prev) => ({ ...prev, isLoadingWorkbook: false }));
        core.setServerError(toServerErrorFromUnknown(err));
      }
    },
    [callbacks, core, stage.connectorInstanceId, stage.driveItemId]
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
    driveItemId: stage.driveItemId,
    workbookTitle: stage.workbookTitle,
    isLoadingWorkbook: stage.isLoadingWorkbook,
    selectWorkbook,

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
