/**
 * Pure UI sub-form rendered inside `BasicsStep` when the user selects
 * `basic` HTTP auth. Two fields: username + password (both credentials;
 * encrypted at rest).
 *
 * Pure presentational: all state + validation lives in the workflow
 * container. No SDK calls, no routing.
 */

import React from "react";

import TextField from "@mui/material/TextField";
import { Stack } from "@portalai/core/ui";

import type { FormErrors } from "../../utils/form-validation.util";
import { useDialogAutoFocus } from "../../utils/use-dialog-autofocus.util";

export interface BasicCredentialsFormUIProps {
  username: string;
  password: string;
  onUsernameChange: (next: string) => void;
  onPasswordChange: (next: string) => void;
  onBlur: (field: "username" | "password") => void;
  errors: FormErrors;
  touched: Record<string, boolean>;
}

export const BasicCredentialsFormUI: React.FC<BasicCredentialsFormUIProps> = ({
  username,
  password,
  onUsernameChange,
  onPasswordChange,
  onBlur,
  errors,
  touched,
}) => {
  // Sub-form mounts when the user picks `basic` in the auth dropdown.
  // Focus the first field on mount so the user can keep typing without
  // a second click.
  const usernameRef = useDialogAutoFocus<HTMLInputElement>(true);

  return (
    <Stack spacing={2}>
      <TextField
        inputRef={usernameRef}
        label="Username"
        value={username}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onUsernameChange(e.target.value)
        }
        onBlur={() => onBlur("username")}
        required
        fullWidth
        autoComplete="username"
        error={touched.username && !!errors.username}
        helperText={touched.username && errors.username}
        slotProps={{
          htmlInput: { "aria-invalid": touched.username && !!errors.username },
        }}
      />
      <TextField
        label="Password"
        type="password"
        value={password}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onPasswordChange(e.target.value)
        }
        onBlur={() => onBlur("password")}
        required
        fullWidth
        autoComplete="off"
        error={touched.password && !!errors.password}
        helperText={touched.password && errors.password}
        slotProps={{
          htmlInput: { "aria-invalid": touched.password && !!errors.password },
        }}
      />
    </Stack>
  );
};
