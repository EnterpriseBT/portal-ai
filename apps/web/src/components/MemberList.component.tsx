import React from "react";

import {
  Select,
  MenuItem,
  IconButton,
  Tooltip,
  Chip,
  type SelectChangeEvent,
} from "@mui/material";

import {
  DataTable,
  Icon,
  IconName,
  type DataTableColumn,
} from "@portalai/core/ui";
import type { OrgRole } from "@portalai/core/models";
import type { Member } from "@portalai/core/contracts";

export interface MemberListUIProps {
  members: Member[];
  /** The caller's role — the re-role Select is shown only to an owner. */
  callerRole: OrgRole;
  /** The caller's own user id — removing yourself is disabled. */
  callerUserId: string;
  onChangeRole: (userId: string, role: OrgRole) => void;
  onRemove: (member: Member) => void;
  /** A mutation is in flight — disable the row controls. */
  isPending?: boolean;
}

/**
 * Pure members table (#585). Re-role is owner-only (a `Select` on non-owner
 * rows for an owner caller; a static Chip otherwise) — the owner role is
 * immutable (#576). Remove is disabled for the caller's own row and for the
 * last remaining owner. The server enforces all of this; this only shapes the
 * affordances.
 */
export const MemberListUI: React.FC<MemberListUIProps> = ({
  members,
  callerRole,
  callerUserId,
  onChangeRole,
  onRemove,
  isPending = false,
}) => {
  const ownerCount = members.filter((m) => m.role === "owner").length;

  const columns: DataTableColumn[] = [
    { key: "name", label: "Name", render: (v) => (v ? String(v) : "—") },
    { key: "email", label: "Email", render: (v) => (v ? String(v) : "—") },
    {
      key: "role",
      label: "Role",
      render: (_v, row) => {
        const member = row as unknown as Member;
        const editable = callerRole === "owner" && member.role !== "owner";
        if (!editable) {
          return <Chip size="small" variant="outlined" label={member.role} />;
        }
        return (
          <Select
            size="small"
            value={member.role}
            disabled={isPending}
            onChange={(e: SelectChangeEvent) =>
              onChangeRole(member.userId, e.target.value as OrgRole)
            }
            aria-label={`Role for ${member.email ?? member.userId}`}
          >
            <MenuItem value="admin">admin</MenuItem>
            <MenuItem value="member">member</MenuItem>
          </Select>
        );
      },
    },
    {
      key: "joinedAt",
      label: "Joined",
      render: (v) => new Date(Number(v)).toLocaleDateString(),
    },
    {
      key: "actions",
      label: "",
      render: (_v, row) => {
        const member = row as unknown as Member;
        const isSelf = member.userId === callerUserId;
        const isLastOwner = member.role === "owner" && ownerCount <= 1;
        const disabled = isPending || isSelf || isLastOwner;
        const reason = isSelf
          ? "You can't remove yourself"
          : isLastOwner
            ? "Can't remove the last owner"
            : "Remove member";
        return (
          <Tooltip title={reason}>
            <span>
              <IconButton
                size="small"
                color="error"
                disabled={disabled}
                onClick={() => onRemove(member)}
                aria-label={`Remove ${member.email ?? member.userId}`}
              >
                <Icon name={IconName.Delete} fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={members as unknown as Record<string, unknown>[]}
      emptyMessage="No members yet."
    />
  );
};
