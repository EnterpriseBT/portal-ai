import React, { useState } from "react";

import {
  ColumnDefinitionUpdateRequestBodySchema,
  type ColumnDefinitionUpdateRequestBody,
} from "@portalai/core/contracts";
import type { ColumnDefinition, ColumnDataType } from "@portalai/core/models";
import { Button, Modal, Stack, Typography, Select } from "@portalai/core/ui";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
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
  findPresetByPattern,
  validateRegex,
} from "../utils/column-definition-form.util";

/**
 * Allowlist of permitted column definition type transitions.
 * Mirrors `apps/api/src/constants/column-definition-transitions.constants.ts`.
 */
const ALLOWED_TYPE_TRANSITIONS: Record<string, string[]> = {
  string: ["enum"],
  enum: ["string"],
  date: ["datetime"],
  datetime: ["date"],
};

const BLOCKED_TYPES = new Set(["reference", "reference-array"]);

const ALL_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
  "datetime",
  "enum",
  "json",
  "array",
  "reference",
  "reference-array",
] as const;

export interface EditColumnDefinitionDialogProps {
  open: boolean;
  onClose: () => void;
  columnDefinition: ColumnDefinition;
  onSubmit: (body: ColumnDefinitionUpdateRequestBody) => void;
  isPending?: boolean;
  serverError?: ServerError | null;
  /** Warnings returned by the API after a successful update (e.g. removed enum values). */
  warnings?: string[];
}

