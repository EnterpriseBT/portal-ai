import React from "react";

import { IconButton, Tooltip, Chip } from "@mui/material";

import {
  DataTable,
  Icon,
  IconName,
  type DataTableColumn,
} from "@portalai/core/ui";
import type { InvitationResponse } from "@portalai/core/contracts";

import { isPast } from "../utils/relative-time.util";

export interface PendingInvitationListUIProps {
  invitations: InvitationResponse[];
  onResend: (invitation: InvitationResponse) => void;
  onRevoke: (invitation: InvitationResponse) => void;
  /** A mutation is in flight — disable the row controls. */
  isPending?: boolean;
  /** Current epoch ms, injected for test determinism; defaults to now. */
  now?: number;
}

/**
 * Pure pending-invitations table (#585). Rows are the org's pending-active
 * invites; each offers Resend (mints a fresh link — the original token is
 * hashed and unrecoverable) and Revoke. An invite past its expiry is flagged
 * but still resendable. The server enforces all mutations; this shapes the
 * affordances.
 */
export const PendingInvitationListUI: React.FC<
  PendingInvitationListUIProps
> = ({ invitations, onResend, onRevoke, isPending = false, now }) => {
  const columns: DataTableColumn[] = [
    { key: "email", label: "Email", render: (v) => (v ? String(v) : "—") },
    {
      key: "role",
      label: "Role",
      render: (v) => <Chip size="small" variant="outlined" label={String(v)} />,
    },
    {
      key: "expiresAt",
      label: "Expires",
      render: (v) => {
        const expired = isPast(Number(v), now);
        const when = new Date(Number(v)).toLocaleDateString();
        return expired ? (
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            label="Expired"
          />
        ) : (
          when
        );
      },
    },
    {
      key: "actions",
      label: "",
      render: (_v, row) => {
        const invitation = row as unknown as InvitationResponse;
        return (
          <>
            <Tooltip title="Resend — generates a new link">
              <span>
                <IconButton
                  size="small"
                  disabled={isPending}
                  onClick={() => onResend(invitation)}
                  aria-label={`Resend invitation to ${invitation.email}`}
                >
                  <Icon name={IconName.Refresh} fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Revoke">
              <span>
                <IconButton
                  size="small"
                  color="error"
                  disabled={isPending}
                  onClick={() => onRevoke(invitation)}
                  aria-label={`Revoke invitation to ${invitation.email}`}
                >
                  <Icon name={IconName.Block} fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={invitations as unknown as Record<string, unknown>[]}
      emptyMessage="No pending invitations."
    />
  );
};
