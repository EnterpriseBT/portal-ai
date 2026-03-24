import React from "react";

import type { EntityTag } from "@portalai/core/models";
import { Button, Modal, Stack, Typography } from "@portalai/core/ui";

export interface DeleteTagDialogProps {
  open: boolean;
  onClose: () => void;
  tag: EntityTag | null;
  onConfirm: () => void;
  isPending: boolean;
}

export const DeleteTagDialog: React.FC<DeleteTagDialogProps> = ({
  open,
  onClose,
  tag,
  onConfirm,
  isPending,
}) => (
  <Modal
    open={open}
    onClose={onClose}
    title="Delete Tag"
    maxWidth="sm"
    fullWidth
    actions={
      <Stack direction="row" spacing={1}>
        <Button variant="outlined" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <Button
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
        entities currently tagged with &quot;{tag?.name}&quot; will have this tag
        detached.
      </Typography>
    </Stack>
  </Modal>
);
