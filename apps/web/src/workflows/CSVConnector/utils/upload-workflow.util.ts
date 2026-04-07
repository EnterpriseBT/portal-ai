import { useCallback, useMemo, useState } from "react";

import type { JobStatus } from "@portalai/core/models";
import type { ConfirmRequestBody, ConfirmResponsePayload } from "@portalai/core/contracts";

import { sdk } from "../../../api/sdk";
import { useAuthFetch } from "../../../utils/api.util";
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
  /** Column-definition-level recommendation. */
  recommended: {
    key: string;
    label: string;
    type: string;
    description?: string | null;
    validationPattern?: string | null;
    validationMessage?: string | null;
    canonicalFormat?: string | null;
    refEntityKey?: string | null;
    refColumnKey?: string | null;
    refColumnDefinitionId?: string | null;
  };
  sourceField: string;
  isPrimaryKeyCandidate: boolean;
  sampleValues: string[];
  /** Field-mapping-level fields (editable per entity-column). */
  normalizedKey?: string;
  required?: boolean;
  defaultValue?: string | null;
  format?: string | null;
  enumValues?: string[] | null;
}

export interface RecommendedEntity {
  connectorEntity: {
    key: string;
    label: string;
  };
  sourceFileName: string;
  columns: RecommendedColumn[];
}

export interface ParseSummary {
  fileName: string;
  rowCount: number;
  delimiter: string;
  encoding: string;
  columnCount: number;
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
  jobResult: Record<string, unknown> | null;
  recommendations: Recommendations | null;
  parseResults: ParseSummary[] | null;
  uploadError: string | null;
  isProcessing: boolean;
  isConfirming: boolean;
  confirmError: string | null;
  confirmResult: ConfirmResponsePayload | null;
  isCancelling: boolean;
}

/** Column update where `recommended` can be a partial — fields are merged, not replaced. */
export type RecommendedColumnUpdate = Omit<Partial<RecommendedColumn>, "recommended"> & {
  recommended?: Partial<RecommendedColumn["recommended"]>;
};

export interface UseUploadWorkflowReturn extends WorkflowState {
  addFiles: (newFiles: File[]) => void;
  removeFile: (index: number) => void;
  startUpload: (organizationId: string, connectorDefinitionId: string) => Promise<void>;
  goToStep: (step: WorkflowStep) => void;
  goNext: () => void;
  goBack: () => void;
  updateEntity: (index: number, updates: Partial<RecommendedEntity>) => void;
  updateColumn: (entityIndex: number, columnIndex: number, updates: RecommendedColumnUpdate) => void;
  updateConnectorName: (name: string) => void;
  confirm: () => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
  canAdvance: boolean;
  connectionStatus: string;
}

// --- Helpers ---

/** Backend recommendation shape (from FileUploadRecommendationSchema). */
interface BackendRecommendation {
  connectorInstanceName: string;
  entities: Array<{
    entityKey: string;
    entityLabel: string;
    sourceFileName: string;
    columns: Array<{
      sourceField: string;
      key: string;
      label: string;
      type: string;
      isPrimaryKey: boolean;
      action: "match_existing" | "create_new";
      existingColumnDefinitionId: string | null;
      confidence: number;
      sampleValues: string[];
      // Column-definition-level
      validationPattern?: string | null;
      validationMessage?: string | null;
      canonicalFormat?: string | null;
      // Field-mapping-level
      normalizedKey?: string;
      required?: boolean;
      defaultValue?: string | null;
      format?: string | null;
      enumValues?: string[] | null;
      // Reference fields
      refEntityKey?: string | null;
      refColumnKey?: string | null;
      refColumnDefinitionId?: string | null;
    }>;
  }>;
}

function isBackendFormat(recs: Record<string, unknown>): boolean {
  return "connectorInstanceName" in recs;
}

function mapBackendRecommendations(backend: BackendRecommendation): Recommendations {
  return {
    connectorInstance: { name: backend.connectorInstanceName, config: {} },
    entities: backend.entities.map((entity) => ({
      connectorEntity: { key: entity.entityKey, label: entity.entityLabel },
      sourceFileName: entity.sourceFileName,
      columns: entity.columns.map((col) => ({
        action: col.action,
        confidence: col.confidence,
        existingColumnDefinitionId: col.existingColumnDefinitionId,
        recommended: {
          key: col.key,
          label: col.label,
          type: col.type,
          validationPattern: col.validationPattern ?? null,
          validationMessage: col.validationMessage ?? null,
          canonicalFormat: col.canonicalFormat ?? null,
          refEntityKey: col.refEntityKey ?? null,
          refColumnKey: col.refColumnKey ?? null,
          refColumnDefinitionId: col.refColumnDefinitionId ?? null,
        },
        sourceField: col.sourceField,
        isPrimaryKeyCandidate: col.isPrimaryKey,
        sampleValues: col.sampleValues,
        normalizedKey: col.normalizedKey ?? col.key,
        required: col.required ?? false,
        defaultValue: col.defaultValue ?? null,
        format: col.format ?? null,
        enumValues: col.enumValues ?? null,
      })),
    })),
  };
}

function extractRecommendations(
  result: Record<string, unknown> | null,
): Recommendations | null {
  if (!result) return null;
  const recs = result.recommendations;
  if (!recs || typeof recs !== "object") return null;
  const recsObj = recs as Record<string, unknown>;
  if (isBackendFormat(recsObj)) {
    return mapBackendRecommendations(recsObj as unknown as BackendRecommendation);
  }
  return recs as Recommendations;
}

