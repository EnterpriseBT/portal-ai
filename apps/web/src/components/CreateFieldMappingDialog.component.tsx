import React, { useState } from "react";

import { z } from "zod";
import type { FieldMappingCreateRequestBody } from "@portalai/core/contracts";
import { AsyncSearchableSelect, Button, Modal, Stack } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";
import {
  validateWithSchema,
  focusFirstInvalidField,
  type FormErrors,
} from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";

// ── Validation ──────────────────────────────────────────────────────

const CreateFieldMappingFormSchema = z.object({
  connectorEntityId: z.string().min(1, "Connector entity is required"),
  sourceField: z.string().trim().min(1, "Source field is required"),
  isPrimaryKey: z.boolean(),
  refColumnDefinitionId: z.string().nullable(),
  refEntityKey: z.string().nullable(),
  refBidirectionalFieldMappingId: z.string().nullable(),
});

interface CreateFieldMappingFormState {
  connectorEntityId: string;
  sourceField: string;
  isPrimaryKey: boolean;
  refColumnDefinitionId: string | null;
  refEntityKey: string | null;
  refBidirectionalFieldMappingId: string | null;
}

const INITIAL_FORM: CreateFieldMappingFormState = {
  connectorEntityId: "",
  sourceField: "",
  isPrimaryKey: false,
  refColumnDefinitionId: null,
  refEntityKey: null,
  refBidirectionalFieldMappingId: null,
};

function validateForm(form: CreateFieldMappingFormState): FormErrors {
  const result = validateWithSchema(CreateFieldMappingFormSchema, form);
  return result.success ? {} : result.errors;
}

// ── Component ───────────────────────────────────────────────────────

export interface CreateFieldMappingDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: FieldMappingCreateRequestBody) => void;
  onSearchConnectorEntities: (query: string) => Promise<SelectOption[]>;
  onSearchColumnDefinitions: (query: string) => Promise<SelectOption[]>;
  onSearchConnectorEntitiesForRefKey: (query: string) => Promise<SelectOption[]>;
  onSearchFieldMappings: (query: string) => Promise<SelectOption[]>;
  isPending: boolean;
  serverError: ServerError | null;
  columnDefinitionId: string;
  columnDefinitionLabel: string;
  columnDefinitionType: string;
}

export const CreateFieldMappingDialog: React.FC<CreateFieldMappingDialogProps> = ({
  open,
  onClose,
  onSubmit,
  onSearchConnectorEntities,
  onSearchColumnDefinitions,
  onSearchConnectorEntitiesForRefKey,
  onSearchFieldMappings,
  isPending,
  serverError,
  columnDefinitionId,
  columnDefinitionLabel,
  columnDefinitionType,
}) => {
  const [form, setForm] = useState<CreateFieldMappingFormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const connectorEntityRef = useDialogAutoFocus(open);

  React.useEffect(() => {
    if (open) {
      setForm(INITIAL_FORM);
      setErrors({});
      setTouched({});
    }
  }, [open]);

  const handleChange = <K extends keyof CreateFieldMappingFormState>(
    field: K,
    value: CreateFieldMappingFormState[K],
  ) => {
    const next = { ...form, [field]: value };
    setForm(next);
    if (touched[field]) {
      setErrors(validateForm(next));
    }
  };

  const handleBlur = (field: keyof CreateFieldMappingFormState) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors(validateForm(form));
  };

  const handleSubmit = () => {
    setTouched({ connectorEntityId: true, sourceField: true });
    const formErrors = validateForm(form);
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }

    onSubmit({
      connectorEntityId: form.connectorEntityId,
      columnDefinitionId,
      sourceField: form.sourceField.trim(),
      isPrimaryKey: form.isPrimaryKey,
      refColumnDefinitionId: form.refColumnDefinitionId,
      refEntityKey: form.refEntityKey,
      refBidirectionalFieldMappingId: form.refBidirectionalFieldMappingId,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Field Mapping"
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
          <Button type="button" variant="contained" onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Creating..." : "Create"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <TextField
          label="Column Definition"
          value={columnDefinitionLabel}
          disabled
          fullWidth
        />
        <AsyncSearchableSelect
          inputRef={connectorEntityRef}
          label="Connector Entity"
          value={form.connectorEntityId || null}
          onChange={(val) => handleChange("connectorEntityId", val ?? "")}
          onSearch={onSearchConnectorEntities}
          error={touched.connectorEntityId && !!errors.connectorEntityId}
          helperText={touched.connectorEntityId ? errors.connectorEntityId : undefined}
          required
        />
        <TextField
          label="Source Field"
          value={form.sourceField}
          onChange={(e) => handleChange("sourceField", e.target.value)}
          onBlur={() => handleBlur("sourceField")}
          error={touched.sourceField && !!errors.sourceField}
          helperText={touched.sourceField && errors.sourceField}
          slotProps={{ htmlInput: { "aria-invalid": touched.sourceField && !!errors.sourceField } }}
          required
          fullWidth
        />
        <FormControlLabel
          control={
            <Switch
              checked={form.isPrimaryKey}
              onChange={(e) => handleChange("isPrimaryKey", e.target.checked)}
            />
          }
          label="Primary Key"
        />
        {(columnDefinitionType === "reference" || columnDefinitionType === "reference-array") && (
          <>
            <AsyncSearchableSelect
              label="Ref Column Definition"
              value={form.refColumnDefinitionId}
              onChange={(val) => handleChange("refColumnDefinitionId", val)}
              onSearch={onSearchColumnDefinitions}
            />
            <AsyncSearchableSelect
              label="Ref Entity Key"
              value={form.refEntityKey}
              onChange={(val) => handleChange("refEntityKey", val)}
              onSearch={onSearchConnectorEntitiesForRefKey}
            />
            <AsyncSearchableSelect
              label="Ref Bidirectional Field Mapping"
              value={form.refBidirectionalFieldMappingId}
              onChange={(val) => handleChange("refBidirectionalFieldMappingId", val)}
              onSearch={onSearchFieldMappings}
            />
          </>
        )}
        <FormAlert serverError={serverError} />
      </Stack>
    </Modal>
  );
};
