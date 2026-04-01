import React, { useState } from "react";

import {
  FieldMappingUpdateRequestBodySchema,
  type FieldMappingUpdateRequestBody,
} from "@portalai/core/contracts";
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
  fieldMapping: { sourceField: string; isPrimaryKey: boolean };
  onSubmit: (body: FieldMappingUpdateRequestBody) => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}

const EditForm: React.FC<{
  fieldMapping: { sourceField: string; isPrimaryKey: boolean };
  onSubmit: (body: FieldMappingUpdateRequestBody) => void;
  onClose: () => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}> = ({ fieldMapping: fm, onSubmit, onClose, isPending, serverError }) => {
  const [sourceField, setSourceField] = useState(fm.sourceField);
  const [isPrimaryKey, setIsPrimaryKey] = useState(fm.isPrimaryKey);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState(false);
  const sourceRef = useDialogAutoFocus(true);

  const validate = (data: { sourceField: string }): FormErrors => {
    const result = validateWithSchema(FieldMappingUpdateRequestBodySchema, data);
    return result.success ? {} : result.errors;
  };

  const handleSubmit = () => {
    setTouched(true);
    const trimmed = sourceField.trim();
    const formErrors = validate({ sourceField: trimmed });
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }

    const body: FieldMappingUpdateRequestBody = {};
    if (trimmed !== fm.sourceField) body.sourceField = trimmed;
    if (isPrimaryKey !== fm.isPrimaryKey) body.isPrimaryKey = isPrimaryKey;

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
            if (touched) setErrors(validate({ sourceField: e.target.value.trim() }));
          }}
          onBlur={() => {
            setTouched(true);
            setErrors(validate({ sourceField: sourceField.trim() }));
          }}
          error={touched && !!errors.sourceField}
          helperText={touched && errors.sourceField}
          slotProps={{ htmlInput: { "aria-invalid": touched && !!errors.sourceField } }}
          required
          fullWidth
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
  isPending,
  serverError,
}) => {
  if (!open) return null;

  return (
    <EditForm
      key={fieldMapping.sourceField}
      fieldMapping={fieldMapping}
      onSubmit={onSubmit}
      onClose={onClose}
      isPending={isPending}
      serverError={serverError}
    />
  );
};
