import { useCallback, useMemo, useState } from "react";

import type { JobStatus } from "@portalai/core/models";

import { sdk } from "../../../api/sdk";
import { useFileUpload } from "../../../utils/file-upload.util";
import type { FileUploadProgress, UploadPhase } from "../../../utils/file-upload.util";

// --- Types ---

export type WorkflowStep = 0 | 1 | 2 | 3;

export const WORKFLOW_STEPS = [
  { label: "Upload CSV", description: "Select and upload CSV files" },
  { label: "Confirm Entities", description: "Review detected entities" },
  { label: "Map Columns", description: "Map CSV columns to definitions" },
  { label: "Review & Import", description: "Review and confirm import" },
] as const;

export interface RecommendedColumn {
  action: "match_existing" | "create_new";
  confidence: number;
  existingColumnDefinitionId: string | null;
  recommended: {
    key: string;
    label: string;
    type: string;
    required?: boolean;
    format?: string | null;
    enumValues?: string[] | null;
    description?: string | null;
  };
  sourceField: string;
  isPrimaryKeyCandidate: boolean;
}

export interface RecommendedEntity {
  connectorEntity: {
    key: string;
    label: string;
  };
  columns: RecommendedColumn[];
}

export interface Recommendations {
  connectorInstance: {
    name: string;
    config: Record<string, unknown>;
  };
  entities: RecommendedEntity[];
}

export interface WorkflowState {
  step: WorkflowStep;
  files: File[];
  jobId: string | null;
  uploadPhase: UploadPhase;
  uploadProgress: Map<string, FileUploadProgress>;
  overallUploadPercent: number;
  jobStatus: JobStatus | null;
  jobProgress: number;
  jobError: string | null;
  recommendations: Recommendations | null;
  uploadError: string | null;
  isProcessing: boolean;
}

export interface UseUploadWorkflowReturn extends WorkflowState {
  addFiles: (newFiles: File[]) => void;
  removeFile: (index: number) => void;
  startUpload: (organizationId: string, connectorDefinitionId: string) => Promise<void>;
  goToStep: (step: WorkflowStep) => void;
  goNext: () => void;
  goBack: () => void;
  updateEntity: (index: number, updates: Partial<RecommendedEntity>) => void;
  updateColumn: (entityIndex: number, columnIndex: number, updates: Partial<RecommendedColumn>) => void;
  updateConnectorName: (name: string) => void;
  reset: () => void;
  canAdvance: boolean;
  connectionStatus: string;
}

// --- Helpers ---

function extractRecommendations(
  result: Record<string, unknown> | null,
): Recommendations | null {
  if (!result) return null;
  const recs = result.recommendations;
  if (!recs || typeof recs !== "object") return null;
  return recs as Recommendations;
}

// --- Hook ---

