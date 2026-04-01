import React, { useState } from "react";

import {
  FieldMappingUpdateRequestBodySchema,
  type FieldMappingUpdateRequestBody,
} from "@portalai/core/contracts";
import { AsyncSearchableSelect } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import { Button, Modal, Stack } from "@portalai/core/ui";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";
import {
  validateWithSchema,
  focusFirstInvalidField,
  type FormErrors,
} from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";

export interface EditFieldMappingDialogProps {
  open: boolean;
  onClose: () => void;
  fieldMapping: {
    sourceField: string;
    isPrimaryKey: boolean;
    columnDefinitionId: string;
    columnDefinitionLabel?: string;
  };
  onSubmit: (body: FieldMappingUpdateRequestBody) => void;
  onSearchColumnDefinitions: (query: string) => Promise<SelectOption[]>;
  isPending?: boolean;
  serverError?: ServerError | null;
}

const EditForm: React.FC<{
  fieldMapping: EditFieldMappingDialogProps["fieldMapping"];
  onSubmit: (body: FieldMappingUpdateRequestBody) => void;
  onSearchColumnDefinitions: (query: string) => Promise<SelectOption[]>;
  onClose: () => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}> = ({ fieldMapping: fm, onSubmit, onSearchColumnDefinitions, onClose, isPending, serverError }) => {
  const [sourceField, setSourceField] = useState(fm.sourceField);
  const [isPrimaryKey, setIsPrimaryKey] = useState(fm.isPrimaryKey);
  const [columnDefinitionId, setColumnDefinitionId] = useState<string | null>(fm.columnDefinitionId);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState(false);
  const sourceRef = useDialogAutoFocus(true);

  const validate = (data: { sourceField: string; columnDefinitionId: string }): FormErrors => {
    const result = validateWithSchema(FieldMappingUpdateRequestBodySchema, data);
    return result.success ? {} : result.errors;
  };

  const handleSubmit = () => {
    setTouched(true);
    const trimmed = sourceField.trim();
    const formErrors = validate({ sourceField: trimmed, columnDefinitionId: columnDefinitionId ?? "" });
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }

    onSubmit({
      sourceField: trimmed,
      columnDefinitionId: columnDefinitionId!,
      isPrimaryKey,
    });
  };

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
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          inputRef={sourceRef}
          label="Source Field"
          value={sourceField}
          onChange={(e) => {
            setSourceField(e.target.value);
            if (touched) setErrors(validate({ sourceField: e.target.value.trim(), columnDefinitionId: columnDefinitionId ?? fm.columnDefinitionId }));
          }}
          onBlur={() => {
            setTouched(true);
            setErrors(validate({ sourceField: sourceField.trim(), columnDefinitionId: columnDefinitionId ?? fm.columnDefinitionId }));
          }}
          error={touched && !!errors.sourceField}
          helperText={touched && errors.sourceField}
          slotProps={{ htmlInput: { "aria-invalid": touched && !!errors.sourceField } }}
          required
          fullWidth
        />
        <AsyncSearchableSelect
          label="Column Definition"
          value={columnDefinitionId}
          error={!!errors.columnDefinitionId}
          onChange={(val) => setColumnDefinitionId(val)}
          onSearch={onSearchColumnDefinitions}
          helperText={fm.columnDefinitionLabel ? `Current: ${fm.columnDefinitionLabel}` : undefined}
        />
        <FormControlLabel
          control={
            <Switch
              checked={isPrimaryKey}
              onChange={(e) => setIsPrimaryKey(e.target.checked)}
            />
          }
          label="Primary Key"
        />
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
  isPending,
  serverError,
}) => {
  if (!open) return null;

  return (
    <EditForm
      key={fieldMapping.sourceField}
      fieldMapping={fieldMapping}
      onSubmit={onSubmit}
      onSearchColumnDefinitions={onSearchColumnDefinitions}
      onClose={onClose}
      isPending={isPending}
      serverError={serverError}
    />
  );
};
