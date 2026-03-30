import React from "react";

import { Button, Modal, Stack, Typography } from "@portalai/core/ui";

interface DeletePortalDialogProps {
  open: boolean;
  onClose: () => void;
  portalName: string;
  onConfirm: () => void;
  isPending?: boolean;
}

export const DeletePortalDialog: React.FC<DeletePortalDialogProps> = ({
  open,
  onClose,
  portalName,
  onConfirm,
  isPending = false,
}) => (
  <Modal
    open={open}
    onClose={onClose}
    title="Delete Portal"
    maxWidth="sm"
    fullWidth
    slotProps={{
      paper: {
        component: "form",
        onSubmit: (e: React.FormEvent) => {
          e.preventDefault();
          onConfirm();
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
          onClick={onConfirm}
          disabled={isPending}
          data-testid="confirm-delete-portal"
        >
          {isPending ? "Deleting..." : "Delete"}
        </Button>
      </Stack>
    }
  >
    <Stack spacing={2} sx={{ pt: 1 }}>
      <Typography variant="body1">
        Are you sure you want to delete <strong>{portalName}</strong>?
      </Typography>
      <Typography variant="body2" color="warning.main">
        All messages will be permanently deleted. Pinned results will not be
        affected. This action cannot be undone.
      </Typography>
    </Stack>
  </Modal>
);
