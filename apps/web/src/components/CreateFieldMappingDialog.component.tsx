import React, { useState } from "react";

import { z } from "zod";
import type { FieldMappingCreateRequestBody } from "@portalai/core/contracts";
import { AsyncSearchableSelect, Button, Modal, Stack } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import FormControlLabel from "@mui/material/FormControlLabel";
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
import { getTypeConfig } from "../utils/column-definition-form.util";

// ── Validation ──────────────────────────────────────────────────────

const CreateFieldMappingFormSchema = z.object({
  connectorEntityId: z.string().min(1, "Connector entity is required"),
  sourceField: z.string().trim().min(1, "Source field is required"),
  normalizedKey: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "Must be lowercase alphanumeric with underscores, starting with a letter"
    ),
  isPrimaryKey: z.boolean(),
  refColumnDefinitionId: z.string().nullable(),
  refEntityKey: z.string().nullable(),
  refBidirectionalFieldMappingId: z.string().nullable(),
});

interface CreateFieldMappingFormState {
  connectorEntityId: string;
  sourceField: string;
  normalizedKey: string;
  normalizedKeyManuallyEdited: boolean;
  isPrimaryKey: boolean;
  required: boolean;
  defaultValue: string;
  format: string;
  enumValues: string;
  refColumnDefinitionId: string | null;
  refEntityKey: string | null;
  refBidirectionalFieldMappingId: string | null;
}

const INITIAL_FORM: CreateFieldMappingFormState = {
  connectorEntityId: "",
  sourceField: "",
  normalizedKey: "",
  normalizedKeyManuallyEdited: false,
  isPrimaryKey: false,
  required: false,
  defaultValue: "",
  format: "",
  enumValues: "",
  refColumnDefinitionId: null,
  refEntityKey: null,
  refBidirectionalFieldMappingId: null,
};

function toSnakeCase(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function validateForm(form: CreateFieldMappingFormState): FormErrors {
  const result = validateWithSchema(CreateFieldMappingFormSchema, {
    connectorEntityId: form.connectorEntityId,
    sourceField: form.sourceField,
    normalizedKey: form.normalizedKey,
    isPrimaryKey: form.isPrimaryKey,
    refColumnDefinitionId: form.refColumnDefinitionId,
    refEntityKey: form.refEntityKey,
    refBidirectionalFieldMappingId: form.refBidirectionalFieldMappingId,
  });
  return result.success ? {} : result.errors;
}

// ── Component ───────────────────────────────────────────────────────

export interface CreateFieldMappingDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: FieldMappingCreateRequestBody) => void;
  onSearchConnectorEntities: (query: string) => Promise<SelectOption[]>;
  onSearchColumnDefinitions: (query: string) => Promise<SelectOption[]>;
  onSearchConnectorEntitiesForRefKey: (query: string) => Promise<SelectOption[]>;
  onSearchFieldMappings: (query: string) => Promise<SelectOption[]>;
  isPending: boolean;
  serverError: ServerError | null;
  columnDefinitionId: string;
  columnDefinitionLabel: string;
  columnDefinitionType: string;
}

