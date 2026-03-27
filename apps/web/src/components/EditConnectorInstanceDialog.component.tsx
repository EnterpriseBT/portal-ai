import React, { useState } from "react";

import TextField from "@mui/material/TextField";
import { Button, Modal, Stack } from "@portalai/core/ui";

export interface EditConnectorInstanceDialogProps {
  open: boolean;
  onClose: () => void;
  currentName: string;
  onConfirm: (newName: string) => void;
  isPending?: boolean;
}

const EditForm: React.FC<{
  currentName: string;
  onConfirm: (newName: string) => void;
  onClose: () => void;
  isPending?: boolean;
}> = ({ currentName, onConfirm, onClose, isPending }) => {
  const [name, setName] = useState(currentName);

  const saveDisabled =
    isPending || name.trim() === "" || name.trim() === currentName;

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit Connector Instance"
      maxWidth="sm"
      fullWidth
      actions={
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => onConfirm(name.trim())}
            disabled={saveDisabled}
          >
            {isPending ? "Saving..." : "Save"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          fullWidth
          autoFocus
        />
      </Stack>
    </Modal>
  );
};

export const EditConnectorInstanceDialog: React.FC<
  EditConnectorInstanceDialogProps
> = ({ open, onClose, currentName, onConfirm, isPending }) => {
  if (!open) return null;

  return (
    <EditForm
      key={currentName}
      currentName={currentName}
      onConfirm={onConfirm}
      onClose={onClose}
      isPending={isPending}
    />
  );
};
