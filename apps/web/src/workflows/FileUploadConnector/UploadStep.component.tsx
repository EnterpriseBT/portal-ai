import React from "react";

import {
  Box,
  Stack,
  Typography,
  Progress,
  StatusMessage,
  FileUploader,
} from "@portalai/core/ui";

import type { JobStatus, FileParseResult } from "@portalai/core/models";

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
  jobStatus: JobStatus | null;
  jobResult: Record<string, unknown> | null;
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
      if (jobProgress <= 10) return "Verifying files...";
      if (jobProgress < 30) return "Parsing files...";
      if (jobProgress < 70) return "Analyzing schema...";
      if (jobProgress < 80) return "Generating recommendations...";
      return "Finalizing...";
    case "error":
      return "An error occurred";
    default:
      return "";
  }
}

/**
 * Split an XLSX-style fileName into its workbook + sheet parts.
 *   "data.xlsx[Contacts]" → { displayName: "data.xlsx", sheetName: "Contacts" }
 *   "contacts.csv"        → { displayName: "contacts.csv", sheetName: null }
 */
function parseDisplayFileName(fileName: string): { displayName: string; sheetName: string | null } {
  const match = fileName.match(/^(.+?)\[([^\]]+)\]$/);
  if (match) return { displayName: match[1], sheetName: match[2] };
  return { displayName: fileName, sheetName: null };
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
  jobStatus,
  jobResult,
}) => {
  const isUploading = uploadPhase === "uploading";
  const isActive = uploadPhase !== "idle" && uploadPhase !== "error";
  const error = jobError || uploadError;

  // Extract parse results from job result for completed jobs
  const parseResults = extractParseResults(jobResult);

  // Show file picker when idle or error (allow re-selection)
  if (uploadPhase === "idle" || (uploadPhase === "error" && !isProcessing)) {
    return (
      <Stack spacing={2}>
        <Typography variant="body1">
          Select one or more files to upload.
        </Typography>
        <FileUploader
          accept=".csv,.xlsx"
          multiple
          maxSizeMB={50}
          onChange={onFilesChange}
          helperText="Accepted formats: .csv, .xlsx (max 50MB per file, up to 5 files)"
        />
        {error && (
          <StatusMessage message={error} variant="error" />
        )}
      </Stack>
    );
  }

  // Show parse summary when job completed with results (Phase 2 temporary completion)
  if (jobStatus === "completed" && parseResults && parseResults.length > 0) {
    return (
      <Stack spacing={2}>
        <StatusMessage
          message={`Successfully parsed ${parseResults.length} file${parseResults.length > 1 ? "s" : ""}`}
          variant="success"
        />
        <Stack spacing={1.5}>
          {parseResults.map((result) => {
            const { displayName, sheetName } = parseDisplayFileName(result.fileName);
            return (
              <Box
                key={result.fileName}
                sx={{
                  p: 1.5,
                  borderRadius: 1,
                  bgcolor: "action.hover",
                }}
              >
                <Typography variant="body2" fontWeight="medium">
                  {displayName}
                  {sheetName && (
                    <Typography component="span" variant="body2" color="text.secondary">
                      {" — sheet: "}
                      {sheetName}
                    </Typography>
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {result.rowCount.toLocaleString()} rows
                  {" · "}delimiter: {formatDelimiter(result.delimiter)}
                  {" · "}encoding: {result.encoding}
                  {" · "}{result.headers.length} columns
                </Typography>
              </Box>
            );
          })}
        </Stack>
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
                <Progress value={progress?.percent ?? 0} height={6} animated />
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
            animated
          />
        </Box>
      )}
    </Stack>
  );
};

// --- Utilities ---

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDelimiter(d: string): string {
  if (d === ",") return "comma";
  if (d === "\t") return "tab";
  if (d === ";") return "semicolon";
  if (d === "|") return "pipe";
  if (d === "xlsx") return "N/A";
  return `"${d}"`;
}

function extractParseResults(
  result: Record<string, unknown> | null,
): FileParseResult[] | null {
  if (!result) return null;
  const pr = result.parseResults;
  if (!Array.isArray(pr) || pr.length === 0) return null;
  return pr as FileParseResult[];
}
