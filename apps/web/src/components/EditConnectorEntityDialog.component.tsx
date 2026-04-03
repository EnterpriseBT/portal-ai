import React, { useState } from "react";

import {
  ConnectorEntityPatchRequestBodySchema,
  type ConnectorEntityPatchRequestBody,
} from "@portalai/core/contracts";
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

export interface EditConnectorEntityDialogProps {
  open: boolean;
  onClose: () => void;
  entity: { label: string };
  onSubmit: (body: ConnectorEntityPatchRequestBody) => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}

const EditForm: React.FC<{
  entity: { label: string };
  onSubmit: (body: ConnectorEntityPatchRequestBody) => void;
  onClose: () => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}> = ({ entity, onSubmit, onClose, isPending, serverError }) => {
  const [label, setLabel] = useState(entity.label);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState(false);
  const labelRef = useDialogAutoFocus(true);

  const saveDisabled =
    isPending || label.trim() === "" || label.trim() === entity.label;

  const validate = (data: { label: string }): FormErrors => {
    const result = validateWithSchema(
      ConnectorEntityPatchRequestBodySchema,
      data
    );
    return result.success ? {} : result.errors;
  };

  const handleSubmit = () => {
    setTouched(true);
    const trimmed = label.trim();
    const formErrors = validate({ label: trimmed });
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }
    if (trimmed === entity.label) return;
    onSubmit({ label: trimmed });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit Connector Entity"
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
            disabled={saveDisabled}
          >
            {isPending ? "Saving..." : "Save"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          inputRef={labelRef}
          label="Label"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            if (touched) {
              setErrors(validate({ label: e.target.value.trim() }));
            }
          }}
          onBlur={() => {
            setTouched(true);
            setErrors(validate({ label: label.trim() }));
          }}
          error={touched && !!errors.label}
          helperText={touched && errors.label}
          slotProps={{
            htmlInput: { "aria-invalid": touched && !!errors.label },
          }}
          required
          fullWidth
        />
        <FormAlert serverError={serverError ?? null} />
      </Stack>
    </Modal>
  );
};

export const EditConnectorEntityDialog: React.FC<
  EditConnectorEntityDialogProps
> = ({ open, onClose, entity, onSubmit, isPending, serverError }) => {
  if (!open) return null;

  return (
    <EditForm
      key={entity.label}
      entity={entity}
      onSubmit={onSubmit}
      onClose={onClose}
      isPending={isPending}
      serverError={serverError}
    />
  );
};
