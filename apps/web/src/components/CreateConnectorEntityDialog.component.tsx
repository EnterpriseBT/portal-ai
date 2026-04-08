import React, { useState } from "react";

import { z } from "zod";
import type { ConnectorEntityCreateRequestBody } from "@portalai/core/contracts";
import { AsyncSearchableSelect, Button, Modal, Stack } from "@portalai/core/ui";
import TextField from "@mui/material/TextField";

import { sdk } from "../api/sdk";
import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";
import { validateWithSchema, focusFirstInvalidField, type FormErrors } from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";

// ── Types ────────────────────────────────────────────────────────────

interface EntityFormState {
  label: string;
  key: string;
  connectorInstanceId: string;
}

const EntityFormSchema = z.object({
  label: z.string().trim().min(1, "Label is required"),
  key: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "Key must start with a lowercase letter and contain only lowercase letters, numbers, and underscores"
    ),
  connectorInstanceId: z.string().min(1, "Connector instance is required"),
});

const INITIAL_FORM: EntityFormState = {
  label: "",
  key: "",
  connectorInstanceId: "",
};

function validateForm(form: EntityFormState): FormErrors {
  const result = validateWithSchema(EntityFormSchema, form);
  return result.success ? {} : result.errors;
}

// ── Component ────────────────────────────────────────────────────────

export interface CreateConnectorEntityDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: ConnectorEntityCreateRequestBody) => void;
  isPending: boolean;
  serverError: ServerError | null;
  lockedConnectorInstance: { id: string; name: string } | null;
}

export const CreateConnectorEntityDialog: React.FC<CreateConnectorEntityDialogProps> = ({
  open,
  onClose,
  onSubmit,
  isPending,
  serverError,
  lockedConnectorInstance,
}) => {
  const [form, setForm] = useState<EntityFormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const labelRef = useDialogAutoFocus(open);
  const { onSearch: handleSearchConnectorInstances } = sdk.connectorInstances.search({
    defaultParams: { capability: "write" },
  });

  React.useEffect(() => {
    if (open) {
      setForm(
        lockedConnectorInstance
          ? { ...INITIAL_FORM, connectorInstanceId: lockedConnectorInstance.id }
          : INITIAL_FORM
      );
      setErrors({});
      setTouched({});
    }
  }, [open, lockedConnectorInstance]);

  const handleChange = (field: keyof EntityFormState, value: string) => {
    const next = { ...form, [field]: value };
    setForm(next);
    if (touched[field]) {
      setErrors(validateForm(next));
    }
  };

  const handleBlur = (field: keyof EntityFormState) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors(validateForm(form));
  };

  const handleSubmit = () => {
    setTouched({ label: true, key: true, connectorInstanceId: true });
    const formErrors = validateForm(form);
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }
    onSubmit({
      label: form.label.trim(),
      key: form.key,
      connectorInstanceId: form.connectorInstanceId,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Entity"
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
          inputRef={labelRef}
          label="Label"
          value={form.label}
          onChange={(e) => handleChange("label", e.target.value)}
          onBlur={() => handleBlur("label")}
          error={touched.label && !!errors.label}
          helperText={touched.label && errors.label}
          slotProps={{ htmlInput: { "aria-invalid": touched.label && !!errors.label } }}
          required
          fullWidth
        />
        <TextField
          label="Key"
          value={form.key}
          onChange={(e) => handleChange("key", e.target.value)}
          onBlur={() => handleBlur("key")}
          error={touched.key && !!errors.key}
          helperText={(touched.key && errors.key) || 'e.g. "customer_orders"'}
          slotProps={{ htmlInput: { "aria-invalid": touched.key && !!errors.key } }}
          required
          fullWidth
        />
        {lockedConnectorInstance ? (
          <TextField
            label="Connector Instance"
            value={lockedConnectorInstance.name}
            disabled
            fullWidth
          />
        ) : (
          <AsyncSearchableSelect
            label="Connector Instance"
            placeholder="Search connector instances..."
            value={form.connectorInstanceId || null}
            onChange={(val) => handleChange("connectorInstanceId", val ?? "")}
            onSearch={handleSearchConnectorInstances}
            error={touched.connectorInstanceId && !!errors.connectorInstanceId}
            helperText={touched.connectorInstanceId ? errors.connectorInstanceId : undefined}
            required
          />
        )}
        <FormAlert serverError={serverError} />
      </Stack>
    </Modal>
  );
};
