import React, { useState } from "react";

import TextField from "@mui/material/TextField";
import { z } from "zod";

import { Button, Modal, Stack, Typography } from "@portalai/core/ui";

import { FormAlert } from "./FormAlert.component";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";
import {
  validateWithSchema,
  focusFirstInvalidField,
  type FormErrors,
} from "../utils/form-validation.util";
import type { ServerError } from "../utils/api.util";

export interface ClearEntityRecordsDialogProps {
  open: boolean;
  /** The typed-confirmation token — stable, unlike the record count. */
  entityLabel: string;
  /** Live record count, rendered in the impact line. */
  recordCount: number;
  isPending: boolean;
  serverError: ServerError | null;
  /** Fires only after the typed confirmation validates (#453). */
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Typed-confirmation dialog for clearing every record of a connector
 * entity (#453). Pure UI per the Component File Policy — the entity view
 * wires the mutation, toasts, and lock state. The clear is enqueued as an
 * `entity_record_clear` job, so a successful confirm closes the dialog
 * long before the deletion finishes; the caller owns that messaging.
 */
export const ClearEntityRecordsDialog: React.FC<
  ClearEntityRecordsDialogProps
> = ({
  open,
  entityLabel,
  recordCount,
  isPending,
  serverError,
  onConfirm,
  onClose,
}) => {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const inputRef = useDialogAutoFocus(open);

  // Reset the confirmation whenever the dialog reopens — adjust-state-
  // during-render, not an effect (DeleteOrganizationDialog precedent).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setValue("");
      setTouched(false);
      setErrors({});
    }
  }

  const ConfirmSchema = z.object({
    confirmation: z.string().refine((v) => v.trim() === entityLabel.trim(), {
      message: `Enter "${entityLabel}" exactly to confirm`,
    }),
  });

  const validate = (candidate: string): FormErrors => {
    const result = validateWithSchema(ConfirmSchema, {
      confirmation: candidate,
    });
    return result.success ? {} : result.errors;
  };

  const showError = touched && !!errors.confirmation;

  const handleSubmit = () => {
    if (isPending) return;
    const nextErrors = validate(value);
    setErrors(nextErrors);
    setTouched(true);
    if (nextErrors.confirmation) {
      focusFirstInvalidField();
      return;
    }
    onConfirm();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Delete All Records"
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
            color="error"
            onClick={handleSubmit}
            disabled={isPending}
            data-testid="confirm-clear-entity-records"
          >
            {isPending ? "Deleting…" : "Delete all records"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body1">
          You are about to delete{" "}
          <strong>{recordCount.toLocaleString()} records</strong> from{" "}
          <strong>{entityLabel}</strong>.
        </Typography>
        <Typography variant="body2" color="warning.main">
          The entity, its field mappings, and the connector stay intact — only
          the records are removed. Other changes to this connector are paused
          until the deletion finishes.
        </Typography>
        <TextField
          inputRef={inputRef}
          required
          label={`Type "${entityLabel}" to confirm`}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (touched) setErrors(validate(e.target.value));
          }}
          onBlur={() => {
            setTouched(true);
            setErrors(validate(value));
          }}
          error={showError}
          helperText={showError ? errors.confirmation : " "}
          disabled={isPending}
          fullWidth
          slotProps={{ htmlInput: { "aria-invalid": showError } }}
        />
        <FormAlert serverError={serverError} />
      </Stack>
    </Modal>
  );
};
