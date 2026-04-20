import { useCallback, useRef, useState } from "react";

import type { StepConfig } from "@portalai/core/ui";

import type {
  CellBounds,
  RegionDraft,
  Workbook,
} from "../../../modules/RegionEditor";
import { ApiError } from "../../../utils/api.util";
import type { ServerError } from "../../../utils/api.util";
import type {
  FileUploadProgress,
} from "../../../utils/file-upload.util";
import type {
  FileUploadWorkflowState,
  UploadPhase,
} from "./file-upload-fixtures.util";

export const FILE_UPLOAD_WORKFLOW_STEPS: StepConfig[] = [
  { label: "Upload", description: "Select a spreadsheet" },
  { label: "Draw regions", description: "Outline records on each sheet" },
  { label: "Review", description: "Confirm bindings and commit" },
];

export interface FileUploadWorkflowCallbacks {
  parseFile: (files: File[]) => Promise<Workbook>;
  runInterpret: (regions: RegionDraft[]) => Promise<{
    regions: RegionDraft[];
    overallConfidence: number;
  }>;
  runCommit: (regions: RegionDraft[]) => Promise<{ connectorInstanceId: string }>;
  onCommitSuccess?: (connectorInstanceId: string) => void;
}

export interface UseFileUploadWorkflowReturn extends FileUploadWorkflowState {
  fileProgress: Map<string, FileUploadProgress>;

  addFiles: (files: File[]) => void;
  removeFile: (filename: string) => void;
  startParse: () => Promise<void>;
  onActiveSheetChange: (sheetId: string) => void;
  onSelectRegion: (regionId: string | null) => void;
  onRegionDraft: (draft: { sheetId: string; bounds: CellBounds }) => void;
  onRegionUpdate: (regionId: string, updates: Partial<RegionDraft>) => void;
  onRegionDelete: (regionId: string) => void;
  onInterpret: () => Promise<void>;
  onCommit: () => Promise<void>;
  goBack: () => void;
  reset: () => void;
}

const EMPTY_STATE: FileUploadWorkflowState = {
  step: 0,
  files: [],
  uploadPhase: "idle",
  overallUploadPercent: 0,
  workbook: null,
  regions: [],
  selectedRegionId: null,
  activeSheetId: null,
  serverError: null,
  isInterpreting: false,
  isCommitting: false,
};

export function mintRegionId(sheetId: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${sheetId}-r${suffix}`;
}

function toServerErrorFromUnknown(err: unknown): ServerError {
  if (err instanceof ApiError) {
    return { message: err.message, code: err.code || "UNKNOWN_CODE" };
  }
  if (err instanceof Error) {
    return { message: err.message, code: "UNKNOWN_ERROR" };
  }
  return { message: "Unknown error", code: "UNKNOWN_ERROR" };
}

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

export function useFileUploadWorkflow(
  callbacks: FileUploadWorkflowCallbacks
): UseFileUploadWorkflowReturn {
  const [state, setState] = useState<FileUploadWorkflowState>(EMPTY_STATE);
  // Bumped on every reset; in-flight async resolutions check this before
  // committing state so a reset mid-parse doesn't resurrect stale state.
  const runTokenRef = useRef(0);
  const fileProgressRef = useRef<Map<string, FileUploadProgress>>(new Map());

  const addFiles = useCallback((next: File[]) => {
    setState((prev) => ({
      ...prev,
      files: mergeFilesByName(prev.files, next),
    }));
  }, []);

  const removeFile = useCallback((filename: string) => {
    setState((prev) => ({
      ...prev,
      files: prev.files.filter((f) => f.name !== filename),
    }));
  }, []);

  const startParse = useCallback(async () => {
    const currentFiles = state.files;
    if (currentFiles.length === 0) return;

    const token = ++runTokenRef.current;
    setState((prev) => ({
      ...prev,
      uploadPhase: "uploading",
      overallUploadPercent: 0,
      serverError: null,
    }));

    try {
      // Represent the upload-then-parse transition visibly.
      setState((prev) =>
        token === runTokenRef.current
          ? { ...prev, uploadPhase: "parsing", overallUploadPercent: 50 }
          : prev
      );
      const workbook = await callbacks.parseFile(currentFiles);
      if (token !== runTokenRef.current) return;
      setState((prev) => ({
        ...prev,
        uploadPhase: "parsed",
        overallUploadPercent: 100,
        workbook,
        activeSheetId: workbook.sheets[0]?.id ?? null,
        step: 1,
      }));
    } catch (err) {
      if (token !== runTokenRef.current) return;
      setState((prev) => ({
        ...prev,
        uploadPhase: "error",
        serverError: toServerErrorFromUnknown(err),
      }));
    }
  }, [callbacks, state.files]);

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
        orientation: "rows-as-records",
        headerAxis: "row",
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

  const onInterpret = useCallback(async () => {
    if (state.regions.length === 0) return;
    const token = ++runTokenRef.current;
    setState((prev) => ({
      ...prev,
      isInterpreting: true,
      serverError: null,
    }));
    try {
      const { regions: nextRegions, overallConfidence } =
        await callbacks.runInterpret(state.regions);
      if (token !== runTokenRef.current) return;
      setState((prev) => ({
        ...prev,
        regions: nextRegions,
        overallConfidence,
        isInterpreting: false,
        step: 2,
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

  const onCommit = useCallback(async () => {
    const token = ++runTokenRef.current;
    setState((prev) => ({
      ...prev,
      isCommitting: true,
      serverError: null,
    }));
    try {
      const { connectorInstanceId } = await callbacks.runCommit(state.regions);
      if (token !== runTokenRef.current) return;
      setState((prev) => ({ ...prev, isCommitting: false }));
      callbacks.onCommitSuccess?.(connectorInstanceId);
    } catch (err) {
      if (token !== runTokenRef.current) return;
      setState((prev) => ({
        ...prev,
        isCommitting: false,
        serverError: toServerErrorFromUnknown(err),
      }));
    }
  }, [callbacks, state.regions]);

  const goBack = useCallback(() => {
    setState((prev) => {
      if (prev.step === 0) return prev;
      return { ...prev, step: (prev.step - 1) as 0 | 1 };
    });
  }, []);

  const reset = useCallback(() => {
    runTokenRef.current += 1;
    fileProgressRef.current = new Map();
    setState(EMPTY_STATE);
  }, []);

  return {
    ...state,
    fileProgress: fileProgressRef.current,

    addFiles,
    removeFile,
    startParse,
    onActiveSheetChange,
    onSelectRegion,
    onRegionDraft,
    onRegionUpdate,
    onRegionDelete,
    onInterpret,
    onCommit,
    goBack,
    reset,
  };
}

export type { UploadPhase };