const EditForm: React.FC<{
  columnDefinition: ColumnDefinition;
  onSubmit: (body: ColumnDefinitionUpdateRequestBody) => void;
  onClose: () => void;
  isPending?: boolean;
  serverError?: ServerError | null;
  warnings?: string[];
}> = ({
  columnDefinition: cd,
  onSubmit,
  onClose,
  isPending,
  serverError,
  warnings,
}) => {
  const [label, setLabel] = useState(cd.label);
  const [type, setType] = useState<ColumnDataType>(cd.type);
  const [description, setDescription] = useState(cd.description ?? "");
  const [preset, setPreset] = useState(() =>
    findPresetByPattern(cd.validationPattern)
  );
  const [validationPattern, setValidationPattern] = useState(
    cd.validationPattern ?? ""
  );
  const [validationMessage, setValidationMessage] = useState(
    cd.validationMessage ?? ""
  );
  const [canonicalFormat, setCanonicalFormat] = useState(
    cd.canonicalFormat ?? ""
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showRevalidationWarning, setShowRevalidationWarning] = useState(false);
  const [pendingBody, setPendingBody] =
    useState<ColumnDefinitionUpdateRequestBody | null>(null);
  const labelRef = useDialogAutoFocus(true);

  const allowedTargetTypes = BLOCKED_TYPES.has(cd.type)
    ? []
    : (ALLOWED_TYPE_TRANSITIONS[cd.type] ?? []);

  const typeConfig = getTypeConfig(type);

  const validate = (data: Record<string, unknown>, vp?: string): FormErrors => {
    const result = validateWithSchema(
      ColumnDefinitionUpdateRequestBodySchema,
      data
    );
    const errs = result.success ? {} : { ...result.errors };
    const regexError = validateRegex(vp ?? validationPattern);
    if (regexError) errs.validationPattern = regexError;
    return errs;
  };

  const handleTypeChange = (newType: ColumnDataType) => {
    const newConfig = getTypeConfig(newType);
    const prevConfig = getTypeConfig(type);
    setType(newType);
    if (!newConfig.validation.enabled) {
      setValidationPattern("");
      setValidationMessage("");
      setPreset("");
    }
    if (
      !newConfig.canonicalFormat.enabled ||
      newConfig.canonicalFormat.options !== prevConfig.canonicalFormat.options
    ) {
      setCanonicalFormat("");
    }
  };

  const handlePresetChange = (value: string) => {
    setPreset(value);
    const presetValues = VALIDATION_PRESET_VALUES[value];
    if (presetValues) {
      setValidationPattern(presetValues.pattern);
      setValidationMessage(presetValues.message);
    }
  };

  const buildBody = (): ColumnDefinitionUpdateRequestBody => {
    const body: ColumnDefinitionUpdateRequestBody = {};
    const trimLabel = label.trim();
    const trimDesc = description.trim();
    const trimValidationPattern = validationPattern.trim();
    const trimValidationMessage = validationMessage.trim();
    const trimCanonicalFormat = canonicalFormat.trim();

    if (trimLabel !== cd.label) body.label = trimLabel;
    if (type !== cd.type) body.type = type;
    if (trimDesc !== (cd.description ?? ""))
      body.description = trimDesc || null;
    if (trimValidationPattern !== (cd.validationPattern ?? ""))
      body.validationPattern = trimValidationPattern || null;
    if (trimValidationMessage !== (cd.validationMessage ?? ""))
      body.validationMessage = trimValidationMessage || null;
    if (trimCanonicalFormat !== (cd.canonicalFormat ?? ""))
      body.canonicalFormat = trimCanonicalFormat || null;

    return body;
  };

  const needsRevalidation = (
    body: ColumnDefinitionUpdateRequestBody
  ): boolean =>
    body.validationPattern !== undefined || body.canonicalFormat !== undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ label: true, validationPattern: true });
    const formErrors = validate({ label: label.trim() });
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }

    const body = buildBody();
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }

    if (needsRevalidation(body)) {
      setPendingBody(body);
      setShowRevalidationWarning(true);
      return;
    }

    onSubmit(body);
  };

  const handleConfirmRevalidation = () => {
    if (pendingBody) {
      onSubmit(pendingBody);
      setShowRevalidationWarning(false);
      setPendingBody(null);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit Column Definition"
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          component: "form",
          onSubmit: handleSubmit,
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
            onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}
            disabled={isPending}
          >
            {isPending ? "Saving..." : "Save"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {/* Key (read-only) */}
        <TextField
          label="Key"
          value={cd.key}
          disabled
          fullWidth
          size="small"
          slotProps={{ htmlInput: { "aria-readonly": true } }}
        />

        {/* Label */}
        <TextField
          inputRef={labelRef}
          label="Label"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            if (touched.label)
              setErrors(validate({ label: e.target.value.trim() }));
          }}
          onBlur={() => {
            setTouched((p) => ({ ...p, label: true }));
            setErrors(validate({ label: label.trim() }));
          }}
          error={touched.label && !!errors.label}
          helperText={touched.label && errors.label}
          slotProps={{
            htmlInput: { "aria-invalid": touched.label && !!errors.label },
          }}
          required
          fullWidth
          size="small"
        />

        {/* Type */}
        <TextField
          select
          label="Type"
          value={type}
          onChange={(e) => handleTypeChange(e.target.value as ColumnDataType)}
          fullWidth
          size="small"
          disabled={
            BLOCKED_TYPES.has(cd.type) && allowedTargetTypes.length === 0
          }
        >
          {ALL_TYPES.map((t) => {
            const isCurrent = t === cd.type;
            const isAllowed = isCurrent || allowedTargetTypes.includes(t);
            return (
              <MenuItem key={t} value={t} disabled={!isAllowed}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <span>{t}</span>
                  {isCurrent && (
                    <Chip label="current" size="small" variant="outlined" />
                  )}
                </Stack>
              </MenuItem>
            );
          })}
        </TextField>

        {/* Description */}
        <TextField
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
          size="small"
          multiline
          rows={2}
        />

        {/* Validation Preset */}
        <Select
          label="Validation Preset"
          value={preset}
          onChange={(e) => handlePresetChange(e.target.value)}
          options={VALIDATION_PRESETS}
          fullWidth
          size="small"
          disabled={!typeConfig.validation.enabled}
          helperText={
            !typeConfig.validation.enabled
              ? "Not applicable for this column type"
              : "Auto-populate validation pattern and message"
          }
        />

        {/* Validation Pattern */}
        <TextField
          label="Validation Pattern"
          value={validationPattern}
          onChange={(e) => {
            setValidationPattern(e.target.value);
            if (touched.validationPattern)
              setErrors(validate({ label: label.trim() }, e.target.value));
          }}
          onBlur={() => {
            setTouched((p) => ({ ...p, validationPattern: true }));
            setErrors(validate({ label: label.trim() }));
          }}
          fullWidth
          size="small"
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

        {/* Validation Message */}
        <TextField
          label="Validation Message"
          value={validationMessage}
          onChange={(e) => setValidationMessage(e.target.value)}
          fullWidth
          size="small"
          disabled={!typeConfig.validation.enabled}
          helperText={
            !typeConfig.validation.enabled
              ? "Not applicable for this column type"
              : "Shown when the pattern doesn't match"
          }
        />

        {/* Canonical Format */}
        <Select
          label="Canonical Format"
          value={canonicalFormat}
          onChange={(e) => setCanonicalFormat(e.target.value)}
          options={typeConfig.canonicalFormat.options}
          fullWidth
          size="small"
          disabled={!typeConfig.canonicalFormat.enabled}
          helperText={
            !typeConfig.canonicalFormat.enabled
              ? "Not applicable for this column type"
              : "Normalizes the stored value before saving"
          }
        />

        {/* Revalidation confirmation */}
        {showRevalidationWarning && (
          <Alert
            severity="info"
            action={
              <Button
                type="button"
                size="small"
                variant="contained"
                onClick={handleConfirmRevalidation}
              >
                Confirm &amp; Save
              </Button>
            }
          >
            <Typography variant="body2">
              Changing validation pattern or canonical format will trigger
              re-validation of affected records. This may take a moment.
            </Typography>
          </Alert>
        )}

        {/* Warnings */}
        {warnings && warnings.length > 0 && (
          <Alert severity="warning">
            <Typography variant="body2" sx={{ fontWeight: "bold", mb: 0.5 }}>
              Warnings:
            </Typography>
            {warnings.map((w, i) => (
              <Typography key={i} variant="body2">
                {w}
              </Typography>
            ))}
          </Alert>
        )}

        <FormAlert serverError={serverError ?? null} />
      </Stack>
    </Modal>
  );
};

export const EditColumnDefinitionDialog: React.FC<
  EditColumnDefinitionDialogProps
> = ({
  open,
  onClose,
  columnDefinition,
  onSubmit,
  isPending,
  serverError,
  warnings,
}) => {
  if (!open) return null;

  return (
    <EditForm
      key={columnDefinition.id}
      columnDefinition={columnDefinition}
      onSubmit={onSubmit}
      onClose={onClose}
      isPending={isPending}
      serverError={serverError}
      warnings={warnings}
    />
  );
};
