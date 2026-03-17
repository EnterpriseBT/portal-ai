import React from "react";

import {
  Box,
  Stack,
  Typography,
  Progress,
  StatusMessage,
  FileUploader,
} from "@portalai/core/ui";

import type { FileUploadProgress, UploadPhase } from "../../utils/file-upload.util";

// --- Types ---

interface UploadStepProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  uploadPhase: UploadPhase;
  fileProgress: Map<string, FileUploadProgress>;
  overallUploadPercent: number;
  jobProgress: number;
  jobError: string | null;
  uploadError: string | null;
  isProcessing: boolean;
  connectionStatus: string;
}

// --- Phase Labels ---

function getPhaseLabel(
  uploadPhase: UploadPhase,
  jobProgress: number,
): string {
  switch (uploadPhase) {
    case "presigning":
      return "Preparing upload...";
    case "uploading":
      return "Uploading files to storage...";
    case "processing":
      return "Starting processing...";
    case "done":
      if (jobProgress < 30) return "Parsing CSV files...";
      if (jobProgress < 70) return "Analyzing schema...";
      if (jobProgress < 80) return "Generating recommendations...";
      return "Finalizing...";
    case "error":
      return "An error occurred";
    default:
      return "";
  }
}

// --- Component ---

export const UploadStep: React.FC<UploadStepProps> = ({
  files,
  onFilesChange,
  uploadPhase,
  fileProgress,
  overallUploadPercent,
  jobProgress,
  jobError,
  uploadError,
  isProcessing,
  connectionStatus,
}) => {
  const isUploading = uploadPhase === "uploading";
  const isActive = uploadPhase !== "idle" && uploadPhase !== "error";
  const error = jobError || uploadError;

  // Show file picker when idle or error (allow re-selection)
  if (uploadPhase === "idle" || (uploadPhase === "error" && !isProcessing)) {
    return (
      <Stack spacing={2}>
        <Typography variant="body1">
          Select one or more CSV files to upload.
        </Typography>
        <FileUploader
          accept=".csv"
          multiple
          maxSizeMB={50}
          onChange={onFilesChange}
          helperText="Accepted formats: .csv (max 50MB per file, up to 5 files)"
        />
        {error && (
          <StatusMessage message={error} variant="error" />
        )}
      </Stack>
    );
  }

  // Show upload/processing progress
  return (
    <Stack spacing={2}>
      <Typography variant="body1" fontWeight="medium">
        {getPhaseLabel(uploadPhase, jobProgress)}
      </Typography>

      {connectionStatus === "error" && (
        <StatusMessage message="Connection lost. Reconnecting..." variant="warning" />
      )}

      {error && (
        <StatusMessage message={error} variant="error" />
      )}

      {/* Per-file upload progress */}
      {isUploading && (
        <Stack spacing={1}>
          {files.map((file) => {
            const progress = fileProgress.get(file.name);
            return (
              <Box key={file.name}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  sx={{ mb: 0.5 }}
                >
                  <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                    {file.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatBytes(progress?.loaded ?? 0)} / {formatBytes(file.size)}
                  </Typography>
                </Stack>
                <Progress value={progress?.percent ?? 0} height={6} />
              </Box>
            );
          })}
        </Stack>
      )}

      {/* Overall progress during processing */}
      {isActive && !isUploading && (
        <Box>
          <Progress
            value={uploadPhase === "done" ? jobProgress : overallUploadPercent}
            height={8}
          />
        </Box>
      )}
    </Stack>
  );
};

// --- Utility ---

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
