/**
 * Pure UI sub-field rendered inside `ApiEndpointForm` when the method
 * is `POST`. A multi-line textarea for the request body template with
 * a hint tooltip listing the closed variable set ({{cursor}} +
 * {{pageNumber}}).
 *
 * Pure presentational: state + validation live in the workflow
 * container.
 */

import React from "react";

import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import { Stack, Typography } from "@portalai/core/ui";

export interface BodyTemplateFieldUIProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  touched?: boolean;
}

export const BodyTemplateFieldUI: React.FC<BodyTemplateFieldUIProps> = ({
  value,
  onChange,
  onBlur,
  error,
  touched,
}) => (
  <Stack spacing={0.5}>
    <Stack direction="row" alignItems="center" spacing={1}>
      <Typography variant="body2">Request body template</Typography>
      <Tooltip
        title={
          "Available template variables: {{cursor}}, {{pageNumber}}. " +
          "Other {{...}} placeholders will be rejected on save."
        }
      >
        <Typography
          variant="caption"
          sx={{ cursor: "help", color: "text.secondary" }}
          aria-label="Template variables hint"
        >
          (?)
        </Typography>
      </Tooltip>
    </Stack>
    <TextField
      value={value}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      onBlur={onBlur}
      multiline
      minRows={3}
      maxRows={10}
      fullWidth
      placeholder='{"page":{{pageNumber}},"size":50}'
      error={touched && !!error}
      helperText={touched && error}
      slotProps={{
        htmlInput: {
          "aria-label": "Body template",
          "aria-invalid": touched && !!error,
          spellCheck: false,
        },
      }}
    />
  </Stack>
);
