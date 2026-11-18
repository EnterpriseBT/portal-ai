import React, { useState } from "react";

import { z } from "zod";
import { keyField } from "@portalai/core/contracts";
import type { FieldMappingUpdateRequestBody } from "@portalai/core/contracts";
import {
  AsyncSearchableSelect,
  Button,
  GatedButton,
  Modal,
  pendingGate,
  Stack,
  Typography,
} from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import Alert from "@mui/material/Alert";
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
import { blurUnlessDialogControl } from "../utils/dialog-blur.util";

// ── Validation ──────────────────────────────────────────────────────

const KEY_PATTERN_MESSAGE =
  "Must be lowercase alphanumeric with underscores, starting with a letter";

/** #801: a changed key is held to the key limit. An unchanged one isn't (it
 *  isn't resent), so a mapping saved before the limit, whose key was derived
 *  from a long header, stays editable. */
const editFieldMappingFormSchema = (keyChanged: boolean) =>
  z.object({
    sourceField: z.string().trim().min(1, "Source field is required"),
    normalizedKey: (keyChanged ? keyField("Normalized key") : z.string()).regex(
      /^[a-z][a-z0-9_]*$/,
      KEY_PATTERN_MESSAGE
    ),
    isPrimaryKey: z.boolean(),
    refNormalizedKey: z.string().nullable(),
    refEntityKey: z.string().nullable(),
  });

interface EditFieldMappingFormState {
  sourceField: string;
  normalizedKey: string;
  isPrimaryKey: boolean;
  required: boolean;
  defaultValue: string;
  format: string;
  enumValues: string;
  refNormalizedKey: string | null;
  refEntityKey: string | null;
}

function validateForm(
  form: EditFieldMappingFormState,
  originalKey: string
): FormErrors {
  const schema = editFieldMappingFormSchema(form.normalizedKey !== originalKey);
  const result = validateWithSchema(schema, {
    sourceField: form.sourceField,
    normalizedKey: form.normalizedKey,
    isPrimaryKey: form.isPrimaryKey,
    refNormalizedKey: form.refNormalizedKey,
    refEntityKey: form.refEntityKey,
  });
  return result.success ? {} : result.errors;
}

const REVALIDATION_FIELDS = [
  "normalizedKey",
  "required",
  "defaultValue",
  "format",
  "enumValues",
] as const;

// ── Component ───────────────────────────────────────────────────────

export interface EditFieldMappingDialogProps {
  open: boolean;
  onClose: () => void;
  fieldMapping: {
    sourceField: string;
    normalizedKey?: string;
    isPrimaryKey: boolean;
    required?: boolean;
    defaultValue?: string | null;
    format?: string | null;
    enumValues?: string[] | null;
    columnDefinitionId: string;
    columnDefinitionLabel?: string;
    connectorEntityLabel?: string;
    refNormalizedKey: string | null;
    refEntityKey: string | null;
  };
  onSubmit: (body: FieldMappingUpdateRequestBody) => void;
  onSearchConnectorEntitiesForRefKey: (
    query: string
  ) => Promise<SelectOption[]>;
  isPending?: boolean;
  serverError?: ServerError | null;
  columnDefinitionType: string;
}

