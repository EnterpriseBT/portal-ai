import React, { useState } from "react";

import { z } from "zod";
import TextField from "@mui/material/TextField";
import { Button, Modal, Stack } from "@portalai/core/ui";

import {
  validateWithSchema,
  focusFirstInvalidField,
  type FormErrors,
} from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";

const EditNameSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
});

export interface EditConnectorInstanceDialogProps {
  open: boolean;
  onClose: () => void;
  currentName: string;
  onConfirm: (newName: string) => void;
  isPending?: boolean;
}

const EditForm: React.FC<{
  currentName: string;
  onConfirm: (newName: string) => void;
  onClose: () => void;
  isPending?: boolean;
}> = ({ currentName, onConfirm, onClose, isPending }) => {
  const [name, setName] = useState(currentName);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState(false);
  const nameRef = useDialogAutoFocus(true);

  const saveDisabled =
    isPending || name.trim() === "" || name.trim() === currentName;

  const handleSubmit = () => {
    setTouched(true);
    const result = validateWithSchema(EditNameSchema, { name });
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
      const result = validateWithSchema(EditNameSchema, { name: value });
      setErrors(result.success ? {} : result.errors);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit Connector Instance"
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
          inputRef={nameRef}
          label="Name"
          value={name}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={() => {
            setTouched(true);
            const result = validateWithSchema(EditNameSchema, { name });
            setErrors(result.success ? {} : result.errors);
          }}
          error={touched && !!errors.name}
          helperText={touched && errors.name}
          slotProps={{
            htmlInput: { "aria-invalid": touched && !!errors.name },
          }}
          required
          fullWidth
        />
      </Stack>
    </Modal>
  );
};

export const EditConnectorInstanceDialog: React.FC<
  EditConnectorInstanceDialogProps
> = ({ open, onClose, currentName, onConfirm, isPending }) => {
  if (!open) return null;

  return (
    <EditForm
      key={currentName}
      currentName={currentName}
      onConfirm={onConfirm}
      onClose={onClose}
      isPending={isPending}
    />
  );
};
