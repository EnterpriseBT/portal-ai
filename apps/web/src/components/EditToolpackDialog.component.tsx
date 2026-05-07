import React, { useState } from "react";

import {
  UpdateToolpackBodySchema,
  type UpdateToolpackBody,
  type Toolpack,
} from "@portalai/core/contracts";
import { Button, Modal, Stack } from "@portalai/core/ui";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";
import {
  validateWithSchema,
  focusFirstInvalidField,
  type FormErrors,
} from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";
import { parseAuthHeaders } from "./RegisterToolpackDialog.component";

interface FormState {
  name: string;
  description: string;
  schemaUrl: string;
  runtimeUrl: string;
  metadataUrl: string;
  /** Empty when untouched. Non-empty replaces the stored auth headers. */
  authHeaders: string;
}

function formStateFrom(toolpack: Toolpack | null): FormState {
  if (!toolpack || toolpack.kind !== "custom") {
    return {
      name: "",
      description: "",
      schemaUrl: "",
      runtimeUrl: "",
      metadataUrl: "",
      authHeaders: "",
    };
  }
  return {
    name: toolpack.name,
    description: toolpack.description ?? "",
    schemaUrl: toolpack.endpoints.schema,
    runtimeUrl: toolpack.endpoints.runtime,
    metadataUrl: toolpack.endpoints.metadata ?? "",
    authHeaders: "",
  };
}