export const CreateFieldMappingDialog: React.FC<CreateFieldMappingDialogProps> = ({
  open,
  onClose,
  onSubmit,
  onSearchConnectorEntities,
  onSearchColumnDefinitions,
  onSearchConnectorEntitiesForRefKey,
  onSearchFieldMappings,
  isPending,
  serverError,
  columnDefinitionId,
  columnDefinitionLabel,
  columnDefinitionType,
}) => {
  const [form, setForm] = useState<CreateFieldMappingFormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const connectorEntityRef = useDialogAutoFocus(open);

  const typeConfig = getTypeConfig(columnDefinitionType);

  React.useEffect(() => {
    if (open) {
      setForm(INITIAL_FORM);
      setErrors({});
      setTouched({});
    }
  }, [open]);

  const handleChange = <K extends keyof CreateFieldMappingFormState>(
    field: K,
    value: CreateFieldMappingFormState[K],
  ) => {
    let next = { ...form, [field]: value };
    // Auto-suggest normalizedKey from sourceField when not manually edited
    if (field === "sourceField" && typeof value === "string" && !next.normalizedKeyManuallyEdited) {
      const suggested = toSnakeCase(value);
      next = { ...next, normalizedKey: suggested };
    }
    if (field === "normalizedKey") {
      next = { ...next, normalizedKeyManuallyEdited: true };
    }
    setForm(next);
    if (touched[field]) {
      setErrors(validateForm(next));
    }
  };

  const handleBlur = (field: keyof CreateFieldMappingFormState) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors(validateForm(form));
  };

  const handleSubmit = () => {
    setTouched({ connectorEntityId: true, sourceField: true, normalizedKey: true });
    const formErrors = validateForm(form);
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }

    const trimDefault = form.defaultValue.trim();
    const trimFormat = form.format.trim();
    const trimEnum = form.enumValues.trim();

    onSubmit({
      connectorEntityId: form.connectorEntityId,
      columnDefinitionId,
      sourceField: form.sourceField.trim(),
      normalizedKey: form.normalizedKey,
      required: form.required,
      defaultValue: trimDefault || null,
      format: trimFormat || null,
      enumValues:
        columnDefinitionType === "enum" && trimEnum
          ? trimEnum.split(",").map((s) => s.trim()).filter(Boolean)
          : null,
      isPrimaryKey: form.isPrimaryKey,
      refColumnDefinitionId: form.refColumnDefinitionId,
      refEntityKey: form.refEntityKey,
      refBidirectionalFieldMappingId: form.refBidirectionalFieldMappingId,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Field Mapping"
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
          <Button type="button" variant="outlined" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" variant="contained" onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Creating..." : "Create"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <TextField
          label="Column Definition"
          value={columnDefinitionLabel}
          disabled
          fullWidth
        />
        <AsyncSearchableSelect
          inputRef={connectorEntityRef}
          label="Connector Entity"
          value={form.connectorEntityId || null}
          onChange={(val) => handleChange("connectorEntityId", val ?? "")}
          onSearch={onSearchConnectorEntities}
          error={touched.connectorEntityId && !!errors.connectorEntityId}
          helperText={touched.connectorEntityId ? errors.connectorEntityId : undefined}
          required
        />
        <TextField
          label="Source Field"
          value={form.sourceField}
          onChange={(e) => handleChange("sourceField", e.target.value)}
          onBlur={() => handleBlur("sourceField")}
          error={touched.sourceField && !!errors.sourceField}
          helperText={touched.sourceField && errors.sourceField}
          slotProps={{ htmlInput: { "aria-invalid": touched.sourceField && !!errors.sourceField } }}
          required
          fullWidth
        />
        <TextField
          label="Normalized Key"
          value={form.normalizedKey}
          onChange={(e) => handleChange("normalizedKey", e.target.value)}
          onBlur={() => handleBlur("normalizedKey")}
          error={touched.normalizedKey && !!errors.normalizedKey}
          helperText={(touched.normalizedKey && errors.normalizedKey) || "Auto-suggested from source field"}
          slotProps={{ htmlInput: { "aria-invalid": touched.normalizedKey && !!errors.normalizedKey } }}
          required
          fullWidth
        />
        <FormControlLabel
          control={
            <Switch
              checked={form.isPrimaryKey}
              onChange={(e) => handleChange("isPrimaryKey", e.target.checked)}
            />
          }
          label="Primary Key"
        />
        <FormControlLabel
          control={
            <Switch
              checked={form.required}
              onChange={(e) => handleChange("required", e.target.checked)}
            />
          }
          label="Required"
        />
        <TextField
          label="Default Value"
          value={form.defaultValue}
          onChange={(e) => handleChange("defaultValue", e.target.value)}
          fullWidth
        />
        <TextField
          label="Format"
          value={form.format}
          onChange={(e) => handleChange("format", e.target.value)}
          fullWidth
          disabled={!typeConfig.format.enabled}
          helperText={typeConfig.format.helperText}
        />
        {columnDefinitionType === "enum" && (
          <TextField
            label="Enum Values"
            value={form.enumValues}
            onChange={(e) => handleChange("enumValues", e.target.value)}
            fullWidth
            helperText="Comma-separated list of allowed values"
          />
        )}
        {(columnDefinitionType === "reference" || columnDefinitionType === "reference-array") && (
          <>
            <AsyncSearchableSelect
              label="Ref Column Definition"
              value={form.refColumnDefinitionId}
              onChange={(val) => handleChange("refColumnDefinitionId", val)}
              onSearch={onSearchColumnDefinitions}
            />
            <AsyncSearchableSelect
              label="Ref Entity Key"
              value={form.refEntityKey}
              onChange={(val) => handleChange("refEntityKey", val)}
              onSearch={onSearchConnectorEntitiesForRefKey}
            />
            <AsyncSearchableSelect
              label="Ref Bidirectional Field Mapping"
              value={form.refBidirectionalFieldMappingId}
              onChange={(val) => handleChange("refBidirectionalFieldMappingId", val)}
              onSearch={onSearchFieldMappings}
            />
          </>
        )}
        <FormAlert serverError={serverError} />
      </Stack>
    </Modal>
  );
};
