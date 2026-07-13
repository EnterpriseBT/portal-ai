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
import { useDialogAutoFocus } from "../../utils/use-dialog-autofocus.util";

export interface BearerCredentialsFormUIProps {
  token: string;
  onTokenChange: (next: string) => void;
  onBlur: (field: "token") => void;
  errors: FormErrors;
  touched: Record<string, boolean>;
}

export const BearerCredentialsFormUI: React.FC<
  BearerCredentialsFormUIProps
> = ({ token, onTokenChange, onBlur, errors, touched }) => {
  // Sub-form mounts when the user picks `bearer` in the auth dropdown.
  // Focus the only field on mount so the user can paste the token
  // without a second click.
  const tokenRef = useDialogAutoFocus<HTMLInputElement>(true);

  return (
    <Stack spacing={2}>
      <TextField
        inputRef={tokenRef}
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
};
