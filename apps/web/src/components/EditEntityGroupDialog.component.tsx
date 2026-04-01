import React, { useState } from "react";

import {
  EntityGroupUpdateRequestBodySchema,
  type EntityGroupUpdateRequestBody,
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

export interface EditEntityGroupDialogProps {
  open: boolean;
  onClose: () => void;
  group: { name: string; description: string | null };
  onSubmit: (body: EntityGroupUpdateRequestBody) => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}

const EditForm: React.FC<{
  group: { name: string; description: string | null };
  onSubmit: (body: EntityGroupUpdateRequestBody) => void;
  onClose: () => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}> = ({ group, onSubmit, onClose, isPending, serverError }) => {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const nameRef = useDialogAutoFocus(true);

  const saveDisabled =
    isPending ||
    name.trim() === "" ||
    (name.trim() === group.name &&
      description.trim() === (group.description ?? ""));

  const validate = (data: { name: string }): FormErrors => {
    const result = validateWithSchema(EntityGroupUpdateRequestBodySchema, data);
    return result.success ? {} : result.errors;
  };

  const handleSubmit = () => {
    setTouched({ name: true });
    const trimmedName = name.trim();
    const trimmedDesc = description.trim();
    const formErrors = validate({ name: trimmedName });
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }

    const body: EntityGroupUpdateRequestBody = {};
    if (trimmedName !== group.name) body.name = trimmedName;
    if (trimmedDesc !== (group.description ?? "")) {
      body.description = trimmedDesc || undefined;
    }

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
      title="Edit Entity Group"
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
          onChange={(e) => {
            setName(e.target.value);
            if (touched.name) {
              setErrors(validate({ name: e.target.value.trim() }));
            }
          }}
          onBlur={() => {
            setTouched((prev) => ({ ...prev, name: true }));
            setErrors(validate({ name: name.trim() }));
          }}
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
        <FormAlert serverError={serverError ?? null} />
      </Stack>
    </Modal>
  );
};

export const EditEntityGroupDialog: React.FC<EditEntityGroupDialogProps> = ({
  open,
  onClose,
  group,
  onSubmit,
  isPending,
  serverError,
}) => {
  if (!open) return null;

  return (
    <EditForm
      key={`${group.name}-${group.description}`}
      group={group}
      onSubmit={onSubmit}
      onClose={onClose}
      isPending={isPending}
      serverError={serverError}
    />
  );
};
