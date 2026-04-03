import React from "react";

import Alert from "@mui/material/Alert";
import {
  Button,
  Modal,
  Stack,
  Typography,
} from "@portalai/core/ui";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";

export interface DeleteEntityRecordDialogProps {
  open: boolean;
  onClose: () => void;
  recordSourceId: string;
  onConfirm: () => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}

export const DeleteEntityRecordDialog: React.FC<
  DeleteEntityRecordDialogProps
> = ({
  open,
  onClose,
  recordSourceId,
  onConfirm,
  isPending,
  serverError,
}) => {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Delete Entity Record"
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          component: "form",
          onSubmit: (e: React.FormEvent) => {
            e.preventDefault();
            if (!isPending) onConfirm();
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
            color="error"
            onClick={() => { if (!isPending) onConfirm(); }}
            disabled={isPending}
          >
            {isPending ? "Deleting..." : "Delete"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body1">
          Are you sure you want to delete record{" "}
          <strong>{recordSourceId}</strong>?
        </Typography>

        <Alert severity="warning">
          This action will permanently delete this record. This cannot be undone.
        </Alert>
        <FormAlert serverError={serverError ?? null} />
      </Stack>
    </Modal>
  );
};
