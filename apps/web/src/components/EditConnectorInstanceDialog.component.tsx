import React, { useState } from "react";

import { z } from "zod";
import { nameField } from "@portalai/core/contracts";
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
import { blurUnlessDialogControl } from "../utils/dialog-blur.util";

const EditNameSchema = z.object({
  name: nameField(),
});

export interface EditConnectorInstanceDialogProps {
  open: boolean;
  onClose: () => void;
  currentName: string;
  onConfirm: (newName: string) => void;
  isPending?: boolean;
  /** #789: a failed rename stays readable in the open dialog. */
  serverError?: ServerError | null;
}

const EditForm: React.FC<{
  currentName: string;
  onConfirm: (newName: string) => void;
  onClose: () => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}> = ({ currentName, onConfirm, onClose, isPending = false, serverError }) => {
  const [name, setName] = useState(currentName);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState(false);
  const nameRef = useDialogAutoFocus(true);

  const saveDisabled =
    isPending || name.trim() === "" || name.trim() === currentName;

  // #801: an unchanged name isn't sent, so one saved before the length limit
  // doesn't block the dialog; only an edited name is checked.
  const validate = (value: string) =>
    value.trim() === currentName
      ? ({ success: true, data: { name: currentName } } as const)
      : validateWithSchema(EditNameSchema, { name: value });

  const handleSubmit = () => {
    setTouched(true);
    const result = validate(name);
    if (!result.success) {
      setErrors(result.errors);
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }
    if (result.data.name === currentName) return;
    onConfirm(result.data.name);
  };

  const handleChange = (value: string) => {
    setName(value);
    if (touched) {
      const result = validate(value);
      setErrors(result.success ? {} : result.errors);
    }
  };

  return (
    <Modal
      pending={isPending}
      submitDisabled={saveDisabled}
      open
      onClose={onClose}
      title="Edit Connector Instance"
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
            disabled={saveDisabled}
          >
            {isPending ? "Saving..." : "Save"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          inputRef={nameRef}
          label="Name"
          value={name}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={blurUnlessDialogControl(() => {
            setTouched(true);
            const result = validate(name);
            setErrors(result.success ? {} : result.errors);
          })}
          error={touched && !!errors.name}
          helperText={touched && errors.name}
          slotProps={{
            htmlInput: { "aria-invalid": touched && !!errors.name },
          }}
          required
          fullWidth
        />
        <FormAlert serverError={serverError ?? null} />
      </Stack>
    </Modal>
  );
};

export const EditConnectorInstanceDialog: React.FC<
  EditConnectorInstanceDialogProps
> = ({
  open,
  onClose,
  currentName,
  onConfirm,
  isPending = false,
  serverError,
}) => {
  if (!open) return null;

  return (
    <EditForm
      key={currentName}
      currentName={currentName}
      onConfirm={onConfirm}
      onClose={onClose}
      isPending={isPending}
      serverError={serverError}
    />
  );
};
