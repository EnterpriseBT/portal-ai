import React, { useState } from "react";

import { z } from "zod";
import type { UpdateStationBody } from "@portalai/core/contracts";
import type { Station } from "@portalai/core/models";
import { StationToolPackSchema } from "@portalai/core/models";
import { Button, Modal, MultiSearchableSelect, Stack } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import TextField from "@mui/material/TextField";

import { ConnectorInstancePicker } from "./ConnectorInstancePicker.component";
import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";
import { validateWithSchema, focusFirstInvalidField, type FormErrors } from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";

const TOOL_PACK_LABELS: Record<string, string> = {
  data_query: "Data Query",
  statistics: "Statistics",
  regression: "Regression",
  financial: "Financial",
  web_search: "Web Search",
};

const TOOL_PACK_OPTIONS: SelectOption[] = StationToolPackSchema.options.map(
  (value) => ({ value, label: TOOL_PACK_LABELS[value] ?? value })
);


interface FormState {
  name: string;
  toolPacks: string[];
  connectorInstanceIds: string[];
}

const EditStationFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  toolPacks: z.array(z.string()).min(1, "At least one tool pack is required"),
});

function validateForm(form: FormState): FormErrors {
  const result = validateWithSchema(EditStationFormSchema, form);
  return result.success ? {} : result.errors;
}

interface StationInstance {
  connectorInstanceId: string;
}

export interface EditStationDialogProps {
  open: boolean;
  onClose: () => void;
  station: Station & { instances?: StationInstance[] };
  onSubmit: (body: UpdateStationBody) => void;
  isPending: boolean;
  serverError: ServerError | null;
}

export const EditStationDialog: React.FC<EditStationDialogProps> = ({
  open,
  onClose,
  station,
  onSubmit,
  isPending,
  serverError,
}) => {
  const initialInstanceIds = (station.instances ?? []).map(
    (i) => i.connectorInstanceId
  );
  const [form, setForm] = useState<FormState>({
    name: station.name,
    toolPacks: [...station.toolPacks],
    connectorInstanceIds: [...initialInstanceIds],
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const nameRef = useDialogAutoFocus(open);

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
    if (Object.keys(formErrors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }

    const body: UpdateStationBody = {};
    if (form.name.trim() !== station.name) {
      body.name = form.name.trim();
    }
    if (JSON.stringify(form.toolPacks) !== JSON.stringify(station.toolPacks)) {
      body.toolPacks = form.toolPacks;
    }
    const sortedCurrent = [...initialInstanceIds].sort();
    const sortedNew = [...form.connectorInstanceIds].sort();
    if (JSON.stringify(sortedNew) !== JSON.stringify(sortedCurrent)) {
      body.connectorInstanceIds = form.connectorInstanceIds;
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
            {isPending ? "Saving..." : "Save"}
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
        <MultiSearchableSelect
          options={TOOL_PACK_OPTIONS}
          value={form.toolPacks}
          onChange={(values) => handleChange("toolPacks", values)}
          label="Tool Packs"
          placeholder="Select tool packs..."
          required
          error={touched.toolPacks && !!errors.toolPacks}
          helperText={touched.toolPacks ? errors.toolPacks : undefined}
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
