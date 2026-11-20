import React from "react";

import { TextField } from "@mui/material";
import { Button, Stack, Typography } from "@portalai/core/ui";

export interface InviteLinkFieldUIProps {
  /** The one-time invite link from an invite or resend. */
  url: string;
  onCopy: (url: string) => void;
  /** Lets a dialog put focus on Copy when it opens. */
  copyButtonRef?: React.Ref<HTMLButtonElement>;
}

/**
 * The one-time invite link with its Copy button (#847): Settings → Members
 * shows it after an invite or resend, and the portal's invitation block shows
 * it in a dialog. The link is shown only here, never stored, so the copy says
 * to share it now.
 */
export const InviteLinkFieldUI: React.FC<InviteLinkFieldUIProps> = ({
  url,
  onCopy,
  copyButtonRef,
}) => (
  <Stack spacing={1}>
    <Typography variant="body2">
      Invitation link — copy and share it now. This link is shown only once.
    </Typography>
    <Stack direction="row" spacing={1} alignItems="center">
      <TextField
        value={url}
        size="small"
        fullWidth
        slotProps={{
          htmlInput: { readOnly: true, "aria-label": "Invite link" },
        }}
      />
      <Button
        ref={copyButtonRef}
        type="button"
        variant="outlined"
        onClick={() => onCopy(url)}
      >
        Copy
      </Button>
    </Stack>
  </Stack>
);
