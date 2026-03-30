import React from "react";

import type { Station } from "@portalai/core/models";
import { Button, Modal, Stack, Typography } from "@portalai/core/ui";

export interface DeleteStationDialogProps {
  open: boolean;
  onClose: () => void;
  station: Station | null;
  onConfirm: () => void;
  isPending: boolean;
}

export const DeleteStationDialog: React.FC<DeleteStationDialogProps> = ({
  open,
  onClose,
  station,
  onConfirm,
  isPending,
}) => (
  <Modal
    open={open}
    onClose={onClose}
    title="Delete Station"
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
        >
          {isPending ? "Deleting..." : "Delete"}
        </Button>
      </Stack>
    }
  >
    <Stack spacing={2} sx={{ pt: 1 }}>
      <Typography variant="body1">
        Are you sure you want to delete the station{" "}
        <strong>{station?.name}</strong>?
      </Typography>
      <Typography variant="body2" color="warning.main">
        All associated portals, their messages, and unpinned results will be
        permanently deleted. Pinned results will be preserved. This action
        cannot be undone.
      </Typography>
    </Stack>
  </Modal>
);
