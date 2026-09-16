import React from "react";

import { Button, Modal, Stack, Typography } from "@portalai/core/ui";
import type { Member } from "@portalai/core/contracts";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";

export interface RemoveMemberDialogProps {
  open: boolean;
  onClose: () => void;
  member: Member | null;
  onConfirm: () => void;
  isPending: boolean;
  serverError?: ServerError | null;
}

/**
 * Confirm removing a member (#585). A lightweight confirm — removal is a
 * soft-delete, so no type-to-confirm (unlike org deletion). Stays open on error
 * so the server message (e.g. last-owner) is readable.
 */
export const RemoveMemberDialog: React.FC<RemoveMemberDialogProps> = ({
  open,
  onClose,
  member,
  onConfirm,
  isPending,
  serverError,
}) => (
  <Modal
    open={open}
    onClose={onClose}
    title="Remove member"
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
          {isPending ? "Removing..." : "Remove"}
        </Button>
      </Stack>
    }
  >
    <Stack spacing={2}>
      <Typography>
        Remove <strong>{member?.email ?? member?.name ?? "this member"}</strong>{" "}
        from the organization? They lose access immediately and can be
        re-invited later.
      </Typography>
      <FormAlert serverError={serverError ?? null} />
    </Stack>
  </Modal>
);
