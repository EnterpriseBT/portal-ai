import { useCallback, useMemo, useRef, useState } from "react";

import type { StepConfig } from "@portalai/core/ui";
import type { LayoutPlan } from "@portalai/core/contracts";

import type {
  CellBounds,
  RegionDraft,
  Workbook,
} from "../../../modules/RegionEditor";
import { ApiError } from "../../../utils/api.util";
import type { ServerError } from "../../../utils/api.util";
import type {
  FileUploadWorkflowState,
  UploadPhase,
} from "./file-upload-fixtures.util";

/**
 * Per-file upload progress shape rendered by the UploadStep. Migrated into
 * the workflow util in `SPREADSHEET_PARSING.frontend.plan.md` §Phase 6.8
 * when the legacy `utils/file-upload.util.ts` (and its presign/S3 hook) was
 * retired.
 */
export interface FileUploadProgress {
  fileName: string;
  loaded: number;
  total: number;
  percent: number;
}

/**
 * Progress event reported by the container's `parseFile` callback while the
 * streaming upload pipeline runs. Surfaced into the hook's `fileProgress`
 * state so the UploadStep's progress bars reflect real XHR upload events.
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
  /**
   * Pure-compute interpret — the server must NOT persist anything here. The
   * returned `plan` is held in memory until commit.
   */
  runInterpret: (regions: RegionDraft[]) => Promise<{
    regions: RegionDraft[];
    plan: LayoutPlan;
    overallConfidence: number;
  }>;
  /**
   * Atomic commit — the server creates the ConnectorInstance, persists the
   * plan, and writes records in one call. On any server-side failure the
   * instance + plan row are rolled back, so there's no orphan cleanup to
   * coordinate on the client.
   */
  runCommit: (
    plan: LayoutPlan
  ) => Promise<{ connectorInstanceId: string }>;
  onCommitSuccess?: (connectorInstanceId: string) => void;
}

export interface UseFileUploadWorkflowReturn extends FileUploadWorkflowState {
  /**
   * Map-shaped view of `state.fileProgress` for callers that want the
   * existing `Map<string, FileUploadProgress>` API. Derived fresh each render
   * from the underlying record so the reference stability matches state.
   */
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
  onInterpret: () => Promise<void>;
  onSkipToReview: () => void;
  onCommit: () => Promise<void>;
  goBack: () => void;
  reset: () => void;
}

const EMPTY_STATE: FileUploadWorkflowState = {
  step: 0,
  files: [],
  uploadPhase: "idle",
  overallUploadPercent: 0,
  fileProgress: {},
  workbook: null,
  regions: [],
  selectedRegionId: null,
  activeSheetId: null,
  serverError: null,
  isInterpreting: false,
  isCommitting: false,
  plan: null,
  uploadSessionId: null,
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
    // Seed per-file progress so the UploadStep can render a zeroed bar per
    // file immediately, rather than popping in only after the first chunk.
    const seededProgress: FileUploadWorkflowState["fileProgress"] = {};
    for (const f of currentFiles) {
      seededProgress[f.name] = {
        fileName: f.name,
        loaded: 0,
        total: f.size,
        percent: 0,
      };
    }
    setState((prev) => ({
      ...prev,
      uploadPhase: "uploading",
      overallUploadPercent: 0,
      fileProgress: seededProgress,
      serverError: null,
    }));

    const handleProgress = (event: ParseFileProgressEvent): void => {
      if (token !== runTokenRef.current) return;
      setState((prev) => {
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
      if (token !== runTokenRef.current) return;

      setState((prev) => ({
        ...prev,
        uploadPhase: "parsed",
        overallUploadPercent: 100,
        workbook,
        uploadSessionId,
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

  const onJumpToRegion = useCallback((regionId: string) => {
    setState((prev) => {
      const target = prev.regions.find((r) => r.id === regionId);
      if (!target) return prev;
      return {
        ...prev,
        step: 1,
        selectedRegionId: regionId,
        activeSheetId: target.sheetId,
      };
    });
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

  const onSkipToReview = useCallback(() => {
    setState((prev) => {
      if (!prev.plan) return prev;
      return { ...prev, step: 2 };
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
      if (prev.step === 0) return prev;
      return { ...prev, step: (prev.step - 1) as 0 | 1 };
    });
  }, []);

  const reset = useCallback(() => {
    runTokenRef.current += 1;
    setState(EMPTY_STATE);
  }, []);

  const fileProgressMap = useMemo<Map<string, FileUploadProgress>>(
    () => new Map(Object.entries(state.fileProgress)),
    [state.fileProgress]
  );

  return {
    ...state,
    fileProgressMap,

    addFiles,
    removeFile,
    startParse,
    onActiveSheetChange,
    onSelectRegion,
    onRegionDraft,
    onRegionUpdate,
    onRegionDelete,
    onJumpToRegion,
    onInterpret,
    onSkipToReview,
    onCommit,
    goBack,
    reset,
  };
}

export type { UploadPhase };