const EditForm: React.FC<{
  fieldMapping: EditFieldMappingDialogProps["fieldMapping"];
  onSubmit: (body: FieldMappingUpdateRequestBody) => void;
  onSearchConnectorEntitiesForRefKey: (
    query: string
  ) => Promise<SelectOption[]>;
  onClose: () => void;
  isPending?: boolean;
  serverError?: ServerError | null;
  columnDefinitionType: string;
}> = ({
  fieldMapping: fm,
  onSubmit,
  onSearchConnectorEntitiesForRefKey,
  onClose,
  isPending = false,
  serverError,
  columnDefinitionType,
}) => {
  const [form, setForm] = useState<EditFieldMappingFormState>({
    sourceField: fm.sourceField,
    normalizedKey: fm.normalizedKey ?? "",
    isPrimaryKey: fm.isPrimaryKey,
    required: fm.required ?? false,
    defaultValue: fm.defaultValue ?? "",
    format: fm.format ?? "",
    enumValues: fm.enumValues?.join(", ") ?? "",
    refNormalizedKey: fm.refNormalizedKey,
    refEntityKey: fm.refEntityKey,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showRevalidationWarning, setShowRevalidationWarning] = useState(false);
  const [pendingBody, setPendingBody] =
    useState<FieldMappingUpdateRequestBody | null>(null);
  const sourceRef = useDialogAutoFocus(true);

  const typeConfig = getTypeConfig(columnDefinitionType);

  const handleChange = <K extends keyof EditFieldMappingFormState>(
    field: K,
    value: EditFieldMappingFormState[K]
  ) => {
    const next = { ...form, [field]: value };
    setForm(next);
    if (touched[field]) {
      setErrors(validateForm(next, fm.normalizedKey ?? ""));
    }
  };

  const handleBlur = (field: keyof EditFieldMappingFormState) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors(validateForm(form, fm.normalizedKey ?? ""));
  };

  /** The enum list as the form parses it: trimmed, empty entries dropped. */
  const parseEnum = (text: string): string[] =>
    text
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

  // #1061: only what this editor changed from the mapping the dialog opened on
  // (`fm`, the row the page stored when Edit was clicked) is sent, as in Edit
  // Column Definition. Resending the whole form put back another editor's
  // change to a field this one never touched. `sourceField` and
  // `columnDefinitionId` are required by the contract and always sent.
  const buildBody = (): FieldMappingUpdateRequestBody => {
    const body: FieldMappingUpdateRequestBody = {
      sourceField: form.sourceField.trim(),
      columnDefinitionId: fm.columnDefinitionId,
    };
    const defaultValue = form.defaultValue.trim() || null;
    const format = form.format.trim() || null;

    // #801: an unchanged key isn't resent (see editFieldMappingFormSchema).
    if (form.normalizedKey !== (fm.normalizedKey ?? "")) {
      body.normalizedKey = form.normalizedKey;
    }
    if (form.required !== (fm.required ?? false)) {
      body.required = form.required;
    }
    if (defaultValue !== (fm.defaultValue?.trim() || null)) {
      body.defaultValue = defaultValue;
    }
    if (format !== (fm.format?.trim() || null)) {
      body.format = format;
    }
    if (columnDefinitionType === "enum") {
      const next = parseEnum(form.enumValues);
      const prev = fm.enumValues ?? [];
      if (JSON.stringify(next) !== JSON.stringify(prev)) {
        body.enumValues = next.length > 0 ? next : null;
      }
    }
    if (form.isPrimaryKey !== fm.isPrimaryKey) {
      body.isPrimaryKey = form.isPrimaryKey;
    }
    if (form.refNormalizedKey !== fm.refNormalizedKey) {
      body.refNormalizedKey = form.refNormalizedKey;
    }
    if (form.refEntityKey !== fm.refEntityKey) {
      body.refEntityKey = form.refEntityKey;
    }
    return body;
  };

  /** The body holds only changes, so any revalidating field in it changed. */
  const needsRevalidation = (body: FieldMappingUpdateRequestBody): boolean =>
    REVALIDATION_FIELDS.some((field) => body[field] !== undefined);

  const handleSubmit = () => {
    setTouched({ sourceField: true, normalizedKey: true });
    const formErrors = validateForm(form, fm.normalizedKey ?? "");
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }

    const body = buildBody();

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

  const showRefFields =
    columnDefinitionType === "reference" ||
    columnDefinitionType === "reference-array";

  return (
    <Modal
      pending={isPending}
      submitDisabled={isPending}
      open
      onClose={onClose}
      title="Edit Field Mapping"
      maxWidth="sm"
      fullWidth
      onSubmit={handleSubmit}
      actions={
        <Stack direction="row" spacing={1}>
          <GatedButton
            type="button"
            variant="outlined"
            onClick={onClose}
            gate={pendingGate(isPending, "Wait for this to finish")}
          >
            Cancel
          </GatedButton>
          <GatedButton
            type="button"
            variant="contained"
            onClick={handleSubmit}
            gate={pendingGate(isPending)}
          >
            {isPending ? "Saving..." : "Save"}
          </GatedButton>
        </Stack>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <TextField
          label="Column Definition"
          value={fm.columnDefinitionLabel ?? fm.columnDefinitionId}
          disabled
          fullWidth
        />
        <TextField
          label="Connector Entity"
          value={fm.connectorEntityLabel ?? ""}
          disabled
          fullWidth
        />
        <TextField
          inputRef={sourceRef}
          label="Source Field"
          value={form.sourceField}
          onChange={(e) => handleChange("sourceField", e.target.value)}
          onBlur={blurUnlessDialogControl(() => handleBlur("sourceField"))}
          error={touched.sourceField && !!errors.sourceField}
          helperText={touched.sourceField && errors.sourceField}
          slotProps={{
            htmlInput: {
              "aria-invalid": touched.sourceField && !!errors.sourceField,
            },
          }}
          required
          fullWidth
        />
        <TextField
          label="Normalized Key"
          value={form.normalizedKey}
          onChange={(e) => handleChange("normalizedKey", e.target.value)}
          onBlur={blurUnlessDialogControl(() => handleBlur("normalizedKey"))}
          error={touched.normalizedKey && !!errors.normalizedKey}
          helperText={
            (touched.normalizedKey && errors.normalizedKey) ||
            "Key used in normalized data"
          }
          slotProps={{
            htmlInput: {
              "aria-invalid": touched.normalizedKey && !!errors.normalizedKey,
            },
          }}
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
        {showRefFields && (
          <>
            <AsyncSearchableSelect
              label="Ref Entity Key"
              value={form.refEntityKey}
              onChange={(val: string | null) =>
                handleChange("refEntityKey", val)
              }
              onSearch={onSearchConnectorEntitiesForRefKey}
            />
            <TextField
              label="Ref Normalized Key"
              value={form.refNormalizedKey ?? ""}
              onChange={(e) =>
                handleChange("refNormalizedKey", e.target.value || null)
              }
              fullWidth
              helperText="Normalized key of the referenced field in the target entity"
            />
          </>
        )}

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
              Changing mapping constraints will trigger re-validation of
              affected records. This may take a moment.
            </Typography>
          </Alert>
        )}

        <FormAlert serverError={serverError ?? null} />
      </Stack>
    </Modal>
  );
};

export const EditFieldMappingDialog: React.FC<EditFieldMappingDialogProps> = ({
  open,
  onClose,
  fieldMapping,
  onSubmit,
  onSearchConnectorEntitiesForRefKey,
  isPending = false,
  serverError,
  columnDefinitionType,
}) => {
  if (!open) return null;

  return (
    <EditForm
      key={fieldMapping.sourceField}
      fieldMapping={fieldMapping}
      onSubmit={onSubmit}
      onSearchConnectorEntitiesForRefKey={onSearchConnectorEntitiesForRefKey}
      onClose={onClose}
      isPending={isPending}
      serverError={serverError}
      columnDefinitionType={columnDefinitionType}
    />
  );
};
