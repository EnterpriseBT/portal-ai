import React, { useState, useCallback } from "react";

import { TextField, Checkbox, FormControlLabel, MenuItem } from "@mui/material";
import type { ResolvedColumn } from "@portalai/core/contracts";

import { geoJsonGeometryError } from "../utils/record-field-serialization.util";

// ── Props ────────────────────────────────────────────────────────────

export interface DynamicRecordFieldProps {
  column: ResolvedColumn;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  /** Field-level error message (from validation). */
  error?: string;
  /** Whether this field has been touched (for showing errors). */
  touched?: boolean;
  /** Ref for auto-focus (passed to first field in dialog). */
  inputRef?: React.Ref<HTMLInputElement>;
  /** Called when the field loses focus. */
  onBlur?: () => void;
  /** Disable the field (e.g., during submission). */
  disabled?: boolean;
}

const CODE_EDITOR_PLACEHOLDER: Partial<Record<string, string>> = {
  json: "{}",
  array: "[]",
};

const GEOMETRY_HELPER_TEXT =
  'GeoJSON geometry, e.g. {"type":"Point","coordinates":[lng,lat]}';

// ── Component ────────────────────────────────────────────────────────

export const DynamicRecordField: React.FC<DynamicRecordFieldProps> = ({
  column,
  value,
  onChange,
  error,
  touched,
  onBlur,
  inputRef,
  disabled,
}) => {
  const [localError, setLocalError] = useState<string | undefined>();

  const showError = touched && !!(error || localError);
  const errorText = touched ? error || localError : undefined;

  const handleBlurCodeEditor = useCallback(
    (raw: string) => {
      onBlur?.();
      if (raw === "") {
        setLocalError(undefined);
        return;
      }
      const isGeometry = column.type === "geometry";
      try {
        const parsed = JSON.parse(raw);
        if (column.type === "array" && !Array.isArray(parsed)) {
          setLocalError("Value must be a JSON array");
          return;
        }
        const geometryProblem = isGeometry
          ? geoJsonGeometryError(parsed)
          : null;
        if (geometryProblem) {
          setLocalError(geometryProblem);
          return;
        }
        // #757: validate only. Reformatting the text here grew the field
        // between a press and release on the dialog's submit button, so the
        // click that blurred the field was lost.
        setLocalError(undefined);
      } catch (e) {
        setLocalError(
          `${isGeometry ? "Invalid GeoJSON" : "Invalid JSON"}: ${(e as Error).message}`
        );
      }
    },
    [column.type, onBlur]
  );

  const codeEditorSx = {
    "& .MuiInputBase-input, & .MuiInputBase-inputMultiline": {
      typography: "monospace",
      backgroundColor: "action.hover",
    },
  };

  switch (column.type) {
    case "boolean":
      return (
        <FormControlLabel
          control={
            <Checkbox
              checked={Boolean(value)}
              onChange={(e) => onChange(column.normalizedKey, e.target.checked)}
              disabled={disabled}
              slotProps={{ input: { ref: inputRef } }}
            />
          }
          label={column.label}
        />
      );

    case "number":
      return (
        <TextField
          label={column.label}
          type="number"
          value={value ?? ""}
          onChange={(e) => onChange(column.normalizedKey, e.target.value)}
          onBlur={onBlur}
          fullWidth
          size="small"
          disabled={disabled}
          inputRef={inputRef}
          required={column.required}
          error={showError}
          helperText={errorText}
          slotProps={{
            htmlInput: {
              step: "any",
              "aria-invalid": showError,
            },
          }}
        />
      );

    case "date":
      return (
        <TextField
          label={column.label}
          type="date"
          value={value ?? ""}
          onChange={(e) => onChange(column.normalizedKey, e.target.value)}
          onBlur={onBlur}
          fullWidth
          size="small"
          disabled={disabled}
          inputRef={inputRef}
          required={column.required}
          error={showError}
          helperText={errorText}
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: { "aria-invalid": showError },
          }}
        />
      );

    case "datetime":
      return (
        <TextField
          label={column.label}
          type="datetime-local"
          value={value ?? ""}
          onChange={(e) => onChange(column.normalizedKey, e.target.value)}
          onBlur={onBlur}
          fullWidth
          size="small"
          disabled={disabled}
          inputRef={inputRef}
          required={column.required}
          error={showError}
          helperText={errorText}
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: { "aria-invalid": showError },
          }}
        />
      );

    case "enum": {
      const hasOptions =
        column.enumValues != null && column.enumValues.length > 0;

      if (!hasOptions) {
        return (
          <TextField
            label={column.label}
            value={value ?? ""}
            onChange={(e) => onChange(column.normalizedKey, e.target.value)}
            onBlur={onBlur}
            fullWidth
            size="small"
            disabled={disabled}
            inputRef={inputRef}
            required={column.required}
            error={showError}
            helperText={errorText}
            slotProps={{
              htmlInput: { "aria-invalid": showError },
            }}
          />
        );
      }

      return (
        <TextField
          label={column.label}
          select
          value={value ?? ""}
          onChange={(e) => onChange(column.normalizedKey, e.target.value)}
          onBlur={onBlur}
          fullWidth
          size="small"
          disabled={disabled}
          inputRef={inputRef}
          required={column.required}
          error={showError}
          helperText={errorText}
          slotProps={{
            htmlInput: { "aria-invalid": showError },
          }}
        >
          {!column.required && (
            <MenuItem value="">
              <em>None</em>
            </MenuItem>
          )}
          {column.enumValues!.map((opt) => (
            <MenuItem key={opt} value={opt}>
              {opt}
            </MenuItem>
          ))}
        </TextField>
      );
    }

    case "json":
    case "array":
    case "geometry":
      return (
        <TextField
          label={column.label}
          value={value ?? ""}
          onChange={(e) => onChange(column.normalizedKey, e.target.value)}
          onBlur={(e) => handleBlurCodeEditor(e.target.value)}
          fullWidth
          size="small"
          multiline
          minRows={4}
          placeholder={CODE_EDITOR_PLACEHOLDER[column.type]}
          disabled={disabled}
          inputRef={inputRef}
          required={column.required}
          error={showError}
          helperText={
            errorText ||
            (column.type === "geometry" ? GEOMETRY_HELPER_TEXT : undefined)
          }
          sx={codeEditorSx}
          slotProps={{
            htmlInput: { "aria-invalid": showError },
          }}
        />
      );

    case "reference-array":
      return (
        <TextField
          label={column.label}
          value={value ?? ""}
          onChange={(e) => onChange(column.normalizedKey, e.target.value)}
          onBlur={onBlur}
          fullWidth
          size="small"
          multiline
          rows={2}
          placeholder="Comma-separated IDs"
          disabled={disabled}
          inputRef={inputRef}
          required={column.required}
          error={showError}
          helperText={errorText}
          slotProps={{
            htmlInput: { "aria-invalid": showError },
          }}
        />
      );

    // string, reference, and any unknown types
    default:
      return (
        <TextField
          label={column.label}
          value={value ?? ""}
          onChange={(e) => onChange(column.normalizedKey, e.target.value)}
          onBlur={onBlur}
          fullWidth
          size="small"
          disabled={disabled}
          inputRef={inputRef}
          required={column.required}
          error={showError}
          helperText={errorText}
          slotProps={{
            htmlInput: { "aria-invalid": showError },
          }}
        />
      );
  }
};
