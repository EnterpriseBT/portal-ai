/**
 * Pure UI sub-form rendered inside `BasicsStep` when the user selects
 * `apiKey` auth. Surfaces the three apiKey-mode fields:
 *   - `keyName`    — header or query-param name (config; non-secret)
 *   - `placement`  — header | query (config; non-secret)
 *   - `value`      — the secret key (credentials; encrypted at rest)
 *
 * Pure presentational: all state + validation lives in the workflow
 * container. No SDK calls, no routing.
 */

import React from "react";

import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { Stack } from "@portalai/core/ui";

import type { FormErrors } from "../../utils/form-validation.util";
import { useDialogAutoFocus } from "../../utils/use-dialog-autofocus.util";

export type ApiKeyPlacement = "header" | "query";

export interface ApiKeyCredentialsFormUIProps {
  keyName: string;
  placement: ApiKeyPlacement;
  value: string;
  onKeyNameChange: (next: string) => void;
  onPlacementChange: (next: ApiKeyPlacement) => void;
  onValueChange: (next: string) => void;
  onBlur: (field: "keyName" | "placement" | "value") => void;
  errors: FormErrors;
  touched: Record<string, boolean>;
}

export const ApiKeyCredentialsFormUI: React.FC<
  ApiKeyCredentialsFormUIProps
> = ({
  keyName,
  placement,
  value,
  onKeyNameChange,
  onPlacementChange,
  onValueChange,
  onBlur,
  errors,
  touched,
}) => {
  // Sub-form mounts when the user picks `apiKey` in the auth dropdown.
  // Focus the first field on mount so the user can keep typing without
  // a second click.
  const keyNameRef = useDialogAutoFocus<HTMLInputElement>(true);

  return (
    <Stack spacing={2}>
      <TextField
        inputRef={keyNameRef}
        label="Header or query name"
        placeholder="X-API-Key"
        value={keyName}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onKeyNameChange(e.target.value)
        }
        onBlur={() => onBlur("keyName")}
        required
        fullWidth
        error={touched.keyName && !!errors.keyName}
        helperText={touched.keyName && errors.keyName}
        slotProps={{
          htmlInput: { "aria-invalid": touched.keyName && !!errors.keyName },
        }}
      />
      <TextField
        select
        label="Placement"
        value={placement}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onPlacementChange(e.target.value as ApiKeyPlacement)
        }
        onBlur={() => onBlur("placement")}
        fullWidth
      >
        <MenuItem value="header">Header</MenuItem>
        <MenuItem value="query">Query parameter</MenuItem>
      </TextField>
      <TextField
        label="API key value"
        type="password"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onValueChange(e.target.value)
        }
        onBlur={() => onBlur("value")}
        required
        fullWidth
        autoComplete="off"
        error={touched.value && !!errors.value}
        helperText={touched.value && errors.value}
        slotProps={{
          htmlInput: { "aria-invalid": touched.value && !!errors.value },
        }}
      />
    </Stack>
  );
};
