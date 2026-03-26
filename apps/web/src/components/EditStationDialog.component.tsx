import React, { useState } from "react";

import type { UpdateStationBody } from "@portalai/core/contracts";
import type { Station } from "@portalai/core/models";
import { StationToolPackSchema } from "@portalai/core/models";
import { Button, Modal, Stack, Typography } from "@portalai/core/ui";
import TextField from "@mui/material/TextField";
import Autocomplete from "@mui/material/Autocomplete";
import Chip from "@mui/material/Chip";

const TOOL_PACK_OPTIONS = StationToolPackSchema.options;

const TOOL_PACK_LABELS: Record<string, string> = {
  data_query: "Data Query",
  statistics: "Statistics",
  regression: "Regression",
  financial: "Financial",
  web_search: "Web Search",
};

interface FormState {
  name: string;
  toolPacks: string[];
}

interface FormErrors {
  name?: string;
  toolPacks?: string;
}

function validateForm(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) {
    errors.name = "Name is required";
  }
  if (form.toolPacks.length === 0) {
    errors.toolPacks = "At least one tool pack is required";
  }
  return errors;
}

export interface EditStationDialogProps {
  open: boolean;
  onClose: () => void;
  station: Station;
  onSubmit: (body: UpdateStationBody) => void;
  isPending: boolean;
  serverError: string | null;
}

export const EditStationDialog: React.FC<EditStationDialogProps> = ({
  open,
  onClose,
  station,
  onSubmit,
  isPending,
  serverError,
}) => {
  const [form, setForm] = useState<FormState>({
    name: station.name,
    toolPacks: [...station.toolPacks],
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const handleChange = (field: keyof FormState, value: string | string[]) => {
    const next = { ...form, [field]: value };
    setForm(next);
    if (touched[field]) {
      setErrors(validateForm(next));
    }
  };

  const handleBlur = (field: keyof FormState) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors(validateForm(form));
  };

  const handleSubmit = () => {
    setTouched({ name: true, toolPacks: true });
    const formErrors = validateForm(form);
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) return;

    const body: UpdateStationBody = {};
    if (form.name.trim() !== station.name) {
      body.name = form.name.trim();
    }
    if (JSON.stringify(form.toolPacks) !== JSON.stringify(station.toolPacks)) {
      body.toolPacks = form.toolPacks;
    }

    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }

    onSubmit(body);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Station"
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
            {isPending ? "Saving..." : "Save"}
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
        {serverError && (
          <Typography variant="body2" color="error">
            {serverError}
          </Typography>
        )}
      </Stack>
    </Modal>
  );
};
