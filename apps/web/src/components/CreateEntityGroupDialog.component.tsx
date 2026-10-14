import React, { useState } from "react";

import {
  EntityGroupCreateRequestBodySchema,
  type EntityGroupCreateRequestBody,
} from "@portalai/core/contracts";
import { Button, Modal, Stack } from "@portalai/core/ui";
import TextField from "@mui/material/TextField";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";
import {
  validateWithSchema,
  focusFirstInvalidField,
  type FormErrors,
} from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";
import { blurUnlessDialogControl } from "../utils/dialog-blur.util";

export interface CreateEntityGroupDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: EntityGroupCreateRequestBody) => void;
  isPending: boolean;
  serverError: ServerError | null;
}

export const CreateEntityGroupDialog: React.FC<
  CreateEntityGroupDialogProps
> = ({ open, onClose, onSubmit, isPending, serverError }) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const nameRef = useDialogAutoFocus(open);

  const validate = (data: { name: string }) => {
    const result = validateWithSchema(EntityGroupCreateRequestBodySchema, data);
    return result.success ? {} : result.errors;
  };

  const handleSubmit = () => {
    setTouched({ name: true });
    const body = {
      name: name.trim(),
      description: description.trim() || undefined,
    };
    const formErrors = validate({ name: body.name });
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }
    onSubmit(body);
  };

  // Clear on open, not on close: the parent closes on success without
  // going through Cancel, so a close-time reset left the last group behind.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setName("");
      setDescription("");
      setErrors({});
      setTouched({});
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Entity Group"
      maxWidth="sm"
      fullWidth
      onSubmit={handleSubmit}
      submitDisabled={isPending}
      pending={isPending}
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
            {isPending ? "Creating..." : "Create"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <TextField
          inputRef={nameRef}
          label="Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (touched.name) {
              const errs = validate({ name: e.target.value.trim() });
              setErrors(errs);
            }
          }}
          onBlur={blurUnlessDialogControl(() => {
            setTouched((prev) => ({ ...prev, name: true }));
            setErrors(validate({ name: name.trim() }));
          })}
          error={touched.name && !!errors.name}
          helperText={touched.name && errors.name}
          slotProps={{
            htmlInput: { "aria-invalid": touched.name && !!errors.name },
          }}
          required
          fullWidth
        />
        <TextField
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
          multiline
          rows={3}
        />
        <FormAlert serverError={serverError} />
      </Stack>
    </Modal>
  );
};
