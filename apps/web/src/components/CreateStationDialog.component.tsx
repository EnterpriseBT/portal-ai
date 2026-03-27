import React, { useState } from "react";

import type { CreateStationBody } from "@portalai/core/contracts";
import { StationToolPackSchema } from "@portalai/core/models";
import { Button, Modal, Stack, Typography } from "@portalai/core/ui";
import TextField from "@mui/material/TextField";
import Autocomplete from "@mui/material/Autocomplete";
import Chip from "@mui/material/Chip";

import { ConnectorInstancePicker } from "./ConnectorInstancePicker.component";

// ── Types ────────────────────────────────────────────────────────────

const TOOL_PACK_OPTIONS = StationToolPackSchema.options;

const TOOL_PACK_LABELS: Record<string, string> = {
  data_query: "Data Query",
  statistics: "Statistics",
  regression: "Regression",
  financial: "Financial",
  web_search: "Web Search",
};

interface StationFormState {
  name: string;
  description: string;
  connectorInstanceIds: string[];
  toolPacks: string[];
}

interface StationFormErrors {
  name?: string;
  toolPacks?: string;
}

const INITIAL_FORM: StationFormState = {
  name: "",
  description: "",
  connectorInstanceIds: [],
  toolPacks: ["data_query"],
};

function validateForm(form: StationFormState): StationFormErrors {
  const errors: StationFormErrors = {};
  if (!form.name.trim()) {
    errors.name = "Name is required";
  }
  if (form.toolPacks.length === 0) {
    errors.toolPacks = "At least one tool pack is required";
  }
  return errors;
}

// ── Component ────────────────────────────────────────────────────────

export interface CreateStationDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: CreateStationBody) => void;
  isPending: boolean;
  serverError: string | null;
}

export const CreateStationDialog: React.FC<CreateStationDialogProps> = ({
  open,
  onClose,
  onSubmit,
  isPending,
  serverError,
}) => {
  const [form, setForm] = useState<StationFormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<StationFormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

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
    if (Object.keys(formErrors).length > 0) return;

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
            {isPending ? "Creating..." : "Create"}
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
          getOptionLabel={(o) => TOOL_PACK_LABELS[o] ?? o}
          value={form.toolPacks}
          onChange={(_, newValue) => handleChange("toolPacks", newValue)}
          onBlur={() => handleBlur("toolPacks")}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => {
              const { key, ...tagProps } = getTagProps({ index });
              return (
                <Chip
                  key={key}
                  label={TOOL_PACK_LABELS[option] ?? option}
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
            />
          )}
        />
        <ConnectorInstancePicker
          selected={form.connectorInstanceIds}
          onChange={(ids) => handleChange("connectorInstanceIds", ids)}
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
