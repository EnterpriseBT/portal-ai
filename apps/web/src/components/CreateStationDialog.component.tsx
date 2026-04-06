import React, { useState } from "react";

import { z } from "zod";
import type { CreateStationBody } from "@portalai/core/contracts";
import { StationToolPackSchema } from "@portalai/core/models";
import { Button, Modal, Stack } from "@portalai/core/ui";
import TextField from "@mui/material/TextField";
import Autocomplete from "@mui/material/Autocomplete";
import Chip from "@mui/material/Chip";

import { ConnectorInstancePicker } from "./ConnectorInstancePicker.component";
import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";
import { validateWithSchema, focusFirstInvalidField, type FormErrors } from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";
import { ToolPackUtil } from "../utils/tool-packs.util";

// ── Types ────────────────────────────────────────────────────────────

const TOOL_PACK_OPTIONS = StationToolPackSchema.options;

interface StationFormState {
  name: string;
  description: string;
  connectorInstanceIds: string[];
  toolPacks: string[];
}

const StationFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  toolPacks: z.array(z.string()).min(1, "At least one tool pack is required"),
});

const INITIAL_FORM: StationFormState = {
  name: "",
  description: "",
  connectorInstanceIds: [],
  toolPacks: ["data_query"],
};

function validateForm(form: StationFormState): FormErrors {
  const result = validateWithSchema(StationFormSchema, form);
  return result.success ? {} : result.errors;
}

// ── Component ────────────────────────────────────────────────────────

export interface CreateStationDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: CreateStationBody) => void;
  isPending: boolean;
  serverError: ServerError | null;
}

export const CreateStationDialog: React.FC<CreateStationDialogProps> = ({
  open,
  onClose,
  onSubmit,
  isPending,
  serverError,
}) => {
  const [form, setForm] = useState<StationFormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const nameRef = useDialogAutoFocus(open);

  React.useEffect(() => {
    if (open) {
      setForm(INITIAL_FORM);
      setErrors({});
      setTouched({});
    }
  }, [open]);

  const handleChange = (field: keyof StationFormState, value: string | string[]) => {
    const next = { ...form, [field]: value };
    setForm(next);
    if (touched[field]) {
      setErrors(validateForm(next));
    }
  };

  const handleBlur = (field: keyof StationFormState) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors(validateForm(form));
  };

  const handleSubmit = () => {
    setTouched({ name: true, toolPacks: true });
    const formErrors = validateForm(form);
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }

    const body: CreateStationBody = {
      name: form.name.trim(),
      toolPacks: form.toolPacks,
      ...(form.description.trim()
        ? { description: form.description.trim() }
        : {}),
      ...(form.connectorInstanceIds.length > 0
        ? { connectorInstanceIds: form.connectorInstanceIds }
        : {}),
    };
    onSubmit(body);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Station"
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
            {isPending ? "Creating..." : "Create"}
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
          slotProps={{ htmlInput: { "aria-invalid": touched.name && !!errors.name } }}
          required
          fullWidth
        />
        <TextField
          label="Description"
          value={form.description}
          onChange={(e) => handleChange("description", e.target.value)}
          fullWidth
          multiline
          rows={3}
        />
        <Autocomplete
          multiple
          options={[...TOOL_PACK_OPTIONS]}
          getOptionLabel={(o) => ToolPackUtil.getLabel(o)}
          value={form.toolPacks}
          onChange={(_, newValue) => handleChange("toolPacks", newValue)}
          onBlur={() => handleBlur("toolPacks")}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => {
              const { key, ...tagProps } = getTagProps({ index });
              return (
                <Chip
                  key={key}
                  label={ToolPackUtil.getLabel(option)}
                  size="small"
                  {...tagProps}
                />
              );
            })
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label="Tool Packs"
              placeholder="Select tool packs..."
              required
              error={touched.toolPacks && !!errors.toolPacks}
              helperText={touched.toolPacks && errors.toolPacks}
              inputProps={{ ...params.inputProps, "aria-invalid": touched.toolPacks && !!errors.toolPacks || undefined }}
            />
          )}
        />
        <ConnectorInstancePicker
          selected={form.connectorInstanceIds}
          onChange={(ids) => handleChange("connectorInstanceIds", ids)}
        />
        <FormAlert serverError={serverError} />
      </Stack>
    </Modal>
  );
};
