import React, { useState } from "react";

import { z } from "zod";
import type { FieldMappingUpdateRequestBody } from "@portalai/core/contracts";
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

// ── Validation ──────────────────────────────────────────────────────

const EditFieldMappingFormSchema = z.object({
  sourceField: z.string().trim().min(1, "Source field is required"),
  isPrimaryKey: z.boolean(),
  refColumnDefinitionId: z.string().nullable(),
  refEntityKey: z.string().nullable(),
  refBidirectionalFieldMappingId: z.string().nullable(),
});

interface EditFieldMappingFormState {
  sourceField: string;
  isPrimaryKey: boolean;
  refColumnDefinitionId: string | null;
  refEntityKey: string | null;
  refBidirectionalFieldMappingId: string | null;
}

function validateForm(form: EditFieldMappingFormState): FormErrors {
  const result = validateWithSchema(EditFieldMappingFormSchema, form);
  return result.success ? {} : result.errors;
}

// ── Component ───────────────────────────────────────────────────────

export interface EditFieldMappingDialogProps {
  open: boolean;
  onClose: () => void;
  fieldMapping: {
    sourceField: string;
    isPrimaryKey: boolean;
    columnDefinitionId: string;
    columnDefinitionLabel?: string;
    connectorEntityLabel?: string;
    refColumnDefinitionId: string | null;
    refEntityKey: string | null;
    refBidirectionalFieldMappingId: string | null;
  };
  onSubmit: (body: FieldMappingUpdateRequestBody) => void;
  onSearchColumnDefinitions: (query: string) => Promise<SelectOption[]>;
  onSearchConnectorEntitiesForRefKey: (query: string) => Promise<SelectOption[]>;
  onSearchFieldMappings: (query: string) => Promise<SelectOption[]>;
  isPending?: boolean;
  serverError?: ServerError | null;
  columnDefinitionType: string;
}

const EditForm: React.FC<{
  fieldMapping: EditFieldMappingDialogProps["fieldMapping"];
  onSubmit: (body: FieldMappingUpdateRequestBody) => void;
  onSearchColumnDefinitions: (query: string) => Promise<SelectOption[]>;
  onSearchConnectorEntitiesForRefKey: (query: string) => Promise<SelectOption[]>;
  onSearchFieldMappings: (query: string) => Promise<SelectOption[]>;
  onClose: () => void;
  isPending?: boolean;
  serverError?: ServerError | null;
  columnDefinitionType: string;
}> = ({
  fieldMapping: fm,
  onSubmit,
  onSearchColumnDefinitions,
  onSearchConnectorEntitiesForRefKey,
  onSearchFieldMappings,
  onClose,
  isPending,
  serverError,
  columnDefinitionType,
}) => {
    const [form, setForm] = useState<EditFieldMappingFormState>({
      sourceField: fm.sourceField,
      isPrimaryKey: fm.isPrimaryKey,
      refColumnDefinitionId: fm.refColumnDefinitionId,
      refEntityKey: fm.refEntityKey,
      refBidirectionalFieldMappingId: fm.refBidirectionalFieldMappingId,
    });
    const [errors, setErrors] = useState<FormErrors>({});
    const [touched, setTouched] = useState<Record<string, boolean>>({});
    const sourceRef = useDialogAutoFocus(true);

    const handleChange = <K extends keyof EditFieldMappingFormState>(
      field: K,
      value: EditFieldMappingFormState[K],
    ) => {
      const next = { ...form, [field]: value };
      setForm(next);
      if (touched[field]) {
        setErrors(validateForm(next));
      }
    };

    const handleBlur = (field: keyof EditFieldMappingFormState) => {
      setTouched((prev) => ({ ...prev, [field]: true }));
      setErrors(validateForm(form));
    };

    const handleSubmit = () => {
      setTouched({ sourceField: true });
      const formErrors = validateForm(form);
      setErrors(formErrors);
      if (Object.keys(formErrors).length > 0) {
        requestAnimationFrame(() => focusFirstInvalidField());
        return;
      }

      const body: FieldMappingUpdateRequestBody = {
        sourceField: form.sourceField.trim(),
        columnDefinitionId: fm.columnDefinitionId,
        isPrimaryKey: form.isPrimaryKey,
        refColumnDefinitionId: form.refColumnDefinitionId,
        refEntityKey: form.refEntityKey,
        refBidirectionalFieldMappingId: form.refBidirectionalFieldMappingId,
      };

      onSubmit(body);
    };

    const showRefFields = columnDefinitionType === "reference" || columnDefinitionType === "reference-array";

    return (
      <Modal
        open
        onClose={onClose}
        title="Edit Field Mapping"
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
            onBlur={() => handleBlur("sourceField")}
            error={touched.sourceField && !!errors.sourceField}
            helperText={touched.sourceField && errors.sourceField}
            slotProps={{ htmlInput: { "aria-invalid": touched.sourceField && !!errors.sourceField } }}
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
          {showRefFields && (
            <>
              <AsyncSearchableSelect
                label="Ref Column Definition"
                value={form.refColumnDefinitionId}
                onChange={(val: string | null) => handleChange("refColumnDefinitionId", val)}
                onSearch={onSearchColumnDefinitions}
              />
              <AsyncSearchableSelect
                label="Ref Entity Key"
                value={form.refEntityKey}
                onChange={(val: string | null) => handleChange("refEntityKey", val)}
                onSearch={onSearchConnectorEntitiesForRefKey}
              />
              <AsyncSearchableSelect
                label="Ref Bidirectional Field Mapping"
                value={form.refBidirectionalFieldMappingId}
                onChange={(val: string | null) => handleChange("refBidirectionalFieldMappingId", val)}
                onSearch={onSearchFieldMappings}
              />
            </>
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
  onSearchColumnDefinitions,
  onSearchConnectorEntitiesForRefKey,
  onSearchFieldMappings,
  isPending,
  serverError,
  columnDefinitionType,
}) => {
  if (!open) return null;

  return (
    <EditForm
      key={fieldMapping.sourceField}
      fieldMapping={fieldMapping}
      onSubmit={onSubmit}
      onSearchColumnDefinitions={onSearchColumnDefinitions}
      onSearchConnectorEntitiesForRefKey={onSearchConnectorEntitiesForRefKey}
      onSearchFieldMappings={onSearchFieldMappings}
      onClose={onClose}
      isPending={isPending}
      serverError={serverError}
      columnDefinitionType={columnDefinitionType}
    />
  );
};
