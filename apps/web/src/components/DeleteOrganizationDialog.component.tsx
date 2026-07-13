import React, { useState } from "react";

import TextField from "@mui/material/TextField";

import { Button, Modal, Stack, Typography } from "@portalai/core/ui";

import { FormAlert } from "./FormAlert.component";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";
import type { ServerError } from "../utils/api.util";

export interface DeleteOrganizationDialogProps {
  open: boolean;
  onClose: () => void;
  organizationName: string;
  /** Receives the typed (trimmed) name — the server re-verifies it (#197). */
  onConfirm: (confirmationName: string) => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}

export const DeleteOrganizationDialog: React.FC<
  DeleteOrganizationDialogProps
> = ({
  open,
  onClose,
  organizationName,
  onConfirm,
  isPending = false,
  serverError,
}) => {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const inputRef = useDialogAutoFocus(open);

  // Reset the confirmation input whenever the dialog reopens — the
  // "adjust state during render" pattern (not an effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setValue("");
      setTouched(false);
    }
  }

  const matches = value.trim() === organizationName.trim();
  const showError = touched && !matches;

  const handleConfirm = () => {
    if (!matches || isPending) return;
    onConfirm(value.trim());
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Delete Organization"
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          component: "form",
          onSubmit: (e: React.FormEvent) => {
            e.preventDefault();
            handleConfirm();
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
            onClick={handleConfirm}
            disabled={!matches || isPending}
            data-testid="confirm-delete-organization"
          >
            {isPending ? "Deleting..." : "Delete organization"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body1">
          You are about to permanently delete{" "}
          <strong>{organizationName}</strong>.
        </Typography>
        <Typography variant="body2" color="warning.main">
          This destroys all organization data — stations, portals, connectors,
          records, and uploads. Every member loses access and you will be signed
          out. This action cannot be undone.
        </Typography>
        <TextField
          inputRef={inputRef}
          label={`Type "${organizationName}" to confirm`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
          error={showError}
          helperText={
            showError ? "Enter the organization name exactly to confirm" : " "
          }
          disabled={isPending}
          fullWidth
          slotProps={{ htmlInput: { "aria-invalid": showError } }}
        />
        <FormAlert serverError={serverError ?? null} />
      </Stack>
    </Modal>
  );
};
