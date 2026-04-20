import React, { useCallback, useRef, useState } from "react";

import { Box, Stack, Typography, Progress, Button } from "@portalai/core/ui";

import { FormAlert } from "../../components/FormAlert.component";
import type { ServerError } from "../../utils/api.util";
import type { FileUploadProgress } from "../../utils/file-upload.util";
import { SPREADSHEET_FILE_EXTENSIONS } from "./utils/file-upload-fixtures.util";
import type { UploadPhase } from "./utils/file-upload-fixtures.util";
import { SampleFiles } from "./SampleFiles.component";

export interface UploadStepUIProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  uploadPhase: UploadPhase;
  fileProgress: Map<string, FileUploadProgress>;
  overallUploadPercent: number;
  serverError: ServerError | null;
  errors?: { files?: string };
  onRetry?: () => void;
}

const ACCEPT_ATTRIBUTE = SPREADSHEET_FILE_EXTENSIONS.join(",");

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function mergeUnique(existing: File[], incoming: File[]): File[] {
  const merged = [...existing];
  const seen = new Set(existing.map((f) => f.name));
  for (const file of incoming) {
    if (seen.has(file.name)) continue;
    seen.add(file.name);
    merged.push(file);
  }
  return merged;
}

export const UploadStep: React.FC<UploadStepUIProps> = ({
  files,
  onFilesChange,
  uploadPhase,
  fileProgress,
  overallUploadPercent,
  serverError,
  errors,
  onRetry,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const isBusy = uploadPhase === "uploading" || uploadPhase === "parsing";
  const hasFieldError = Boolean(errors?.files);

  const handleIncoming = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const merged = mergeUnique(files, Array.from(list));
      if (merged.length === files.length) return;
      onFilesChange(merged);
    },
    [files, onFilesChange]
  );

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleIncoming(event.target.files);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (isBusy) return;
    handleIncoming(event.dataTransfer.files);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!isBusy) setDragActive(true);
  };

  const handleDragLeave = () => setDragActive(false);

  const handleClick = () => {
    if (isBusy) return;
    inputRef.current?.click();
  };

  const borderColor = hasFieldError
    ? "error.main"
    : dragActive
    ? "primary.main"
    : "divider";

  return (
    <Stack spacing={2}>
      <Typography variant="body1">
        Select one or more spreadsheets to upload.
      </Typography>

      <SampleFiles />

      <Box
        data-testid="dropzone"
        onClick={handleClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        sx={{
          border: 2,
          borderStyle: "dashed",
          borderColor,
          borderRadius: 1,
          p: 3,
          textAlign: "center",
          cursor: isBusy ? "default" : "pointer",
          opacity: isBusy ? 0.5 : 1,
          bgcolor: dragActive ? "action.hover" : "transparent",
          transition: "all 0.2s ease",
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Drag and drop spreadsheets here, or click to browse.
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Accepted formats: {SPREADSHEET_FILE_EXTENSIONS.join(", ")}
        </Typography>
      </Box>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple
        onChange={handleInputChange}
        disabled={isBusy}
        aria-invalid={hasFieldError ? true : undefined}
        aria-describedby={hasFieldError ? "upload-step-files-error" : undefined}
        data-testid="file-input"
        style={{ display: "none" }}
      />

      {hasFieldError && (
        <Typography
          id="upload-step-files-error"
          variant="caption"
          color="error"
        >
          {errors?.files}
        </Typography>
      )}

      {serverError && <FormAlert serverError={serverError} />}

      {files.length > 0 && (
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
                <Progress
                  value={progress?.percent ?? 0}
                  height={6}
                  animated={uploadPhase === "uploading"}
                />
              </Box>
            );
          })}
        </Stack>
      )}

      {(uploadPhase === "uploading" || uploadPhase === "parsing") && (
        <Box>
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            {uploadPhase === "uploading"
              ? "Uploading..."
              : "Parsing spreadsheet..."}
          </Typography>
          <Progress value={overallUploadPercent} height={8} animated />
        </Box>
      )}

      {uploadPhase === "error" && onRetry && (
        <Stack direction="row" justifyContent="flex-end">
          <Button variant="outlined" onClick={onRetry}>
            Retry
          </Button>
        </Stack>
      )}
    </Stack>
  );
};
