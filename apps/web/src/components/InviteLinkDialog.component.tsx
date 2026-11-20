import React from "react";

import { Button, Modal } from "@portalai/core/ui";

import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";
import { InviteLinkFieldUI } from "./InviteLinkField.component";

export interface InviteLinkDialogUIProps {
  open: boolean;
  /** The invitee, for the title. */
  email: string;
  /** The fresh link; the dialog shows nothing until there is one. */
  url: string | null;
  onCopy: (url: string) => void;
  onClose: () => void;
}

/**
 * The fresh invite link from an invitation block's "Get invite link" (#847),
 * with the same content Settings → Members shows after Resend. It submits
 * nothing, so it isn't a form. Focus lands on Copy when it opens; closing it
 * is the only action, and the container drops the link when it closes.
 */
export const InviteLinkDialogUI: React.FC<InviteLinkDialogUIProps> = ({
  open,
  email,
  url,
  onCopy,
  onClose,
}) => {
  const copyRef = useDialogAutoFocus<HTMLButtonElement>(open && !!url);

  return (
    <Modal
      open={open && !!url}
      onClose={onClose}
      title={`Invite link for ${email}`}
      maxWidth="sm"
      fullWidth
      actions={
        <Button type="button" variant="contained" onClick={onClose}>
          Done
        </Button>
      }
    >
      {url && (
        <InviteLinkFieldUI url={url} onCopy={onCopy} copyButtonRef={copyRef} />
      )}
    </Modal>
  );
};
