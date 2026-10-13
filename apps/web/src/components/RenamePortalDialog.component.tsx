import React, { useState } from "react";

import { UpdatePortalBodySchema } from "@portalai/core/contracts";
import { Button, Modal, Stack } from "@portalai/core/ui";
import TextField from "@mui/material/TextField";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";
import {
  focusFirstInvalidField,
  validateWithSchema,
  type FormErrors,
} from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";

export interface RenamePortalDialogProps {
  open: boolean;
  onClose: () => void;
  currentName: string;
  onSubmit: (name: string) => void;
  isPending: boolean;
  serverError?: ServerError | null;
}

export const RenamePortalDialog: React.FC<RenamePortalDialogProps> = ({
  open,
  onClose,
  currentName,
  onSubmit,
  isPending,
  serverError,
}) => {
  const [name, setName] = useState(currentName);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState(false);
  const nameRef = useDialogAutoFocus(open);

  const validate = (value: string) =>
    validateWithSchema(UpdatePortalBodySchema, { name: value });

  const handleSubmit = () => {
    setTouched(true);
    const result = validate(name);
    if (!result.success) {
      setErrors(result.errors);
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }
    // `name` is optional in the PATCH contract, but this dialog always sends
    // one; never fall back to a blank rename.
    const trimmed = result.data.name;
    if (trimmed === undefined) return;
    setErrors({});
    // The schema trims, so a whitespace-only edit reads as unchanged.
    if (trimmed === currentName) {
      onClose();
      return;
    }
    onSubmit(trimmed);
  };

  const handleChange = (value: string) => {
    setName(value);
    if (touched) {
      const result = validate(value);
      setErrors(result.success ? {} : result.errors);
    }
  };

  const handleBlur = () => {
    setTouched(true);
    const result = validate(name);
    setErrors(result.success ? {} : result.errors);
  };

  return (
    <Modal
      submitDisabled={isPending}
      open={open}
      onClose={onClose}
      title="Rename Portal"
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
            disabled={isPending}
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
          onBlur={handleBlur}
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
