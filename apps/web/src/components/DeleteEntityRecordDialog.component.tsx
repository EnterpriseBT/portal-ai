import React from "react";

import Alert from "@mui/material/Alert";
import {
  GatedButton,
  Modal,
  pendingGate,
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
  isPending = false,
  serverError,
}) => {
  return (
    <Modal
      pending={isPending}
      submitDisabled={isPending}
      open={open}
      onClose={onClose}
      title="Delete Entity Record"
      maxWidth="sm"
      fullWidth
      onSubmit={() => {
        if (!isPending) onConfirm();
      }}
      actions={
        <Stack direction="row" spacing={1}>
          <GatedButton
            type="button"
            variant="outlined"
            onClick={onClose}
            gate={pendingGate(isPending, "Wait for this to finish")}
          >
            Cancel
          </GatedButton>
          <GatedButton
            type="button"
            variant="contained"
            color="error"
            onClick={() => {
              if (!isPending) onConfirm();
            }}
            gate={pendingGate(isPending, "Deleting…")}
          >
            {isPending ? "Deleting..." : "Delete"}
          </GatedButton>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body1">
          Are you sure you want to delete record{" "}
          <strong>{recordSourceId}</strong>?
        </Typography>

        <Alert severity="warning">
          This action will permanently delete this record. This cannot be
          undone.
        </Alert>
        <FormAlert serverError={serverError ?? null} />
      </Stack>
    </Modal>
  );
};
