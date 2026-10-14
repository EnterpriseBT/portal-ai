import React, { useState } from "react";

import { z } from "zod";
import { keyField } from "@portalai/core/contracts";
import type { FieldMappingUpdateRequestBody } from "@portalai/core/contracts";
import {
  AsyncSearchableSelect,
  Button,
  Modal,
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

  const buildBody = (): FieldMappingUpdateRequestBody => {
    const trimDefault = form.defaultValue.trim();
    const trimFormat = form.format.trim();
    const trimEnum = form.enumValues.trim();

    return {
      sourceField: form.sourceField.trim(),
      columnDefinitionId: fm.columnDefinitionId,
      // #801: only a changed key is sent (see editFieldMappingFormSchema).
      ...(form.normalizedKey !== (fm.normalizedKey ?? "")
        ? { normalizedKey: form.normalizedKey }
        : {}),
      required: form.required,
      defaultValue: trimDefault || null,
      format: trimFormat || null,
      enumValues:
        columnDefinitionType === "enum" && trimEnum
          ? trimEnum
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : null,
      isPrimaryKey: form.isPrimaryKey,
      refNormalizedKey: form.refNormalizedKey,
      refEntityKey: form.refEntityKey,
    };
  };

  const needsRevalidation = (body: FieldMappingUpdateRequestBody): boolean => {
    const origEnumStr = fm.enumValues?.join(", ") ?? "";
    const newEnumStr = form.enumValues.trim();
    return REVALIDATION_FIELDS.some((field) => {
      if (field === "normalizedKey")
        return (
          body.normalizedKey !== undefined &&
          body.normalizedKey !== (fm.normalizedKey ?? "")
        );
      if (field === "required") return body.required !== (fm.required ?? false);
      if (field === "defaultValue")
        return body.defaultValue !== (fm.defaultValue ?? null);
      if (field === "format") return body.format !== (fm.format ?? null);
      if (field === "enumValues") return newEnumStr !== origEnumStr;
      return false;
    });
  };

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
