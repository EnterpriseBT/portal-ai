import React, { useState } from "react";

import { z } from "zod";
import { descriptionField, nameField } from "@portalai/core/contracts";
import type { EntityTag } from "@portalai/core/models";
import type {
  EntityTagCreateRequestBody,
  EntityTagUpdateRequestBody,
} from "@portalai/core/contracts";
import {
  Button,
  Modal,
  Stack,
  ColorPicker,
  DEFAULT_COLOR_SAMPLES,
} from "@portalai/core/ui";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";
import {
  validateWithSchema,
  focusFirstInvalidField,
  type FormErrors,
} from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";
import { blurUnlessDialogControl } from "../utils/dialog-blur.util";

// ── Form types ──────────────────────────────────────────────────────

interface TagFormState {
  name: string;
  color: string;
  description: string;
}

/** #801: editing a tag, an unchanged name or description isn't held to the
 *  length limit (the name isn't resent), so a tag saved before the limit stays
 *  editable. A new tag, or an edited value, must fit. */
const tagFormSchema = (form: TagFormState, original: EntityTag | null) =>
  z.object({
    name:
      original && form.name.trim() === original.name
        ? z.string().trim().min(1, "Name is required")
        : nameField(),
    description:
      original && form.description.trim() === (original.description ?? "")
        ? z.string()
        : descriptionField(),
    color: z.string().refine((v) => !v || /^#[\dA-Fa-f]{6}$/.test(v), {
      message: "Color must be a valid hex code (e.g. #FF0000)",
    }),
  });

const DEFAULT_TAG_COLOR = "#3b82f6";
const INITIAL_FORM: TagFormState = {
  name: "",
  color: DEFAULT_TAG_COLOR,
  description: "",
};

function validateTagForm(
  form: TagFormState,
  original: EntityTag | null
): FormErrors {
  const result = validateWithSchema(tagFormSchema(form, original), form);
  return result.success ? {} : result.errors;
}

// ── Component ───────────────────────────────────────────────────────

export interface TagFormModalProps {
  open: boolean;
  onClose: () => void;
  tag: EntityTag | null;
  onSubmit: (
    body: EntityTagCreateRequestBody | EntityTagUpdateRequestBody
  ) => void;
  isPending: boolean;
  serverError: ServerError | null;
}

export const TagFormModal: React.FC<TagFormModalProps> = ({
  open,
  onClose,
  tag,
  onSubmit,
  isPending,
  serverError,
}) => {
  const isEdit = tag !== null;
  const [form, setForm] = useState<TagFormState>(INITIAL_FORM);
  const [colorModified, setColorModified] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const nameRef = useDialogAutoFocus(open);

  React.useEffect(() => {
    if (open) {
      if (tag) {
        setForm({
          name: tag.name,
          color: tag.color ?? "",
          description: tag.description ?? "",
        });
        setColorModified(!!tag.color);
      } else {
        setForm(INITIAL_FORM);
        setColorModified(false);
      }
      setErrors({});
      setTouched({});
    }
  }, [open, tag]);

  const handleChange = (field: keyof TagFormState, value: string) => {
    const next = { ...form, [field]: value };
    setForm(next);
    if (field === "color") setColorModified(true);
    if (touched[field]) {
      setErrors(validateTagForm(next, tag));
    }
  };

  const handleBlur = (field: keyof TagFormState) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors(validateTagForm(form, tag));
  };

  const handleSubmit = () => {
    setTouched({ name: true, color: true, description: true });
    const formErrors = validateTagForm(form, tag);
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }

    // #801: an edit doesn't resend an unchanged name or description.
    const nameChanged = !tag || form.name.trim() !== tag.name;
    const body: EntityTagCreateRequestBody | EntityTagUpdateRequestBody = {
      ...(nameChanged ? { name: form.name.trim() } : {}),
      ...(colorModified && form.color ? { color: form.color } : {}),
      ...(form.description.trim() &&
      (!tag || form.description.trim() !== (tag.description ?? ""))
        ? { description: form.description.trim() }
        : {}),
    };
    onSubmit(body);
  };

  return (
    <Modal
      pending={isPending}
      submitDisabled={isPending}
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit Tag" : "Create Tag"}
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
            {isPending ? "Saving..." : isEdit ? "Update" : "Create"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <TextField
          inputRef={nameRef}
          label="Name"
          value={form.name}
          onChange={(e) => handleChange("name", e.target.value)}
          onBlur={blurUnlessDialogControl(() => handleBlur("name"))}
          error={touched.name && !!errors.name}
          helperText={touched.name && errors.name}
          slotProps={{
            htmlInput: { "aria-invalid": touched.name && !!errors.name },
          }}
          required
          fullWidth
        />
        <Stack spacing={0.5}>
          <ColorPicker
            label="Color"
            value={form.color}
            onChange={(color) => handleChange("color", color)}
            samples={DEFAULT_COLOR_SAMPLES}
            wheelSize={120}
          />
          {touched.color && errors.color && (
            <Typography variant="caption" color="error">
              {errors.color}
            </Typography>
          )}
        </Stack>
        <TextField
          label="Description"
          value={form.description}
          onChange={(e) => handleChange("description", e.target.value)}
          onBlur={blurUnlessDialogControl(() => handleBlur("description"))}
          error={touched.description && !!errors.description}
          helperText={touched.description && errors.description}
          slotProps={{
            htmlInput: {
              "aria-invalid": touched.description && !!errors.description,
            },
          }}
          fullWidth
          multiline
          rows={3}
        />
        <FormAlert serverError={serverError} />
      </Stack>
    </Modal>
  );
};
