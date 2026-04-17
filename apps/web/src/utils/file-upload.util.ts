import { useCallback, useState } from "react";

import type {
  PresignRequestBody,
  PresignResponsePayload,
  PresignUploadItem,
} from "@portalai/core/contracts";

import { sdk } from "../api/sdk";
import { ApiError, type ServerError } from "./api.util";

// --- Types ---

export interface FileUploadProgress {
  fileName: string;
  loaded: number;
  total: number;
  percent: number;
}

export type UploadPhase = "idle" | "presigning" | "uploading" | "processing" | "done" | "error";

export interface UseFileUploadState {
  phase: UploadPhase;
  jobId: string | null;
  fileProgress: Map<string, FileUploadProgress>;
  overallPercent: number;
  /**
   * Structured error surfaced on any failed phase. For API failures
   * (presign, process), this preserves the `code` from `ApiError` so
   * callers can branch on specific backend error codes. For S3 / client
   * failures the code falls back to `UPLOAD_FAILED`.
   */
  error: ServerError | null;
}

export interface UseFileUploadReturn extends UseFileUploadState {
  /**
   * Presign files, upload them to S3 in parallel with progress tracking,
   * then trigger backend processing.
   *
   * @param files - Browser File objects to upload
   * @param presignParams - Fields forwarded to `POST /api/uploads/presign`
   *   (`organizationId`, `connectorDefinitionId`). The `files` array is
   *   built automatically from the `files` argument.
   * @returns The job ID created by the presign endpoint
   */
  startUpload: (
    files: File[],
    presignParams: Omit<PresignRequestBody, "files">,
  ) => Promise<string>;
  reset: () => void;
}

// --- Helpers ---

function uploadFileToS3(
  file: File,
  upload: PresignUploadItem,
  onProgress: (loaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", upload.presignedUrl, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded, e.total);
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`S3 upload failed for ${file.name}: HTTP ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error(`Network error uploading ${file.name}`));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error(`Upload aborted for ${file.name}`));
    });

    xhr.send(file);
  });
}

// --- Hook ---

const INITIAL_STATE: UseFileUploadState = {
  phase: "idle",
  jobId: null,
  fileProgress: new Map(),
  overallPercent: 0,
  error: null,
};

export const useFileUpload = (): UseFileUploadReturn => {
  const [state, setState] = useState<UseFileUploadState>(INITIAL_STATE);

  const { mutateAsync: presign } = sdk.uploads.presign();
  const { mutateAsync: process } = sdk.uploads.process();

  const startUpload = useCallback(
    async (
      files: File[],
      presignParams: Omit<PresignRequestBody, "files">,
    ): Promise<string> => {
      try {
        // Phase 1: Presign
        setState((prev) => ({ ...prev, phase: "presigning", error: null }));

        const presignBody: PresignRequestBody = {
          ...presignParams,
          files: files.map((f) => ({
            fileName: f.name,
            contentType: f.type || "application/octet-stream",
            sizeBytes: f.size,
          })),
        };

        const presignResult: PresignResponsePayload = await presign(presignBody);
        const { jobId, uploads } = presignResult;

        setState((prev) => ({ ...prev, jobId, phase: "uploading" }));

        // Phase 2: Upload files to S3 in parallel via XHR for progress tracking
        const progressMap = new Map<string, FileUploadProgress>();
        files.forEach((f) => {
          progressMap.set(f.name, {
            fileName: f.name,
            loaded: 0,
            total: f.size,
            percent: 0,
          });
        });

        setState((prev) => ({
          ...prev,
          fileProgress: new Map(progressMap),
        }));

        const uploadPromises = files.map((file, index) => {
          const upload = uploads[index];
          return uploadFileToS3(file, upload, (loaded, total) => {
            progressMap.set(file.name, {
              fileName: file.name,
              loaded,
              total,
              percent: Math.round((loaded / total) * 100),
            });

            let totalLoaded = 0;
            let totalSize = 0;
            for (const p of progressMap.values()) {
              totalLoaded += p.loaded;
              totalSize += p.total;
            }
            const overallPercent = totalSize > 0 ? Math.round((totalLoaded / totalSize) * 100) : 0;

            setState((prev) => ({
              ...prev,
              fileProgress: new Map(progressMap),
              overallPercent,
            }));
          });
        });

        await Promise.all(uploadPromises);

        // Phase 3: Signal that uploads are complete, trigger processing
        setState((prev) => ({ ...prev, phase: "processing" }));

        await process({ jobId });

        setState((prev) => ({ ...prev, phase: "done" }));

        return jobId;
      } catch (err) {
        const error: ServerError =
          err instanceof ApiError
            ? { message: err.message, code: err.code || "UNKNOWN_CODE" }
            : {
                message: err instanceof Error ? err.message : "Upload failed",
                code: "UPLOAD_FAILED",
              };
        setState((prev) => ({ ...prev, phase: "error", error }));
        throw err;
      }
    },
    [presign, process],
  );

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return {
    ...state,
    startUpload,
    reset,
  };
};