function buildPatch(
  initial: FormState,
  current: FormState
): { body?: UpdateToolpackBody; errors: FormErrors } {
  const errors: FormErrors = {};
  const patch: UpdateToolpackBody = {};

  if (current.name.trim() !== initial.name.trim()) {
    patch.name = current.name.trim();
  }
  if (current.description.trim() !== initial.description.trim()) {
    patch.description = current.description.trim() || undefined;
  }
  const endpointsChanged =
    current.schemaUrl.trim() !== initial.schemaUrl.trim() ||
    current.runtimeUrl.trim() !== initial.runtimeUrl.trim() ||
    current.metadataUrl.trim() !== initial.metadataUrl.trim();
  if (endpointsChanged) {
    patch.endpoints = {
      schema: current.schemaUrl.trim(),
      runtime: current.runtimeUrl.trim(),
      ...(current.metadataUrl.trim()
        ? { metadata: current.metadataUrl.trim() }
        : {}),
    };
  }
  if (current.authHeaders.trim()) {
    const result = parseAuthHeaders(current.authHeaders);
    if (!result.ok) {
      errors.authHeaders = `Malformed header on line ${result.line}. Use "KEY: value".`;
    } else {
      patch.authHeaders = result.value;
    }
  }

  if (Object.keys(patch).length === 0 && Object.keys(errors).length === 0) {
    errors._form = "At least one field must change.";
    return { errors };
  }

  if (Object.keys(patch).length > 0) {
    const validation = validateWithSchema(UpdateToolpackBodySchema, patch);
    if (!validation.success) {
      Object.assign(errors, validation.errors);
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }
  return { body: patch, errors: {} };
}

// ── Pure UI ──────────────────────────────────────────────────────────

export interface EditToolpackDialogUIProps {
  open: boolean;
  toolpack: Toolpack | null;
  onClose: () => void;
  onSubmit: (body: UpdateToolpackBody) => void;
  onRefresh: () => void;
  /**
   * Phase 6: invalidate the existing signing secret and reveal a
   * fresh one. The reveal is handled by the parent — this callback
   * only fires the rotate request; the parent opens
   * `SigningSecretRevealDialogUI` with the new secret on success.
   */
  onRotateSecret: () => void;
  isPending: boolean;
  isRefreshing: boolean;
  /** True while the rotate-signing-secret mutation is in flight. */
  isRotatingSecret: boolean;
  serverError: ServerError | null;
  refreshError: ServerError | null;
}

export const EditToolpackDialogUI: React.FC<EditToolpackDialogUIProps> = ({
  open,
  toolpack,
  onClose,
  onSubmit,
  onRefresh,
  onRotateSecret,
  isPending,
  isRefreshing,
  isRotatingSecret,
  serverError,
  refreshError,
}) => {
  const initial = React.useMemo(() => formStateFrom(toolpack), [toolpack]);
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const nameRef = useDialogAutoFocus(open);

  React.useEffect(() => {
    if (open) {
      setForm(initial);
      setErrors({});
      setTouched({});
    }
  }, [open, initial]);

  const handleChange = (field: keyof FormState, value: string) => {
    const next = { ...form, [field]: value };
    setForm(next);
    if (touched[field]) {
      const { errors: nextErrors } = buildPatch(initial, next);
      setErrors(nextErrors);
    }
  };

  const handleBlur = (field: keyof FormState) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const { errors: nextErrors } = buildPatch(initial, form);
    setErrors(nextErrors);
  };

  const handleSubmit = () => {
    setTouched({
      name: true,
      schemaUrl: true,
      runtimeUrl: true,
      authHeaders: true,
    });
    const { body, errors: nextErrors } = buildPatch(initial, form);
    setErrors(nextErrors);
    if (!body) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }
    onSubmit(body);
  };

  const fieldError = (key: string, ...alternates: string[]): string | "" => {
    const match = [key, ...alternates].find((k) => errors[k]);
    return match ? errors[match] : "";
  };

  const authHeadersStatus =
    toolpack && toolpack.kind === "custom"
      ? toolpack.authHeadersStatus.has
      : false;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit toolpack"
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          component: "form",
          onSubmit: (e: React.FormEvent) => {
            e.preventDefault();
            handleSubmit();
          },
        } as object,
      }}
      actions={
        <Stack direction="row" spacing={1}>
          <Button
            type="button"
            variant="text"
            onClick={onRefresh}
            disabled={isRefreshing || isPending || isRotatingSecret}
          >
            {isRefreshing ? "Refreshing..." : "Refresh schema"}
          </Button>
          <Button
            type="button"
            variant="text"
            onClick={onRotateSecret}
            disabled={isRotatingSecret || isPending || isRefreshing}
            data-testid="rotate-signing-secret-button"
          >
            {isRotatingSecret ? "Rotating..." : "Rotate signing secret"}
          </Button>
          <Button
            type="button"
            variant="outlined"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="contained"
            onClick={handleSubmit}
            disabled={isPending}
          >
            {isPending ? "Saving..." : "Save"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <TextField
          inputRef={nameRef}
          label="Name"
          value={form.name}
          onChange={(e) => handleChange("name", e.target.value)}
          onBlur={() => handleBlur("name")}
          error={touched.name && !!fieldError("name")}
          helperText={touched.name && fieldError("name")}
          slotProps={{
            htmlInput: {
              "aria-invalid": touched.name && !!fieldError("name"),
            },
          }}
          fullWidth
        />
        <TextField
          label="Description"
          value={form.description}
          onChange={(e) => handleChange("description", e.target.value)}
          fullWidth
          multiline
          rows={2}
        />
        <TextField
          label="Schema endpoint"
          value={form.schemaUrl}
          onChange={(e) => handleChange("schemaUrl", e.target.value)}
          onBlur={() => handleBlur("schemaUrl")}
          error={touched.schemaUrl && !!fieldError("endpoints.schema")}
          helperText={
            (touched.schemaUrl && fieldError("endpoints.schema")) ||
            "Editing endpoints triggers a re-fetch of the cached schema."
          }
          slotProps={{
            htmlInput: {
              "aria-invalid":
                touched.schemaUrl && !!fieldError("endpoints.schema"),
            },
          }}
          fullWidth
        />
        <TextField
          label="Runtime endpoint"
          value={form.runtimeUrl}
          onChange={(e) => handleChange("runtimeUrl", e.target.value)}
          onBlur={() => handleBlur("runtimeUrl")}
          error={touched.runtimeUrl && !!fieldError("endpoints.runtime")}
          helperText={touched.runtimeUrl && fieldError("endpoints.runtime")}
          slotProps={{
            htmlInput: {
              "aria-invalid":
                touched.runtimeUrl && !!fieldError("endpoints.runtime"),
            },
          }}
          fullWidth
        />
        <TextField
          label="Metadata endpoint (optional)"
          value={form.metadataUrl}
          onChange={(e) => handleChange("metadataUrl", e.target.value)}
          fullWidth
        />
        <TextField
          label="Auth headers"
          value={form.authHeaders}
          onChange={(e) => handleChange("authHeaders", e.target.value)}
          onBlur={() => handleBlur("authHeaders")}
          placeholder={
            authHeadersStatus
              ? "Set (values not shown). Type to replace; leave blank to keep the existing values."
              : "Optional. One header per line in `KEY: value` format."
          }
          error={touched.authHeaders && !!errors.authHeaders}
          helperText={touched.authHeaders && errors.authHeaders}
          fullWidth
          multiline
          rows={3}
        />
        {errors._form && (
          <Typography variant="caption" color="error">
            {errors._form}
          </Typography>
        )}
        <FormAlert serverError={serverError} />
        {refreshError && <FormAlert serverError={refreshError} />}
      </Stack>
    </Modal>
  );
};
