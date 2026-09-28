import React from "react";

import { Button, Modal, Stack, Typography } from "@portalai/core/ui";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";

export interface DeleteCuratedViewDialogProps {
  open: boolean;
  onClose: () => void;
  viewLabel: string;
  onConfirm: () => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}

export const DeleteCuratedViewDialog: React.FC<
  DeleteCuratedViewDialogProps
> = ({ open, onClose, viewLabel, onConfirm, isPending, serverError }) => {
  if (!open) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Delete view"
      maxWidth="xs"
      fullWidth
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
          >
            {isPending ? "Deleting..." : "Delete"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography>
          Delete <strong>{viewLabel}</strong>? Members granted this view will
          lose access to its data. This also removes its station attachments and
          grants.
        </Typography>
        <FormAlert serverError={serverError ?? null} />
      </Stack>
    </Modal>
  );
};
