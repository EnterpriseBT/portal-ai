import React, { useState } from "react";

import { z } from "zod";
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
import { validateWithSchema, type FormErrors } from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";

// ── Form types ──────────────────────────────────────────────────────

interface TagFormState {
  name: string;
  color: string;
  description: string;
}

const TagFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  color: z
    .string()
    .refine((v) => !v || /^#[\dA-Fa-f]{6}$/.test(v), {
      message: "Color must be a valid hex code (e.g. #FF0000)",
    }),
});

const DEFAULT_TAG_COLOR = "#3b82f6";
const INITIAL_FORM: TagFormState = { name: "", color: DEFAULT_TAG_COLOR, description: "" };

function validateTagForm(form: TagFormState): FormErrors {
  const result = validateWithSchema(TagFormSchema, form);
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
      setErrors(validateTagForm(next));
    }
  };

  const handleBlur = (field: keyof TagFormState) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors(validateTagForm(form));
  };

  const handleSubmit = () => {
    setTouched({ name: true, color: true });
    const formErrors = validateTagForm(form);
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) return;

    const body: EntityTagCreateRequestBody = {
      name: form.name.trim(),
      ...(colorModified && form.color ? { color: form.color } : {}),
      ...(form.description.trim()
        ? { description: form.description.trim() }
        : {}),
    };
    onSubmit(body);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit Tag" : "Create Tag"}
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
          onBlur={() => handleBlur("name")}
          error={touched.name && !!errors.name}
          helperText={touched.name && errors.name}
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
          fullWidth
          multiline
          rows={3}
        />
        <FormAlert serverError={serverError} />
      </Stack>
    </Modal>
  );
};
