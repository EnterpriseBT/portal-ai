import React, { useState } from "react";

import type { EntityTag } from "@portalai/core/models";
import type {
  EntityTagCreateRequestBody,
  EntityTagUpdateRequestBody,
} from "@portalai/core/contracts";
import {
  Button,
  Modal,
  Stack,
  Typography,
  ColorPicker,
  DEFAULT_COLOR_SAMPLES,
} from "@portalai/core/ui";
import TextField from "@mui/material/TextField";

// ── Form types ──────────────────────────────────────────────────────

interface TagFormState {
  name: string;
  color: string;
  description: string;
}

interface TagFormErrors {
  name?: string;
  color?: string;
}

const DEFAULT_TAG_COLOR = "#3b82f6";
const INITIAL_FORM: TagFormState = { name: "", color: DEFAULT_TAG_COLOR, description: "" };

function validateTagForm(form: TagFormState): TagFormErrors {
  const errors: TagFormErrors = {};
  if (!form.name.trim()) {
    errors.name = "Name is required";
  }
  if (form.color && !/^#[\dA-Fa-f]{6}$/.test(form.color)) {
    errors.color = "Color must be a valid hex code (e.g. #FF0000)";
  }
  return errors;
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
  serverError: string | null;
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
  const [errors, setErrors] = useState<TagFormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

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
      actions={
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
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
          label="Name"
          value={form.name}
          onChange={(e) => handleChange("name", e.target.value)}
          onBlur={() => handleBlur("name")}
          error={touched.name && !!errors.name}
          helperText={touched.name && errors.name}
          required
          fullWidth
          autoFocus
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
        {serverError && (
          <Typography variant="body2" color="error">
            {serverError}
          </Typography>
        )}
      </Stack>
    </Modal>
  );
};
