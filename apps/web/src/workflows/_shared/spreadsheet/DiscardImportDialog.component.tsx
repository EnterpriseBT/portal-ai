import React from "react";

import { Button, Modal, Stack, Typography } from "@portalai/core/ui";

import { useDialogAutoFocus } from "../../../utils/use-dialog-autofocus.util";

export interface DiscardImportDialogUIProps {
  open: boolean;
  /** Keep editing: closes this dialog and leaves the wizard as it was. */
  onKeepEditing: () => void;
  /** Discard: closes the wizard and drops its regions. */
  onDiscard: () => void;
}

/**
 * Asks before a spreadsheet wizard with drawn regions closes (#795). One
 * Escape used to discard the whole import, and the keyboard reaches Escape
 * routinely; Keep editing has focus, so a second Escape or Enter is safe.
 */
export const DiscardImportDialogUI: React.FC<DiscardImportDialogUIProps> = ({
  open,
  onKeepEditing,
  onDiscard,
}) => {
  const keepRef = useDialogAutoFocus<HTMLButtonElement>(open);
  return (
    <Modal
      describeContent
      open={open}
      onClose={onKeepEditing}
      title="Discard this import?"
      maxWidth="xs"
      fullWidth
      actions={
        <Stack direction="row" spacing={1}>
          <Button
            ref={keepRef}
            type="button"
            variant="contained"
            onClick={onKeepEditing}
          >
            Keep editing
          </Button>
          <Button
            type="button"
            variant="outlined"
            color="error"
            onClick={onDiscard}
          >
            Discard
          </Button>
        </Stack>
      }
    >
      <Typography variant="body1">
        The regions you&apos;ve drawn and their settings will be lost.
      </Typography>
    </Modal>
  );
};
