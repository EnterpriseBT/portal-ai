import React, { useState } from "react";

import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import {
  GatedButton,
  pendingGate,
  Stack,
  Typography,
  type ActionGate,
} from "@portalai/core/ui";
import type { InvitationBlockContent } from "@portalai/core/contracts";

import { sdk } from "../api/sdk";
import { queryKeys } from "../api/keys";
import { decideActionGate } from "../utils/action-gate.util";
import { useCapabilities } from "../utils/use-capabilities.util";
import { useToast } from "../utils/toast.context";
import { InviteLinkDialogUI } from "./InviteLinkDialog.component";

const ROLE_LABEL: Record<InvitationBlockContent["role"], string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export interface InvitationBlockUIProps {
  content: InvitationBlockContent;
  /** Whether the viewer may get a link, and whether one is being made. */
  getLinkGate: ActionGate;
  onGetLink: () => void;
}

/**
 * An invitation the assistant made or found (#847): who it's for, the role
 * they'll get and when it expires, with a "Get invite link" button. The block
 * never holds the link: the button asks for a fresh one, shown in a dialog.
 */
export const InvitationBlockUI: React.FC<InvitationBlockUIProps> = ({
  content,
  getLinkGate,
  onGetLink,
}) => (
  <Paper
    variant="outlined"
    component="section"
    aria-label={`Invitation: ${content.email}`}
    data-testid="invitation-block"
    sx={{ p: 2 }}
  >
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Typography variant="subtitle2" component="p">
          {content.email}
        </Typography>
        <Chip
          label={ROLE_LABEL[content.role]}
          size="small"
          variant="outlined"
        />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Invitation pending · expires{" "}
        {new Date(content.expiresAt).toLocaleDateString(undefined, {
          dateStyle: "medium",
        } as Intl.DateTimeFormatOptions)}
      </Typography>
      <Stack direction="row">
        <GatedButton
          type="button"
          variant="outlined"
          gate={getLinkGate}
          onClick={onGetLink}
        >
          Get invite link
        </GatedButton>
      </Stack>
    </Stack>
  </Paper>
);

export interface InvitationBlockProps {
  content: InvitationBlockContent;
}

/**
 * Wires the block: "Get invite link" calls the resend endpoint Settings →
 * Members uses, which rotates the token, and opens the fresh link in a
 * dialog. The link lives only in this component's state and is dropped when
 * the dialog closes, so it never reaches the stored conversation.
 */
export const InvitationBlock: React.FC<InvitationBlockProps> = ({
  content,
}) => {
  const { can } = useCapabilities();
  const toast = useToast();
  const resend = sdk.invitations.resend();
  const [url, setUrl] = useState<string | null>(null);

  const permitted = decideActionGate({ allowed: can("member.invite") });
  const getLinkGate =
    permitted.kind === "allow"
      ? pendingGate(resend.isPending, "Generating a link…")
      : permitted;

  const handleGetLink = () => {
    resend.mutate(
      { id: content.invitationId },
      {
        invalidate: [queryKeys.invitations.root],
        toast: { error: "Couldn't generate a link" },
        onSuccess: (updated) => setUrl(updated.inviteUrl ?? null),
      }
    );
  };

  const handleCopy = (link: string) => {
    navigator.clipboard.writeText(link).then(
      () => toast.success("Link copied"),
      () => toast.error("Couldn't copy — select the link and copy it manually")
    );
  };

  return (
    <>
      <InvitationBlockUI
        content={content}
        getLinkGate={getLinkGate}
        onGetLink={handleGetLink}
      />
      <InviteLinkDialogUI
        open={url !== null}
        email={content.email}
        url={url}
        onCopy={handleCopy}
        onClose={() => setUrl(null)}
      />
    </>
  );
};
