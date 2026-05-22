/**
 * Pure UI sub-form rendered inside `BasicsStep` when the user selects
 * `bearer` auth. One field: the token (credentials; encrypted at rest).
 *
 * Pure presentational: all state + validation lives in the workflow
 * container. No SDK calls, no routing.
 */

import React from "react";

import TextField from "@mui/material/TextField";
import { Stack } from "@portalai/core/ui";

import type { FormErrors } from "../../utils/form-validation.util";

export interface BearerCredentialsFormUIProps {
  token: string;
  onTokenChange: (next: string) => void;
  onBlur: (field: "token") => void;
  errors: FormErrors;
  touched: Record<string, boolean>;
}

export const BearerCredentialsFormUI: React.FC<BearerCredentialsFormUIProps> = ({
  token,
  onTokenChange,
  onBlur,
  errors,
  touched,
}) => (
  <Stack spacing={2}>
    <TextField
      label="Bearer token"
      type="password"
      value={token}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
        onTokenChange(e.target.value)
      }
      onBlur={() => onBlur("token")}
      required
      fullWidth
      autoComplete="off"
      error={touched.token && !!errors.token}
      helperText={touched.token && errors.token}
      slotProps={{
        htmlInput: { "aria-invalid": touched.token && !!errors.token },
      }}
    />
  </Stack>
);
