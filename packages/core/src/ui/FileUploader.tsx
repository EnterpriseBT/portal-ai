import React, { useCallback, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import UploadFileIcon from "@mui/icons-material/UploadFile";

export interface FileUploaderProps {
  accept?: string;
  multiple?: boolean;
  maxSizeMB?: number;
  onChange?: (files: File[]) => void;
  disabled?: boolean;
  helperText?: string;
  error?: boolean;
  className?: string;
  [key: `data-${string}`]: string;
}

export const FileUploader = React.forwardRef<HTMLDivElement, FileUploaderProps>(
  (
    {
      accept,
      multiple = false,
      maxSizeMB,
      onChange,
      disabled = false,
      helperText,
      error = false,
      className,
      ...rest
    },
    ref
  ) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragActive, setDragActive] = useState(false);
    const [files, setFiles] = useState<File[]>([]);
    const [errorMessage, setErrorMessage] = useState<string>();

    const validateAndSetFiles = useCallback(
      (incoming: FileList | null) => {
        if (!incoming) return;

        const valid: File[] = [];
        for (const file of Array.from(incoming)) {
          if (maxSizeMB && file.size > maxSizeMB * 1024 * 1024) {
            setErrorMessage(
              `${file.name} exceeds the ${maxSizeMB}MB size limit`
            );
            return;
          }
          valid.push(file);
        }

        setErrorMessage(undefined);
        const next = multiple ? [...files, ...valid] : valid;
        setFiles(next);
        onChange?.(next);
      },
      [files, maxSizeMB, multiple, onChange]
    );

    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        setDragActive(false);
        if (!disabled) {
          validateAndSetFiles(e.dataTransfer.files);
        }
      },
      [disabled, validateAndSetFiles]
    );

    const handleDragOver = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        if (!disabled) setDragActive(true);
      },
      [disabled]
    );

    const handleDragLeave = useCallback(() => {
      setDragActive(false);
    }, []);

    const handleClick = () => {
      if (!disabled) inputRef.current?.click();
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      validateAndSetFiles(e.target.files);
      if (inputRef.current) inputRef.current.value = "";
    };

    const removeFile = (index: number) => {
      const next = files.filter((_, i) => i !== index);
      setFiles(next);
      onChange?.(next);
    };

    const borderColor = error || errorMessage ? "error.main" : dragActive ? "primary.main" : "divider";

    return (
      <Box ref={ref} className={className} {...rest}>
        <Box
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
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.5 : 1,
            bgcolor: dragActive ? "action.hover" : "transparent",
            transition: "all 0.2s ease",
          }}
          data-testid="dropzone"
        >
          <UploadFileIcon
            sx={{ fontSize: 40, color: "text.secondary", mb: 1 }}
          />
          <Typography variant="body2" color="text.secondary">
            Drag and drop files here, or click to browse
          </Typography>
          {accept && (
            <Typography variant="caption" color="text.secondary">
              Accepted: {accept}
            </Typography>
          )}
        </Box>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleInputChange}
          style={{ display: "none" }}
          data-testid="file-input"
        />
        {(errorMessage || helperText) && (
          <Typography
            variant="caption"
            color={error || errorMessage ? "error" : "text.secondary"}
            sx={{ mt: 0.5, display: "block" }}
          >
            {errorMessage || helperText}
          </Typography>
        )}
        {files.length > 0 && (
          <Stack spacing={0.5} sx={{ mt: 1 }}>
            {files.map((file, index) => (
              <Stack
                key={`${file.name}-${index}`}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{
                  px: 1,
                  py: 0.5,
                  bgcolor: "action.hover",
                  borderRadius: 1,
                }}
              >
                <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                  {file.name}
                </Typography>
                <IconButton
                  size="small"
                  onClick={() => removeFile(index)}
                  aria-label={`Remove ${file.name}`}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
        )}
      </Box>
    );
  }
);

export default FileUploader;
