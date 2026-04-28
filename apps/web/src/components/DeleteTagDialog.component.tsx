import React from "react";

import type { EntityTag } from "@portalai/core/models";
import { Button, Modal, Stack, Typography } from "@portalai/core/ui";

import { FormAlert } from "./FormAlert.component";
import type { ServerError } from "../utils/api.util";

export interface DeleteTagDialogProps {
  open: boolean;
  onClose: () => void;
  tag: EntityTag | null;
  onConfirm: () => void;
  isPending: boolean;
  serverError?: ServerError | null;
}

export const DeleteTagDialog: React.FC<DeleteTagDialogProps> = ({
  open,
  onClose,
  tag,
  onConfirm,
  isPending,
  serverError,
}) => (
  <Modal
    open={open}
    onClose={onClose}
    title="Delete Tag"
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
          {isPending ? "Deleting..." : "Delete"}
        </Button>
      </Stack>
    }
  >
    <Stack spacing={2} sx={{ pt: 1 }}>
      <Typography variant="body1">
        Are you sure you want to delete the tag <strong>{tag?.name}</strong>?
      </Typography>
      <Typography variant="body2" color="warning.main">
        All entity tag assignments that reference this tag will be removed. Any
        entities currently tagged with &quot;{tag?.name}&quot; will have this
        tag detached.
      </Typography>
      <FormAlert serverError={serverError ?? null} />
    </Stack>
  </Modal>
);
