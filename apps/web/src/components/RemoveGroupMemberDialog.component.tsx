import React from "react";

import { Button, Modal, Stack, Typography } from "@portalai/core/ui";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";

export interface RemoveGroupMemberDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
  serverError?: ServerError | null;
}

/** Confirm removing a member from an entity group (#789). Stays open on
 *  error so the server's reason is readable. */
export const RemoveGroupMemberDialog: React.FC<
  RemoveGroupMemberDialogProps
> = ({ open, onClose, onConfirm, isPending, serverError }) => (
  <Modal
    open={open}
    onClose={onClose}
    title="Remove Member"
    maxWidth="xs"
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
          color="error"
          variant="contained"
          onClick={onConfirm}
          disabled={isPending}
        >
          {isPending ? "Removing..." : "Remove"}
        </Button>
      </Stack>
    }
  >
    <Stack spacing={2} sx={{ pt: 1 }}>
      <Typography>
        Are you sure you want to remove this member from the group?
      </Typography>
      <FormAlert serverError={serverError ?? null} />
    </Stack>
  </Modal>
);
