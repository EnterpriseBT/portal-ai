import { useCallback, useMemo, useState } from "react";

import type { StepConfig } from "@portalai/core/ui";
import type { LayoutPlan } from "@portalai/core/contracts";

import type {
  CellBounds,
  ColumnBindingDraft,
  RegionDraft,
  Workbook,
} from "../../../modules/RegionEditor";
import {
  mintRegionId as sharedMintRegionId,
  toServerErrorFromUnknown,
  useSpreadsheetWorkflow,
} from "../../_shared/spreadsheet/use-spreadsheet-workflow.util";
import type { FileUploadWorkflowState, UploadPhase } from "./file-upload-fixtures.util";

/**
 * Per-file upload progress shape rendered by the UploadStep.
 */
export interface FileUploadProgress {
  fileName: string;
  loaded: number;
  total: number;
  percent: number;
}

/**
 * Progress event reported by the container's `parseFile` callback while the
 * streaming upload pipeline runs.
 */
export interface ParseFileProgressEvent {
  fileName: string;
  loaded: number;
  total: number;
}

export interface ParseFileOptions {
  onProgress?: (event: ParseFileProgressEvent) => void;
  signal?: AbortSignal;
}

export const FILE_UPLOAD_WORKFLOW_STEPS: StepConfig[] = [
  { label: "Upload", description: "Select a spreadsheet" },
  { label: "Draw regions", description: "Outline records on each sheet" },
  { label: "Review", description: "Confirm bindings and commit" },
];

export interface FileUploadWorkflowCallbacks {
  parseFile: (
    files: File[],
    options?: ParseFileOptions
  ) => Promise<{ workbook: Workbook; uploadSessionId: string }>;
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

export interface UseFileUploadWorkflowReturn extends FileUploadWorkflowState {
  fileProgressMap: Map<string, FileUploadProgress>;

  addFiles: (files: File[]) => void;
  removeFile: (filename: string) => void;
  startParse: () => Promise<void>;
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

export const mintRegionId = sharedMintRegionId;

function mergeFilesByName(existing: File[], incoming: File[]): File[] {
  const seen = new Set(existing.map((f) => f.name));
  const merged = [...existing];
  for (const file of incoming) {
    if (seen.has(file.name)) continue;
    seen.add(file.name);
    merged.push(file);
  }
  return merged;
}

interface FileUploadStageState {
  files: File[];
  uploadPhase: UploadPhase;
  overallUploadPercent: number;
  fileProgress: Record<string, FileUploadProgress>;
  uploadSessionId: string | null;
}

const EMPTY_FILE_UPLOAD_STAGE: FileUploadStageState = {
  files: [],
  uploadPhase: "idle",
  overallUploadPercent: 0,
  fileProgress: {},
  uploadSessionId: null,
};

/**
 * File-upload workflow hook. Wraps the shared `useSpreadsheetWorkflow`
 * with the upload-specific pre-stage (file list, progress, parseFile).
 * Once parse succeeds the wrapper hands control to the shared core via
 * `core.setWorkbook(...)`.
 *
 * The external API is unchanged from the pre-refactor shape so
 * `FileUploadConnectorWorkflow.component.tsx` consumers don't move.
 */
export function useFileUploadWorkflow(
  callbacks: FileUploadWorkflowCallbacks
): UseFileUploadWorkflowReturn {
  const core = useSpreadsheetWorkflow({
    runInterpret: callbacks.runInterpret,
    runCommit: callbacks.runCommit,
    onCommitSuccess: callbacks.onCommitSuccess,
  });
  const [stage, setStage] = useState<FileUploadStageState>(
    EMPTY_FILE_UPLOAD_STAGE
  );

  // Derive the legacy `step: 0 | 1 | 2` from the wrapper's stage + the
  // core's phase. step 0 = upload-stage active; step 1 = draw; step 2 = review.
  const step: 0 | 1 | 2 =
    core.phase === "review" ? 2 : core.phase === "draw" ? 1 : 0;

  const addFiles = useCallback((next: File[]) => {
    setStage((prev) => ({
      ...prev,
      files: mergeFilesByName(prev.files, next),
    }));
  }, []);

  const removeFile = useCallback((filename: string) => {
    setStage((prev) => ({
      ...prev,
      files: prev.files.filter((f) => f.name !== filename),
    }));
  }, []);

  const startParse = useCallback(async () => {
    const currentFiles = stage.files;
    if (currentFiles.length === 0) return;

    const token = core.claimRunToken();
    const seededProgress: Record<string, FileUploadProgress> = {};
    for (const f of currentFiles) {
      seededProgress[f.name] = {
        fileName: f.name,
        loaded: 0,
        total: f.size,
        percent: 0,
      };
    }
    setStage((prev) => ({
      ...prev,
      uploadPhase: "uploading",
      overallUploadPercent: 0,
      fileProgress: seededProgress,
    }));
    core.setServerError(null);

    const handleProgress = (event: ParseFileProgressEvent): void => {
      if (token !== core.currentRunToken()) return;
      setStage((prev) => {
        const next = { ...prev.fileProgress };
        const total = event.total > 0 ? event.total : 1;
        const percent = Math.min(
          100,
          Math.max(0, Math.round((event.loaded / total) * 100))
        );
        next[event.fileName] = {
          fileName: event.fileName,
          loaded: event.loaded,
          total: event.total,
          percent,
        };
        let totalLoaded = 0;
        let totalSize = 0;
        for (const p of Object.values(next)) {
          totalLoaded += p.loaded;
          totalSize += p.total;
        }
        const overallUploadPercent =
          totalSize > 0
            ? Math.min(
                100,
                Math.max(0, Math.round((totalLoaded / totalSize) * 100))
              )
            : 0;
        return {
          ...prev,
          fileProgress: next,
          overallUploadPercent,
        };
      });
    };

    try {
      const { workbook, uploadSessionId } = await callbacks.parseFile(
        currentFiles,
        { onProgress: handleProgress }
      );
      if (token !== core.currentRunToken()) return;

      setStage((prev) => ({
        ...prev,
        uploadPhase: "parsed",
        overallUploadPercent: 100,
        uploadSessionId,
      }));
      core.setWorkbook(workbook, uploadSessionId);
    } catch (err) {
      if (token !== core.currentRunToken()) return;
      setStage((prev) => ({ ...prev, uploadPhase: "error" }));
      core.setServerError(toServerErrorFromUnknown(err));
    }
  }, [callbacks, core, stage.files]);

  const reset = useCallback(() => {
    core.reset();
    setStage(EMPTY_FILE_UPLOAD_STAGE);
  }, [core]);

  const fileProgressMap = useMemo<Map<string, FileUploadProgress>>(
    () => new Map(Object.entries(stage.fileProgress)),
    [stage.fileProgress]
  );

  return {
    // SpreadsheetWorkflowState (mapped to FileUploadWorkflowState shape)
    step,
    workbook: core.workbook,
    regions: core.regions,
    selectedRegionId: core.selectedRegionId,
    activeSheetId: core.activeSheetId,
    serverError: core.serverError,
    isInterpreting: core.isInterpreting,
    isCommitting: core.isCommitting,
    plan: core.plan,
    overallConfidence: core.overallConfidence,
    // File-upload stage
    files: stage.files,
    uploadPhase: stage.uploadPhase,
    overallUploadPercent: stage.overallUploadPercent,
    fileProgress: stage.fileProgress,
    uploadSessionId: stage.uploadSessionId,
    fileProgressMap,

    addFiles,
    removeFile,
    startParse,
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

export type { UploadPhase };
