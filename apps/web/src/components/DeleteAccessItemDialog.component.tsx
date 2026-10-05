import React from "react";

import { Button, Modal, Stack } from "@portalai/core/ui";
import Typography from "@mui/material/Typography";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";

export type AccessItemKind = "policy" | "role" | "group";

export interface DeleteAccessItemDialogUIProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  kind: AccessItemKind;
  itemName: string;
  isPending: boolean;
  serverError: ServerError | null;
}

const CONSEQUENCE: Record<AccessItemKind, string> = {
  policy:
    "Roles and groups that include it stop granting its permissions immediately.",
  role: "Members assigned this role lose the permissions it granted immediately.",
  group:
    "Its members lose the permissions it granted immediately. Their accounts are not affected.",
};

/** #691: the confirm before deleting a custom role, policy or group (it was
 *  deleted on the first click, with no pending state). */
export const DeleteAccessItemDialogUI: React.FC<
  DeleteAccessItemDialogUIProps
> = ({ open, onClose, onConfirm, kind, itemName, isPending, serverError }) => (
  <Modal
    submitDisabled={isPending}
    open={open}
    onClose={onClose}
    title={`Delete ${kind}`}
    maxWidth="xs"
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
      <Typography variant="body2">
        Delete <strong>{itemName}</strong>? {CONSEQUENCE[kind]}
      </Typography>
      <FormAlert serverError={serverError} />
    </Stack>
  </Modal>
);
