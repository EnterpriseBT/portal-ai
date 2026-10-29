import React, { useState } from "react";

import Alert from "@mui/material/Alert";
import TextField from "@mui/material/TextField";

import { SsoDiscoveryRequestBodySchema } from "@portalai/core/contracts";
import { Button, Stack, Typography } from "@portalai/core/ui";

import { FormAlert } from "./FormAlert.component";
import {
  focusFirstInvalidField,
  validateWithSchema,
  type FormErrors,
} from "../utils/form-validation.util";
import { blurUnlessDialogControl } from "../utils/dialog-blur.util";
import type { ServerError } from "../utils/api.util";

export interface SsoLoginFormUIProps {
  /** Called with the trimmed, validated work email. */
  onSubmit: (email: string) => void;
  onBack: () => void;
  /** The discovery lookup is in flight. */
  pending: boolean;
  /** The last lookup found no connection for the email's domain. */
  notConfigured: boolean;
  serverError: ServerError | null;
  /** Called on every edit, so the container can clear `notConfigured`. */
  onEmailChange?: () => void;
}

/**
 * #916: the "Sign in with SSO" step of the sign-in page. A work email is
 * looked up, and its domain's enterprise connection is where the container
 * sends the user. Pure: the field state is its own; the lookup is the
 * container's.
 */
export const SsoLoginFormUI: React.FC<SsoLoginFormUIProps> = ({
  onSubmit,
  onBack,
  pending,
  notConfigured,
  serverError,
  onEmailChange,
}) => {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  const validate = (value: string) =>
    validateWithSchema(SsoDiscoveryRequestBodySchema, { email: value });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    const result = validate(email);
    if (!result.success) {
      setErrors(result.errors);
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }
    setErrors({});
    if (!pending) onSubmit(result.data.email);
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(event.target.value);
    if (touched) {
      const result = validate(event.target.value);
      setErrors(result.success ? {} : result.errors);
    }
    onEmailChange?.();
  };

  const handleBlur = () => {
    setTouched(true);
    const result = validate(email);
    setErrors(result.success ? {} : result.errors);
  };

  const showError = touched && !!errors.email;

  return (
    <Stack component="form" spacing={2} noValidate onSubmit={handleSubmit}>
      <Typography variant="h6" component="h2">
        Sign in with SSO
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {
          "Enter your work email and we'll send you to your organization's sign-in."
        }
      </Typography>

      <FormAlert serverError={serverError} />
      {notConfigured && (
        <Alert severity="info">
          {
            "Single sign-on isn't set up for that email domain. Sign in with Google instead."
          }
        </Alert>
      )}

      <TextField
        label="Work email"
        type="email"
        autoComplete="email"
        required
        fullWidth
        autoFocus
        value={email}
        onChange={handleChange}
        onBlur={blurUnlessDialogControl(handleBlur)}
        error={showError}
        helperText={showError && errors.email}
        slotProps={{ htmlInput: { "aria-invalid": showError } }}
      />

      {/* Marked like a dialog's action row, so leaving the field for Back
          isn't a blur that flashes the empty-field error (#789's rule). */}
      <Stack spacing={2} data-dialog-controls>
        <Button
          type="submit"
          variant="contained"
          size="large"
          fullWidth
          disabled={pending}
          sx={{ textTransform: "none" }}
        >
          {pending ? "Continuing…" : "Continue"}
        </Button>
        <Button
          type="button"
          variant="text"
          fullWidth
          onClick={onBack}
          sx={{ textTransform: "none" }}
        >
          Back
        </Button>
      </Stack>
    </Stack>
  );
};
