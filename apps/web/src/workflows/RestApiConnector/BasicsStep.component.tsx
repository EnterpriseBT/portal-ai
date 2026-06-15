/**
 * Step 1 — Basics. Name + base URL + auth mode + per-mode credentials.
 *
 * Phase 2 lights up all four auth modes (none / apiKey / bearer /
 * basic). When the user picks a non-`none` mode, a small per-mode
 * credentials sub-form renders below the dropdown. Credentials live in
 * the workflow container's state until commit; the API encrypts the
 * payload on `POST /api/connector-instances`.
 *
 * The dropdown is the single source of truth for `authMode`; switching
 * modes resets the credentials draft to that mode's empty defaults
 * (workflow container handles the reset so a stale bearer token can't
 * leak into the apiKey form on re-toggle).
 */

import React from "react";

import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { Stack } from "@portalai/core/ui";
import { FormAlert } from "../../components/FormAlert.component";
import type { ServerError } from "../../utils/api.util";
import type { FormErrors } from "../../utils/form-validation.util";
import { useDialogAutoFocus } from "../../utils/use-dialog-autofocus.util";

import {
  ApiKeyCredentialsFormUI,
  type ApiKeyPlacement,
} from "./ApiKeyCredentialsForm.component";
import { BearerCredentialsFormUI } from "./BearerCredentialsForm.component";
import { BasicCredentialsFormUI } from "./BasicCredentialsForm.component";
import type {
  AuthMode,
  CredentialsDraft,
} from "./utils/rest-api-validation.util";

// ── Pure UI ──────────────────────────────────────────────────────────

export interface BasicsStepUIProps {
  name: string;
  baseUrl: string;
  authMode: AuthMode;
  credentials: CredentialsDraft;
  onNameChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onAuthModeChange: (mode: AuthMode) => void;
  onCredentialsChange: <K extends keyof CredentialsDraft>(
    field: K,
    value: CredentialsDraft[K]
  ) => void;
  onBlur: (field: string) => void;
  errors: FormErrors;
  touched: Record<string, boolean>;
  serverError: ServerError | null;
}

export const BasicsStepUI: React.FC<BasicsStepUIProps> = ({
  name,
  baseUrl,
  authMode,
  credentials,
  onNameChange,
  onBaseUrlChange,
  onAuthModeChange,
  onCredentialsChange,
  onBlur,
  errors,
  touched,
  serverError,
}) => {
  // Step content mounts each time the user lands on step 0 (StepPanel
  // unmounts inactive children). The native `autoFocus` prop races with
  // MUI Modal's focus trap inside the workflow modal, so route through
  // the same delayed-focus hook used by dialogs.
  const nameRef = useDialogAutoFocus<HTMLInputElement>(true);

  return (
  <Stack spacing={2}>
    <FormAlert serverError={serverError} />
    <TextField
      inputRef={nameRef}
      label="Connector name"
      value={name}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
        onNameChange(e.target.value)
      }
      onBlur={() => onBlur("name")}
      required
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
    <TextField
      select
      label="Authentication"
      value={authMode}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
        onAuthModeChange(e.target.value as AuthMode)
      }
      fullWidth
    >
      <MenuItem value="none">None</MenuItem>
      <MenuItem value="apiKey">API key</MenuItem>
      <MenuItem value="bearer">Bearer token</MenuItem>
      <MenuItem value="basic">Basic (username + password)</MenuItem>
    </TextField>

    {authMode === "apiKey" ? (
      <ApiKeyCredentialsFormUI
        keyName={credentials.keyName}
        placement={credentials.placement}
        value={credentials.apiKeyValue}
        onKeyNameChange={(v) => onCredentialsChange("keyName", v)}
        onPlacementChange={(v: ApiKeyPlacement) =>
          onCredentialsChange("placement", v)
        }
        onValueChange={(v) => onCredentialsChange("apiKeyValue", v)}
        onBlur={onBlur}
        errors={errors}
        touched={touched}
      />
    ) : null}

    {authMode === "bearer" ? (
      <BearerCredentialsFormUI
        token={credentials.bearerToken}
        onTokenChange={(v) => onCredentialsChange("bearerToken", v)}
        onBlur={onBlur}
        errors={errors}
        touched={touched}
      />
    ) : null}

    {authMode === "basic" ? (
      <BasicCredentialsFormUI
        username={credentials.basicUsername}
        password={credentials.basicPassword}
        onUsernameChange={(v) => onCredentialsChange("basicUsername", v)}
        onPasswordChange={(v) => onCredentialsChange("basicPassword", v)}
        onBlur={onBlur}
        errors={errors}
        touched={touched}
      />
    ) : null}
  </Stack>
  );
};

// ── Container (no extra wiring — container lives one level up) ──────

export type BasicsStepProps = BasicsStepUIProps;

export const BasicsStep: React.FC<BasicsStepProps> = (props) => (
  <BasicsStepUI {...props} />
);
