import React from "react";

import type { Station } from "@portalai/core/models";
import {
  GatedButton,
  Modal,
  pendingGate,
  Stack,
  Typography,
} from "@portalai/core/ui";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";

export interface DeleteStationDialogProps {
  open: boolean;
  onClose: () => void;
  station: Station | null;
  onConfirm: () => void;
  isPending: boolean;
  serverError?: ServerError | null;
}

export const DeleteStationDialog: React.FC<DeleteStationDialogProps> = ({
  open,
  onClose,
  station,
  onConfirm,
  isPending,
  serverError,
}) => (
  <Modal
    pending={isPending}
    submitDisabled={isPending}
    open={open}
    onClose={onClose}
    title="Delete Station"
    maxWidth="sm"
    fullWidth
    onSubmit={onConfirm}
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
          onClick={onConfirm}
          gate={pendingGate(isPending, "Deleting…")}
        >
          {isPending ? "Deleting..." : "Delete"}
        </GatedButton>
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
      <FormAlert serverError={serverError ?? null} />
    </Stack>
  </Modal>
);
