import React, { useState } from "react";

import { z } from "zod";
import type { ColumnDefinitionCreateRequestBody } from "@portalai/core/contracts";
import { ColumnDataTypeEnum } from "@portalai/core/models";
import { Button, Modal, Stack, Select } from "@portalai/core/ui";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";
import {
  validateWithSchema,
  focusFirstInvalidField,
  type FormErrors,
} from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";
import {
  VALIDATION_PRESETS,
  VALIDATION_PRESET_VALUES,
  getTypeConfig,
  validateRegex,
} from "../utils/column-definition-form.util";

// ── Types ────────────────────────────────────────────────────────────

interface ColumnDefinitionFormState {
  key: string;
  label: string;
  type: string;
  description: string;
  preset: string;
  validationPattern: string;
  validationMessage: string;
  canonicalFormat: string;
}

const CreateColumnDefinitionFormSchema = z.object({
  key: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "Key must be lowercase alphanumeric with underscores, starting with a letter"
    ),
  label: z.string().trim().min(1, "Label is required"),
  type: ColumnDataTypeEnum,
});

const INITIAL_FORM: ColumnDefinitionFormState = {
  key: "",
  label: "",
  type: "string",
  description: "",
  preset: "",
  validationPattern: "",
  validationMessage: "",
  canonicalFormat: "",
};

function validateForm(form: ColumnDefinitionFormState): FormErrors {
  const result = validateWithSchema(CreateColumnDefinitionFormSchema, {
    key: form.key,
    label: form.label,
    type: form.type,
  });
  const errors = result.success ? {} : { ...result.errors };

  const regexError = validateRegex(form.validationPattern);
  if (regexError) errors.validationPattern = regexError;

  return errors;
}

// ── Component ────────────────────────────────────────────────────────

export interface CreateColumnDefinitionDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: ColumnDefinitionCreateRequestBody) => void;
  isPending: boolean;
  serverError: ServerError | null;
}

export const CreateColumnDefinitionDialog: React.FC<
  CreateColumnDefinitionDialogProps
> = ({ open, onClose, onSubmit, isPending, serverError }) => {
  const [form, setForm] = useState<ColumnDefinitionFormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const keyRef = useDialogAutoFocus(open);

  React.useEffect(() => {
    if (open) {
      setForm(INITIAL_FORM);
      setErrors({});
      setTouched({});
    }
  }, [open]);

  const typeConfig = getTypeConfig(form.type);

  const handleChange = (
    field: keyof ColumnDefinitionFormState,
    value: string | boolean
  ) => {
    let next = { ...form, [field]: value };

    if (field === "type" && typeof value === "string") {
      const newConfig = getTypeConfig(value);
      const prevConfig = getTypeConfig(form.type);
      if (!newConfig.validation.enabled) {
        next = {
          ...next,
          validationPattern: "",
          validationMessage: "",
          preset: "",
        };
      }
      if (
        !newConfig.canonicalFormat.enabled ||
        newConfig.canonicalFormat.options !== prevConfig.canonicalFormat.options
      ) {
        next = { ...next, canonicalFormat: "" };
      }
    }

    if (field === "preset" && typeof value === "string") {
      const presetValues = VALIDATION_PRESET_VALUES[value];
      if (presetValues) {
        next = {
          ...next,
          validationPattern: presetValues.pattern,
          validationMessage: presetValues.message,
        };
      }
    }

    setForm(next);
    if (touched[field]) {
      setErrors(validateForm(next));
    }
  };

  const handleBlur = (field: keyof ColumnDefinitionFormState) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors(validateForm(form));
  };

  const handleSubmit = () => {
    setTouched({ key: true, label: true, type: true, validationPattern: true });
    const formErrors = validateForm(form);
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }

    const trimDesc = form.description.trim();
    const trimValidationPattern = form.validationPattern.trim();
    const trimValidationMessage = form.validationMessage.trim();
    const trimCanonicalFormat = form.canonicalFormat.trim();

    const body: ColumnDefinitionCreateRequestBody = {
      key: form.key,
      label: form.label.trim(),
      type: form.type as ColumnDefinitionCreateRequestBody["type"],
      description: trimDesc || null,
      validationPattern: trimValidationPattern || null,
      validationMessage: trimValidationMessage || null,
      canonicalFormat: trimCanonicalFormat || null,
    };
    onSubmit(body);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Column Definition"
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
            {isPending ? "Creating..." : "Create"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <TextField
          inputRef={keyRef}
          label="Key"
          value={form.key}
          onChange={(e) => handleChange("key", e.target.value)}
          onBlur={() => handleBlur("key")}
          error={touched.key && !!errors.key}
          helperText={(touched.key && errors.key) || "e.g. customer_name"}
          slotProps={{
            htmlInput: { "aria-invalid": touched.key && !!errors.key },
          }}
          required
          fullWidth
        />
        <TextField
          label="Label"
          value={form.label}
          onChange={(e) => handleChange("label", e.target.value)}
          onBlur={() => handleBlur("label")}
          error={touched.label && !!errors.label}
          helperText={touched.label && errors.label}
          slotProps={{
            htmlInput: { "aria-invalid": touched.label && !!errors.label },
          }}
          required
          fullWidth
        />
        <TextField
          select
          label="Type"
          value={form.type}
          onChange={(e) => handleChange("type", e.target.value)}
          fullWidth
        >
          {ColumnDataTypeEnum.options.map((t) => (
            <MenuItem key={t} value={t}>
              {t}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Description"
          value={form.description}
          onChange={(e) => handleChange("description", e.target.value)}
          fullWidth
          multiline
          rows={2}
        />
        <Select
          label="Validation Preset"
          value={form.preset}
          onChange={(e) => handleChange("preset", e.target.value)}
          options={VALIDATION_PRESETS}
          fullWidth
          disabled={!typeConfig.validation.enabled}
          helperText={
            !typeConfig.validation.enabled
              ? "Not applicable for this column type"
              : "Auto-populate validation pattern and message"
          }
        />
        <TextField
          label="Validation Pattern"
          value={form.validationPattern}
          onChange={(e) => handleChange("validationPattern", e.target.value)}
          onBlur={() => handleBlur("validationPattern")}
          fullWidth
          disabled={!typeConfig.validation.enabled}
          error={touched.validationPattern && !!errors.validationPattern}
          helperText={
            !typeConfig.validation.enabled
              ? "Not applicable for this column type"
              : (touched.validationPattern && errors.validationPattern) ||
                "Regex that values must match after coercion"
          }
          slotProps={{
            htmlInput: {
              "aria-invalid":
                touched.validationPattern && !!errors.validationPattern,
            },
          }}
        />
        <TextField
          label="Validation Message"
          value={form.validationMessage}
          onChange={(e) => handleChange("validationMessage", e.target.value)}
          fullWidth
          disabled={!typeConfig.validation.enabled}
          helperText={
            !typeConfig.validation.enabled
              ? "Not applicable for this column type"
              : "Shown when the pattern doesn't match"
          }
        />
        <Select
          label="Canonical Format"
          value={form.canonicalFormat}
          onChange={(e) => handleChange("canonicalFormat", e.target.value)}
          options={typeConfig.canonicalFormat.options}
          fullWidth
          disabled={!typeConfig.canonicalFormat.enabled}
          helperText={
            !typeConfig.canonicalFormat.enabled
              ? "Not applicable for this column type"
              : "Normalizes the stored value before saving"
          }
        />
        <FormAlert serverError={serverError} />
      </Stack>
    </Modal>
  );
};
