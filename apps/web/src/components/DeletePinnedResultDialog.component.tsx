import React from "react";

import { Button, Modal, Stack, Typography } from "@portalai/core/ui";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";

export interface DeletePinnedResultDialogProps {
  open: boolean;
  onClose: () => void;
  resultName: string;
  onConfirm: () => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}

export const DeletePinnedResultDialog: React.FC<
  DeletePinnedResultDialogProps
> = ({
  open,
  onClose,
  resultName,
  onConfirm,
  isPending = false,
  serverError,
}) => (
  <Modal
    open={open}
    onClose={onClose}
    title="Delete Pinned Result"
    maxWidth="sm"
    fullWidth
    onSubmit={onConfirm}
    submitDisabled={isPending}
    pending={isPending}
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
          onClick={onConfirm}
          disabled={isPending}
          data-testid="delete-confirm"
        >
          {isPending ? "Deleting..." : "Delete"}
        </Button>
      </Stack>
    }
  >
    <Stack spacing={2} sx={{ pt: 1 }}>
      <Typography variant="body1">
        Are you sure you want to delete <strong>{resultName}</strong>? This
        action cannot be undone.
      </Typography>
      <FormAlert serverError={serverError ?? null} />
    </Stack>
  </Modal>
);
