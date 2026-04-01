import React, { useState } from "react";

import {
  ColumnDefinitionUpdateRequestBodySchema,
  type ColumnDefinitionUpdateRequestBody,
} from "@portalai/core/contracts";
import type { ColumnDefinition, ColumnDataType } from "@portalai/core/models";
import {
  Button,
  Modal,
  Stack,
  Typography,
} from "@portalai/core/ui";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";
import {
  validateWithSchema,
  focusFirstInvalidField,
  type FormErrors,
} from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";

/**
 * Allowlist of permitted column definition type transitions.
 * Mirrors `apps/api/src/constants/column-definition-transitions.constants.ts`.
 */
const ALLOWED_TYPE_TRANSITIONS: Record<string, string[]> = {
  string: ["enum"],
  enum: ["string"],
  date: ["datetime"],
  datetime: ["date"],
  number: ["currency"],
  currency: ["number"],
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
  "currency",
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
}> = ({ columnDefinition: cd, onSubmit, onClose, isPending, serverError, warnings }) => {
  const [label, setLabel] = useState(cd.label);
  const [type, setType] = useState<ColumnDataType>(cd.type);
  const [description, setDescription] = useState(cd.description ?? "");
  const [required, setRequired] = useState(cd.required);
  const [defaultValue, setDefaultValue] = useState(cd.defaultValue ?? "");
  const [format, setFormat] = useState(cd.format ?? "");
  const [enumValues, setEnumValues] = useState(cd.enumValues?.join(", ") ?? "");
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const labelRef = useDialogAutoFocus(true);

  const allowedTargetTypes = BLOCKED_TYPES.has(cd.type)
    ? []
    : ALLOWED_TYPE_TRANSITIONS[cd.type] ?? [];

  const validate = (data: Record<string, unknown>): FormErrors => {
    const result = validateWithSchema(ColumnDefinitionUpdateRequestBodySchema, data);
    return result.success ? {} : result.errors;
  };

  const buildBody = (): ColumnDefinitionUpdateRequestBody => {
    const body: ColumnDefinitionUpdateRequestBody = {};
    const trimLabel = label.trim();
    const trimDesc = description.trim();
    const trimDefault = defaultValue.trim();
    const trimFormat = format.trim();
    const parsedEnum = enumValues
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    if (trimLabel !== cd.label) body.label = trimLabel;
    if (type !== cd.type) body.type = type;
    if (trimDesc !== (cd.description ?? "")) body.description = trimDesc || null;
    if (required !== cd.required) body.required = required;
    if (trimDefault !== (cd.defaultValue ?? "")) body.defaultValue = trimDefault || null;
    if (trimFormat !== (cd.format ?? "")) body.format = trimFormat || null;

    const origEnum = cd.enumValues?.join(", ") ?? "";
    const newEnum = parsedEnum.join(", ");
    if (newEnum !== origEnum) {
      body.enumValues = parsedEnum.length > 0 ? parsedEnum : null;
    }

    return body;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ label: true });
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
    onSubmit(body);
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
          <Button type="button" variant="outlined" onClick={onClose} disabled={isPending}>
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
            if (touched.label) setErrors(validate({ label: e.target.value.trim() }));
          }}
          onBlur={() => {
            setTouched((p) => ({ ...p, label: true }));
            setErrors(validate({ label: label.trim() }));
          }}
          error={touched.label && !!errors.label}
          helperText={touched.label && errors.label}
          slotProps={{ htmlInput: { "aria-invalid": touched.label && !!errors.label } }}
          required
          fullWidth
          size="small"
        />

        {/* Type */}
        <TextField
          select
          label="Type"
          value={type}
          onChange={(e) => setType(e.target.value as ColumnDataType)}
          fullWidth
          size="small"
          disabled={BLOCKED_TYPES.has(cd.type) && allowedTargetTypes.length === 0}
        >
          {ALL_TYPES.map((t) => {
            const isCurrent = t === cd.type;
            const isAllowed = isCurrent || allowedTargetTypes.includes(t);
            return (
              <MenuItem key={t} value={t} disabled={!isAllowed}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <span>{t}</span>
                  {isCurrent && <Chip label="current" size="small" variant="outlined" />}
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

        {/* Required */}
        <FormControlLabel
          control={
            <Switch checked={required} onChange={(e) => setRequired(e.target.checked)} />
          }
          label="Required"
        />

        {/* Default Value */}
        <TextField
          label="Default Value"
          value={defaultValue}
          onChange={(e) => setDefaultValue(e.target.value)}
          fullWidth
          size="small"
        />

        {/* Format */}
        <TextField
          label="Format"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          fullWidth
          size="small"
        />

        {/* Enum Values */}
        <TextField
          label="Enum Values"
          value={enumValues}
          onChange={(e) => setEnumValues(e.target.value)}
          fullWidth
          size="small"
          helperText="Comma-separated values"
        />

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
> = ({ open, onClose, columnDefinition, onSubmit, isPending, serverError, warnings }) => {
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
