import React from "react";

import {
  Select,
  MenuItem,
  IconButton,
  Tooltip,
  Chip,
  Stack,
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

const ALL_ROLES: OrgRole[] = ["owner", "admin", "member"];

export interface MemberListUIProps {
  members: Member[];
  /** Whether the caller may assign roles (`can("member.role.assign")`) — the
   *  multi-select editor is shown only then. The server enforces the finer
   *  owner/admin gating (owner-only), surfacing a 403 the container toasts. */
  canManageRoles: boolean;
  /** The caller's own user id — removing yourself is disabled. */
  callerUserId: string;
  /** Set a member's complete role set (#620 set-the-set). */
  onSetRoles: (userId: string, roles: OrgRole[]) => void;
  onRemove: (member: Member) => void;
  /** A mutation is in flight — disable the row controls. */
  isPending?: boolean;
}

/**
 * Pure members table (#620). The Role column renders each member's `roles[]` as
 * chips (by name); an owner/admin caller gets a multi-select to set the whole
 * role set. Remove is disabled for the caller's own row and for the last
 * remaining owner. The server enforces all of this (owner/admin assignment is
 * owner-only, ≥1-role, last-owner) — this only shapes the affordances.
 */
export const MemberListUI: React.FC<MemberListUIProps> = ({
  members,
  canManageRoles,
  callerUserId,
  onSetRoles,
  onRemove,
  isPending = false,
}) => {
  const ownerCount = members.filter((m) => m.roles.includes("owner")).length;

  const columns: DataTableColumn[] = [
    { key: "name", label: "Name", render: (v) => (v ? String(v) : "—") },
    { key: "email", label: "Email", render: (v) => (v ? String(v) : "—") },
    {
      key: "roles",
      label: "Roles",
      render: (_v, row) => {
        const member = row as unknown as Member;
        if (!canManageRoles) {
          return (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              {member.roles.map((r) => (
                <Chip key={r} size="small" variant="outlined" label={r} />
              ))}
            </Stack>
          );
        }
        return (
          <Select<OrgRole[]>
            size="small"
            multiple
            value={member.roles}
            disabled={isPending}
            onChange={(e: SelectChangeEvent<OrgRole[]>) => {
              const next = e.target.value;
              onSetRoles(
                member.userId,
                typeof next === "string" ? (next.split(",") as OrgRole[]) : next
              );
            }}
            renderValue={(selected) => (
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                {selected.map((r) => (
                  <Chip key={r} size="small" label={r} />
                ))}
              </Stack>
            )}
            aria-label={`Roles for ${member.email ?? member.userId}`}
          >
            {ALL_ROLES.map((r) => (
              <MenuItem key={r} value={r}>
                {r}
              </MenuItem>
            ))}
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
        const isLastOwner = member.roles.includes("owner") && ownerCount <= 1;
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
