import React, { useState } from "react";

import TextField from "@mui/material/TextField";
import { ConnectorInstanceCreateRequestBodySchema } from "@portalai/core/contracts";
import { Button, Modal, Stack } from "@portalai/core/ui";
import { useQueryClient } from "@tanstack/react-query";

import { sdk, queryKeys } from "../../api/sdk";
import { FormAlert } from "../../components/FormAlert.component";
import type { ServerError } from "../../utils/api.util";
import { toServerError } from "../../utils/api.util";
import {
  validateWithSchema,
  focusFirstInvalidField,
  type FormErrors,
} from "../../utils/form-validation.util";
import { useDialogAutoFocus } from "../../utils/use-dialog-autofocus.util";
import type { ConnectorWorkflowProps } from "../../views/Connector.view";

// ── UI Component (pure, no hooks) ───────────────────────────────────

export interface SandboxConnectorWorkflowUIProps {
  open: boolean;
  onClose: () => void;
  name: string;
  onNameChange: (value: string) => void;
  onBlur: () => void;
  onSubmit: () => void;
  isPending: boolean;
  errors: FormErrors;
  touched: boolean;
  serverError: ServerError | null;
}

export const SandboxConnectorWorkflowUI: React.FC<
  SandboxConnectorWorkflowUIProps
> = ({
  open,
  onClose,
  name,
  onNameChange,
  onBlur,
  onSubmit,
  isPending,
  errors,
  touched,
  serverError,
}) => {
  const nameRef = useDialogAutoFocus(open);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect Sandbox"
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          component: "form",
          onSubmit: (e: React.FormEvent) => {
            e.preventDefault();
            onSubmit();
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
            onClick={onSubmit}
            disabled={isPending}
          >
            {isPending ? "Connecting..." : "Connect"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <FormAlert serverError={serverError} />
        <TextField
          inputRef={nameRef}
          label="Name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onBlur={onBlur}
          error={touched && !!errors.name}
          helperText={touched && errors.name}
          slotProps={{
            htmlInput: { "aria-invalid": touched && !!errors.name },
          }}
          required
          fullWidth
        />
      </Stack>
    </Modal>
  );
};

// ── Container Component (hooks + state) ─────────────────────────────

export const SandboxConnectorWorkflow: React.FC<ConnectorWorkflowProps> = ({
  open,
  onClose,
  organizationId,
  connectorDefinitionId,
}) => {
  const queryClient = useQueryClient();
  const createMutation = sdk.connectorInstances.create();

  const [name, setName] = useState("Sandbox");
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState(false);

  const handleNameChange = (value: string) => {
    setName(value);
    if (touched) {
      const result = validateWithSchema(
        ConnectorInstanceCreateRequestBodySchema,
        {
          connectorDefinitionId,
          organizationId,
          name: value,
          status: "active",
          enabledCapabilityFlags: { read: true, write: true, sync: false },
        }
      );
      setErrors(result.success ? {} : result.errors);
    }
  };

  const handleBlur = () => {
    setTouched(true);
    const result = validateWithSchema(
      ConnectorInstanceCreateRequestBodySchema,
      {
        connectorDefinitionId,
        organizationId,
        name,
        status: "active",
        enabledCapabilityFlags: { read: true, write: true, sync: false },
      }
    );
    setErrors(result.success ? {} : result.errors);
  };

  const handleSubmit = () => {
    setTouched(true);
    const result = validateWithSchema(
      ConnectorInstanceCreateRequestBodySchema,
      {
        connectorDefinitionId,
        organizationId,
        name,
        status: "active",
        enabledCapabilityFlags: { read: true, write: true, sync: false },
      }
    );
    if (!result.success) {
      setErrors(result.errors);
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }

    createMutation.mutate(result.data, {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.connectorInstances.root,
        });
        setName("Sandbox");
        setErrors({});
        setTouched(false);
        onClose();
      },
    });
  };

  const handleClose = () => {
    setName("Sandbox");
    setErrors({});
    setTouched(false);
    createMutation.reset();
    onClose();
  };

  return (
    <SandboxConnectorWorkflowUI
      open={open}
      onClose={handleClose}
      name={name}
      onNameChange={handleNameChange}
      onBlur={handleBlur}
      onSubmit={handleSubmit}
      isPending={createMutation.isPending}
      errors={errors}
      touched={touched}
      serverError={toServerError(createMutation.error)}
    />
  );
};