export const useUploadWorkflow = (): UseUploadWorkflowReturn => {
  // User-driven step navigation. null = auto-derive from workflow state.
  const [userStep, setUserStep] = useState<WorkflowStep | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  // User edits override the initial recommendations from SSE.
  const [editedRecommendations, setEditedRecommendations] = useState<Recommendations | null>(null);

  const fileUpload = useFileUpload();

  // SSE subscription — activates once we have a jobId and upload is done
  const shouldStream = fileUpload.phase === "done" || fileUpload.phase === "processing";
  const stream = sdk.jobs.stream(shouldStream ? fileUpload.jobId : null);

  // Derive initial recommendations from SSE stream result
  const sseRecommendations = useMemo(
    () =>
      stream.status === "awaiting_confirmation"
        ? extractRecommendations(stream.result)
        : null,
    [stream.status, stream.result],
  );

  // The active recommendations: user edits take priority over SSE-derived
  const recommendations = editedRecommendations ?? sseRecommendations;

  const isProcessing =
    fileUpload.phase === "presigning" ||
    fileUpload.phase === "uploading" ||
    fileUpload.phase === "processing" ||
    (fileUpload.phase === "done" &&
      stream.status !== "awaiting_confirmation" &&
      stream.status !== "completed" &&
      stream.status !== "failed");

  // Auto-derive step: if user hasn't navigated and recommendations arrived, show step 1
  const step: WorkflowStep = useMemo(() => {
    if (userStep !== null) return userStep;
    // Auto-advance to step 1 when recommendations arrive
    if (recommendations) return 1;
    return 0;
  }, [userStep, recommendations]);

  // --- Actions ---

  const addFiles = useCallback((newFiles: File[]) => {
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const startUpload = useCallback(
    async (organizationId: string, connectorDefinitionId: string) => {
      if (files.length === 0) return;
      await fileUpload.startUpload(files, { organizationId, connectorDefinitionId });
    },
    [files, fileUpload],
  );

  const goToStep = useCallback((newStep: WorkflowStep) => {
    setUserStep(newStep);
  }, []);

  const goNext = useCallback(() => {
    setUserStep((prev) => {
      const current = prev ?? (recommendations ? 1 : 0);
      return Math.min(current + 1, 3) as WorkflowStep;
    });
  }, [recommendations]);

  const goBack = useCallback(() => {
    setUserStep((prev) => {
      const current = prev ?? (recommendations ? 1 : 0);
      return Math.max(current - 1, 0) as WorkflowStep;
    });
  }, [recommendations]);

  const updateEntity = useCallback(
    (index: number, updates: Partial<RecommendedEntity>) => {
      setEditedRecommendations((prev) => {
        const base = prev ?? sseRecommendations;
        if (!base) return prev;
        const entities = [...base.entities];
        entities[index] = { ...entities[index], ...updates };
        return { ...base, entities };
      });
    },
    [sseRecommendations],
  );

  const updateColumn = useCallback(
    (entityIndex: number, columnIndex: number, updates: Partial<RecommendedColumn>) => {
      setEditedRecommendations((prev) => {
        const base = prev ?? sseRecommendations;
        if (!base) return prev;
        const entities = [...base.entities];
        const columns = [...entities[entityIndex].columns];
        columns[columnIndex] = { ...columns[columnIndex], ...updates };
        entities[entityIndex] = { ...entities[entityIndex], columns };
        return { ...base, entities };
      });
    },
    [sseRecommendations],
  );

  const updateConnectorName = useCallback(
    (name: string) => {
      setEditedRecommendations((prev) => {
        const base = prev ?? sseRecommendations;
        if (!base) return prev;
        return {
          ...base,
          connectorInstance: { ...base.connectorInstance, name },
        };
      });
    },
    [sseRecommendations],
  );

  const reset = useCallback(() => {
    setUserStep(null);
    setFiles([]);
    setEditedRecommendations(null);
    fileUpload.reset();
  }, [fileUpload]);

  // --- Derived state ---

  const canAdvance = useMemo(() => {
    switch (step) {
      case 0:
        return files.length > 0 && !isProcessing;
      case 1:
        return recommendations !== null && recommendations.entities.length > 0;
      case 2:
        return recommendations !== null;
      case 3:
        return false;
      default:
        return false;
    }
  }, [step, files.length, isProcessing, recommendations]);

  return {
    step,
    files,
    jobId: fileUpload.jobId,
    uploadPhase: fileUpload.phase,
    uploadProgress: fileUpload.fileProgress,
    overallUploadPercent: fileUpload.overallPercent,
    jobStatus: stream.status,
    jobProgress: stream.progress,
    jobError: stream.error ?? fileUpload.error,
    recommendations,
    uploadError: fileUpload.error,
    isProcessing,
    addFiles,
    removeFile,
    startUpload,
    goToStep,
    goNext,
    goBack,
    updateEntity,
    updateColumn,
    updateConnectorName,
    reset,
    canAdvance,
    connectionStatus: stream.connectionStatus,
  };
};