function extractParseResults(
  result: Record<string, unknown> | null,
): ParseSummary[] | null {
  if (!result) return null;
  const parseResults = result.parseResults;
  if (!Array.isArray(parseResults)) return null;
  return parseResults.map((pr: Record<string, unknown>) => ({
    fileName: String(pr.fileName ?? ""),
    rowCount: Number(pr.rowCount ?? 0),
    delimiter: String(pr.delimiter ?? ","),
    encoding: String(pr.encoding ?? "utf-8"),
    columnCount: Array.isArray(pr.headers) ? pr.headers.length : 0,
  }));
}

// --- Hook ---

export const useUploadWorkflow = (): UseUploadWorkflowReturn => {
  // User-driven step navigation. null = auto-derive from workflow state.
  const [userStep, setUserStep] = useState<WorkflowStep | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  // User edits override the initial recommendations from SSE.
  const [editedRecommendations, setEditedRecommendations] = useState<Recommendations | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmResult, setConfirmResult] = useState<ConfirmResponsePayload | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const { fetchWithAuth } = useAuthFetch();
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

  // Derive parse results from SSE stream result
  const parseResults = useMemo(
    () => extractParseResults(stream.result),
    [stream.result],
  );

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
    (entityIndex: number, columnIndex: number, updates: RecommendedColumnUpdate) => {
      setEditedRecommendations((prev) => {
        const base = prev ?? sseRecommendations;
        if (!base) return prev;
        const entities = [...base.entities];
        const columns = [...entities[entityIndex].columns];
        const existing = columns[columnIndex];
        // Merge `recommended` partially so callers don't need to spread the full object
        const merged = updates.recommended
          ? { ...existing, ...updates, recommended: { ...existing.recommended, ...updates.recommended } }
          : { ...existing, ...updates };
        columns[columnIndex] = merged as RecommendedColumn;
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

  const confirm = useCallback(async () => {
    const activeRecs = editedRecommendations ?? sseRecommendations;
    const jobId = fileUpload.jobId;
    if (!activeRecs || !jobId) return;

    const body: ConfirmRequestBody = {
      connectorInstanceName: activeRecs.connectorInstance.name,
      entities: activeRecs.entities.map((entity) => ({
        entityKey: entity.connectorEntity.key,
        entityLabel: entity.connectorEntity.label,
        sourceFileName: entity.sourceFileName,
        columns: entity.columns.map((col) => ({
          sourceField: col.sourceField,
          key: col.recommended.key,
          label: col.recommended.label,
          type: col.recommended.type as ConfirmRequestBody["entities"][number]["columns"][number]["type"],
          isPrimaryKey: col.isPrimaryKeyCandidate,
          action: col.action,
          existingColumnDefinitionId: col.existingColumnDefinitionId,
          // Field-mapping-level
          normalizedKey: col.normalizedKey ?? col.recommended.key,
          required: col.required ?? false,
          defaultValue: col.defaultValue ?? null,
          format: col.format ?? null,
          enumValues: col.enumValues ?? null,
          // Column-definition-level
          validationPattern: col.recommended.validationPattern ?? null,
          validationMessage: col.recommended.validationMessage ?? null,
          canonicalFormat: col.recommended.canonicalFormat ?? null,
          // Reference fields
          refEntityKey: col.recommended.refEntityKey ?? null,
          refColumnKey: col.recommended.refColumnKey ?? null,
          refColumnDefinitionId: col.recommended.refColumnDefinitionId ?? null,
        })),
      })),
    };

    setIsConfirming(true);
    setConfirmError(null);
    try {
      const response = await fetchWithAuth<{ payload: ConfirmResponsePayload }>(
        `/api/uploads/${encodeURIComponent(jobId)}/confirm`,
        { method: "POST", body: JSON.stringify(body) },
      );
      setConfirmResult(response.payload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Confirmation failed";
      setConfirmError(message);
    } finally {
      setIsConfirming(false);
    }
  }, [editedRecommendations, sseRecommendations, fileUpload.jobId, fetchWithAuth]);

  const cancel = useCallback(async () => {
    const jobId = fileUpload.jobId;
    if (!jobId) return;

    setIsCancelling(true);
    try {
      await fetchWithAuth(
        `/api/jobs/${encodeURIComponent(jobId)}/cancel`,
        { method: "POST" },
      );
    } catch {
      // Best-effort cancellation
    } finally {
      setIsCancelling(false);
    }
  }, [fileUpload.jobId, fetchWithAuth]);

  const reset = useCallback(() => {
    setUserStep(null);
    setFiles([]);
    setEditedRecommendations(null);
    setIsConfirming(false);
    setConfirmError(null);
    setConfirmResult(null);
    setIsCancelling(false);
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
    jobResult: stream.result,
    recommendations,
    parseResults,
    uploadError: fileUpload.error,
    isProcessing,
    isConfirming,
    confirmError,
    confirmResult,
    isCancelling,
    addFiles,
    removeFile,
    startUpload,
    goToStep,
    goNext,
    goBack,
    updateEntity,
    updateColumn,
    updateConnectorName,
    confirm,
    cancel,
    reset,
    canAdvance,
    connectionStatus: stream.connectionStatus,
  };
};
