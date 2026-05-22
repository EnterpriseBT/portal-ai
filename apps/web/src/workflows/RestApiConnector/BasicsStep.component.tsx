/**
 * Step 1 — Basics. Name + base URL. Auth dropdown is rendered with
 * only the "none" option enabled in phase 1; phase 2 will light up
 * the remaining auth modes (apiKey / bearer / basic).
 */

import React from "react";

import TextField from "@mui/material/TextField";
import { Stack, Typography } from "@portalai/core/ui";
import { FormAlert } from "../../components/FormAlert.component";
import type { ServerError } from "../../utils/api.util";
import type { FormErrors } from "../../utils/form-validation.util";

// ── Pure UI ──────────────────────────────────────────────────────────

export interface BasicsStepUIProps {
  name: string;
  baseUrl: string;
  onNameChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onBlur: (field: "name" | "baseUrl") => void;
  errors: FormErrors;
  touched: Record<string, boolean>;
  serverError: ServerError | null;
}

export const BasicsStepUI: React.FC<BasicsStepUIProps> = ({
  name,
  baseUrl,
  onNameChange,
  onBaseUrlChange,
  onBlur,
  errors,
  touched,
  serverError,
}) => (
  <Stack spacing={2}>
    <FormAlert serverError={serverError} />
    <TextField
      label="Connector name"
      value={name}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
        onNameChange(e.target.value)
      }
      onBlur={() => onBlur("name")}
      required
      autoFocus
      fullWidth
      error={touched.name && !!errors.name}
      helperText={touched.name && errors.name}
      slotProps={{
        htmlInput: { "aria-invalid": touched.name && !!errors.name },
      }}
    />
    <TextField
      label="Base URL"
      placeholder="https://api.example.com"
      value={baseUrl}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
        onBaseUrlChange(e.target.value)
      }
      onBlur={() => onBlur("baseUrl")}
      required
      fullWidth
      error={touched.baseUrl && !!errors.baseUrl}
      helperText={touched.baseUrl && errors.baseUrl}
      slotProps={{
        htmlInput: { "aria-invalid": touched.baseUrl && !!errors.baseUrl },
      }}
    />
    <Typography variant="caption" color="text.secondary">
      Phase 1 only supports unauthenticated endpoints. API key / bearer
      / basic auth land in phase 2.
    </Typography>
  </Stack>
);

// ── Container (no extra wiring in phase 1) ──────────────────────────

export interface BasicsStepProps extends BasicsStepUIProps {}

export const BasicsStep: React.FC<BasicsStepProps> = (props) => (
  <BasicsStepUI {...props} />
);
