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
import type { Member, RoleRef } from "@portalai/core/contracts";

/** A selectable custom group for the member-centric assignment column (#622). */
export interface GroupOption {
  id: string;
  name: string;
}

export interface MemberListUIProps {
  members: Member[];
  /** Whether the caller may assign roles (`can("member.role.assign")`) — the
   *  multi-select editor is shown only then. The server enforces the finer
   *  owner/admin gating (owner-only), surfacing a 403 the container toasts. */
  canManageRoles: boolean;
  /** The caller's own user id — removing yourself is disabled. */
  callerUserId: string;
  /** The roles assignable here (#622) — the multiselect options (system +
   *  custom); `slug` is the set-the-set key. */
  assignableRoles: RoleRef[];
  /** Set a member's complete role set by slug (#620/#622 set-the-set). */
  onSetRoles: (userId: string, roleSlugs: string[]) => void;
  onRemove: (member: Member) => void;
  /** A mutation is in flight — disable the row controls. */
  isPending?: boolean;
  /** #622: the org's custom groups, shown as a member-centric assignment column
   *  only when the org is `customRbac`-entitled. Empty/omitted → no column. */
  groups?: GroupOption[];
  /** Whether to show the group-assignment column (entitled + capable). */
  canManageGroups?: boolean;
  /** Set a member's complete group set (#622 member-centric set-the-set). */
  onSetGroups?: (userId: string, groupIds: string[]) => void;
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
  assignableRoles,
  onSetRoles,
  onRemove,
  isPending = false,
  groups = [],
  canManageGroups = false,
  onSetGroups,
}) => {
  const ownerCount = members.filter((m) => m.roles.includes("owner")).length;
  const groupNameById = new Map(groups.map((g) => [g.id, g.name]));
  const roleNameBySlug = new Map(assignableRoles.map((r) => [r.slug, r.name]));

  const groupColumn: DataTableColumn = {
    key: "groupIds",
    label: "Groups",
    render: (_v, row) => {
      const member = row as unknown as Member;
      return (
        <Select<string[]>
          size="small"
          multiple
          displayEmpty
          value={member.groupIds}
          disabled={isPending}
          onChange={(e: SelectChangeEvent<string[]>) => {
            const next = e.target.value;
            onSetGroups?.(
              member.userId,
              typeof next === "string" ? next.split(",") : next
            );
          }}
          renderValue={(selected) =>
            selected.length === 0 ? (
              "—"
            ) : (
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                {selected.map((id) => (
                  <Chip
                    key={id}
                    size="small"
                    label={groupNameById.get(id) ?? id}
                  />
                ))}
              </Stack>
            )
          }
          aria-label={`Groups for ${member.email ?? member.userId}`}
        >
          {groups.length === 0 ? (
            <MenuItem disabled value="">
              No groups yet
            </MenuItem>
          ) : (
            groups.map((g) => (
              <MenuItem key={g.id} value={g.id}>
                {g.name}
              </MenuItem>
            ))
          )}
        </Select>
      );
    },
  };

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
              {member.roleSlugs.map((slug) => (
                <Chip
                  key={slug}
                  size="small"
                  variant="outlined"
                  label={roleNameBySlug.get(slug) ?? slug}
                />
              ))}
            </Stack>
          );
        }
        return (
          <Select<string[]>
            size="small"
            multiple
            value={member.roleSlugs}
            disabled={isPending}
            onChange={(e: SelectChangeEvent<string[]>) => {
              const next = e.target.value;
              onSetRoles(
                member.userId,
                typeof next === "string" ? next.split(",") : next
              );
            }}
            renderValue={(selected) => (
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                {selected.map((slug) => (
                  <Chip
                    key={slug}
                    size="small"
                    label={roleNameBySlug.get(slug) ?? slug}
                  />
                ))}
              </Stack>
            )}
            aria-label={`Roles for ${member.email ?? member.userId}`}
          >
            {assignableRoles.map((r) => (
              <MenuItem key={r.slug} value={r.slug}>
                {r.name}
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

  // #622: the member-centric group column sits after Roles, only when the org is
  // entitled and the caller can manage groups.
  if (canManageGroups) columns.splice(3, 0, groupColumn);

  return (
    <DataTable
      columns={columns}
      rows={members as unknown as Record<string, unknown>[]}
      emptyMessage="No members yet."
    />
  );
};
