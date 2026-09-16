import React, { useState } from "react";

import { CircularProgress } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";

import { Box, Stack, Typography, StatusMessage } from "@portalai/core/ui";
import type { OrgRole } from "@portalai/core/models";
import type { Member, SeatUsage } from "@portalai/core/contracts";

import { sdk } from "../api/sdk";
import { queryKeys } from "../api/keys";
import { useRole } from "../utils/use-role.util";
import { useToast } from "../utils/toast.context";
import { toServerError } from "../utils/api.util";
import { MemberListUI } from "./MemberList.component";
import { RemoveMemberDialog } from "./RemoveMemberDialog.component";

// ── UI (pure) ──────────────────────────────────────────────────────────

export interface MembersTabUIProps {
  members: Member[];
  seatUsage: SeatUsage;
  callerRole: OrgRole;
  callerUserId: string;
  onChangeRole: (userId: string, role: OrgRole) => void;
  onRemoveClick: (member: Member) => void;
  isLoading?: boolean;
  error?: Error | null;
  mutating?: boolean;
}

/** Human seat-usage label: "N / M seats" when a cap is set, else "N members". */
const seatUsageLabel = ({ used, max }: SeatUsage): string =>
  max === null
    ? `${used} member${used === 1 ? "" : "s"}`
    : `${used} / ${max} seats used`;

export const MembersTabUI: React.FC<MembersTabUIProps> = ({
  members,
  seatUsage,
  callerRole,
  callerUserId,
  onChangeRole,
  onRemoveClick,
  isLoading = false,
  error = null,
  mutating = false,
}) => (
  <Stack spacing={2}>
    <Typography variant="body2" color="text.secondary">
      {seatUsageLabel(seatUsage)}
    </Typography>
    {error ? (
      <StatusMessage variant="error" error={error} />
    ) : isLoading ? (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress aria-label="Loading members" />
      </Box>
    ) : (
      <MemberListUI
        members={members}
        callerRole={callerRole}
        callerUserId={callerUserId}
        onChangeRole={onChangeRole}
        onRemove={onRemoveClick}
        isPending={mutating}
      />
    )}
  </Stack>
);

// ── Container ──────────────────────────────────────────────────────────

/**
 * The owner/admin-only Members/Team tab (#585) — mounted lazily behind Settings
 * › Members, so its queries fire only while active. The server enforces the
 * gate (403) + all mutations; this shapes affordances and surfaces outcomes as
 * toasts. Invite + pending-invitations arrive in a later slice.
 */
export const MembersTab: React.FC = () => {
  const { role } = useRole();
  const profileQuery = sdk.auth.profile();
  const membersQuery = sdk.members.list();
  const changeRole = sdk.members.changeRole();
  const remove = sdk.members.remove();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);

  const members = membersQuery.data?.members ?? [];
  const seatUsage: SeatUsage = membersQuery.data?.seatUsage ?? {
    used: 0,
    max: null,
  };
  // Identify the caller among the members (by verified email) so the UI can
  // disable removing yourself. Falls back to "" (no self-match) if unknown.
  const callerEmail = profileQuery.data?.profile.email ?? null;
  const callerUserId =
    (callerEmail &&
      members.find((m) => m.email && m.email === callerEmail)?.userId) ||
    "";

  const invalidateMembers = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.members.root });

  const handleChangeRole = (userId: string, newRole: OrgRole) => {
    changeRole.mutate(
      { userId, role: newRole },
      {
        onSuccess: () => {
          invalidateMembers();
          toast.success("Role updated");
        },
        onError: (error) =>
          toast.error(toServerError(error)?.message ?? "Failed to change role"),
      }
    );
  };

  const handleRemoveConfirm = () => {
    if (!removeTarget) return;
    remove.mutate(
      { userId: removeTarget.userId },
      {
        onSuccess: () => {
          invalidateMembers();
          toast.success("Member removed");
          setRemoveTarget(null);
        },
        // Stay open on error so the server message (e.g. last-owner) shows in
        // the dialog's FormAlert.
      }
    );
  };

  return (
    <>
      <MembersTabUI
        members={members}
        seatUsage={seatUsage}
        callerRole={role ?? "member"}
        callerUserId={callerUserId}
        onChangeRole={handleChangeRole}
        onRemoveClick={setRemoveTarget}
        isLoading={membersQuery.isLoading}
        error={membersQuery.error}
        mutating={changeRole.isPending || remove.isPending}
      />
      <RemoveMemberDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        member={removeTarget}
        onConfirm={handleRemoveConfirm}
        isPending={remove.isPending}
        serverError={toServerError(remove.error)}
      />
    </>
  );
};
