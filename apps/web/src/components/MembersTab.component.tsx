import React, { useState } from "react";

import {
  CircularProgress,
  Divider,
  Alert,
  TextField,
  Tooltip,
} from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";

import {
  Box,
  Button,
  Stack,
  Typography,
  StatusMessage,
} from "@portalai/core/ui";
import type {
  Member,
  RoleRef,
  SeatUsage,
  InvitationResponse,
  InviteCreateRequest,
} from "@portalai/core/contracts";

import { sdk } from "../api/sdk";
import { queryKeys } from "../api/keys";
import { useCapabilities } from "../utils/use-capabilities.util";
import { useCustomRbacEntitled } from "../utils/use-custom-rbac-entitled.util";
import { useToast } from "../utils/toast.context";
import { toServerError } from "../utils/api.util";
import { MemberListUI, type GroupOption } from "./MemberList.component";
import { RemoveMemberDialog } from "./RemoveMemberDialog.component";
import { InviteMemberDialog } from "./InviteMemberDialog.component";
import { PendingInvitationListUI } from "./PendingInvitationList.component";

// ── UI (pure) ──────────────────────────────────────────────────────────

export interface MembersTabUIProps {
  members: Member[];
  seatUsage: SeatUsage;
  invitations: InvitationResponse[];
  /** Whether the caller may assign roles (`can("member.role.assign")`). */
  canManageRoles: boolean;
  callerUserId: string;
  /** #622: the roles assignable here (system + custom) — the multiselect's
   *  options, keyed by slug. */
  assignableRoles: RoleRef[];
  onSetRoles: (userId: string, roleSlugs: string[]) => void;
  /** #622: the org's custom groups + whether the member-centric group column
   *  shows (entitled + capable) + its set-the-set handler. */
  groups?: GroupOption[];
  canManageGroups?: boolean;
  onSetGroups?: (userId: string, groupIds: string[]) => void;
  onRemoveClick: (member: Member) => void;
  onInviteClick: () => void;
  onResend: (invitation: InvitationResponse) => void;
  onRevoke: (invitation: InvitationResponse) => void;
  /** false when the seat cap is reached — the invite button is disabled. */
  canInvite: boolean;
  /** Tooltip shown on the disabled invite button. */
  inviteDisabledReason?: string;
  /** The one-time invite link from the latest invite/resend; null when none. */
  lastInviteUrl: string | null;
  onCopyLink: (url: string) => void;
  onDismissLink: () => void;
  isLoading?: boolean;
  error?: Error | null;
  mutating?: boolean;
  invitesMutating?: boolean;
}

/** Human seat-usage label: "N / M seats" when a cap is set, else "N members". */
const seatUsageLabel = ({ used, max }: SeatUsage): string =>
  max === null
    ? `${used} member${used === 1 ? "" : "s"}`
    : `${used} / ${max} seats used`;

export const MembersTabUI: React.FC<MembersTabUIProps> = ({
  members,
  seatUsage,
  invitations,
  canManageRoles,
  callerUserId,
  assignableRoles,
  onSetRoles,
  groups = [],
  canManageGroups = false,
  onSetGroups,
  onRemoveClick,
  onInviteClick,
  onResend,
  onRevoke,
  canInvite,
  inviteDisabledReason,
  lastInviteUrl,
  onCopyLink,
  onDismissLink,
  isLoading = false,
  error = null,
  mutating = false,
  invitesMutating = false,
}) => (
  <Stack spacing={2}>
    <Stack
      direction="row"
      justifyContent="space-between"
      alignItems="center"
      spacing={2}
    >
      <Typography variant="body2" color="text.secondary">
        {seatUsageLabel(seatUsage)}
      </Typography>
      <Tooltip title={canInvite ? "" : (inviteDisabledReason ?? "")}>
        <span>
          <Button
            variant="contained"
            onClick={onInviteClick}
            disabled={!canInvite}
          >
            Invite member
          </Button>
        </span>
      </Tooltip>
    </Stack>

    {lastInviteUrl && (
      <Alert severity="success" onClose={onDismissLink}>
        <Stack spacing={1}>
          <Typography variant="body2">
            Invitation link — copy and share it now. This link is shown only
            once.
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              value={lastInviteUrl}
              size="small"
              fullWidth
              slotProps={{
                htmlInput: { readOnly: true, "aria-label": "Invite link" },
              }}
            />
            <Button
              variant="outlined"
              onClick={() => onCopyLink(lastInviteUrl)}
            >
              Copy
            </Button>
          </Stack>
        </Stack>
      </Alert>
    )}

    {error ? (
      <StatusMessage variant="error" error={error} />
    ) : isLoading ? (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress aria-label="Loading members" />
      </Box>
    ) : (
      <MemberListUI
        members={members}
        canManageRoles={canManageRoles}
        callerUserId={callerUserId}
        assignableRoles={assignableRoles}
        onSetRoles={onSetRoles}
        groups={groups}
        canManageGroups={canManageGroups}
        onSetGroups={onSetGroups}
        onRemove={onRemoveClick}
        isPending={mutating}
      />
    )}

    <Divider />
    <Typography variant="subtitle2">Pending invitations</Typography>
    <PendingInvitationListUI
      invitations={invitations}
      onResend={onResend}
      onRevoke={onRevoke}
      isPending={invitesMutating}
    />
  </Stack>
);

// ── Container ──────────────────────────────────────────────────────────

/**
 * The owner/admin-only Members/Team tab (#585) — mounted lazily behind Settings
 * › Members, so its queries fire only while active. The server enforces the
 * gate (403) + all mutations; this shapes affordances and surfaces outcomes as
 * toasts. Members can be re-roled (owner-only) / removed; new members are
 * invited by a one-time link (no email is sent), and pending invites can be
 * resent (fresh link) or revoked.
 */
export const MembersTab: React.FC = () => {
  const { can } = useCapabilities();
  // #622: member-centric group assignment shows only for an entitled org whose
  // caller can manage roles (the same owner/admin capability gates both). Both
  // hooks are called unconditionally (Rules of Hooks) before combining.
  const rbacEntitled = useCustomRbacEntitled();
  const canManageGroups = can("member.role.assign") && rbacEntitled;
  const profileQuery = sdk.auth.profile();
  const membersQuery = sdk.members.list();
  const invitationsQuery = sdk.invitations.list();
  const groupsQuery = sdk.groups.list({ enabled: canManageGroups });
  const setRoles = sdk.members.setRoles();
  const setGroups = sdk.members.setGroups();
  const remove = sdk.members.remove();
  const inviteCreate = sdk.invitations.create();
  const invitationResend = sdk.invitations.resend();
  const invitationRevoke = sdk.invitations.revoke();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);

  const members = membersQuery.data?.members ?? [];
  const seatUsage: SeatUsage = membersQuery.data?.seatUsage ?? {
    used: 0,
    max: null,
  };
  const invitations = (invitationsQuery.data?.invitations ?? []).filter(
    (i) => i.status === "pending"
  );
  const groups: GroupOption[] = (groupsQuery.data?.groups ?? []).map((g) => ({
    id: g.id,
    name: g.name,
  }));
  const assignableRoles = membersQuery.data?.assignableRoles ?? [];
  const capReached = seatUsage.max !== null && seatUsage.used >= seatUsage.max;
  const inviteDisabledReason = capReached
    ? `Seat limit reached (${seatUsage.used} / ${seatUsage.max}). Remove a member or upgrade to invite more.`
    : undefined;

  // Identify the caller among the members (by verified email) so the UI can
  // disable removing yourself. Falls back to "" (no self-match) if unknown.
  const callerEmail = profileQuery.data?.profile.email ?? null;
  const callerUserId =
    (callerEmail &&
      members.find((m) => m.email && m.email === callerEmail)?.userId) ||
    "";

  const invalidateMembers = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.members.root });
  const invalidateInvitations = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.invitations.root });

  const handleSetRoles = (userId: string, roleSlugs: string[]) => {
    setRoles.mutate(
      { userId, roleSlugs },
      {
        onSuccess: () => {
          invalidateMembers();
          // A caller changing their own roles changes their capabilities.
          queryClient.invalidateQueries({
            queryKey: queryKeys.organizations.root,
          });
          toast.success("Roles updated");
        },
        onError: (error) =>
          toast.error(toServerError(error)?.message ?? "Failed to set roles"),
      }
    );
  };

  const handleSetGroups = (userId: string, groupIds: string[]) => {
    setGroups.mutate(
      { userId, groupIds },
      {
        onSuccess: () => {
          invalidateMembers();
          // A member's group set changes their effective access; refresh the
          // groups list too so memberCount stays accurate.
          queryClient.invalidateQueries({ queryKey: queryKeys.groups.root });
          toast.success("Groups updated");
        },
        onError: (error) =>
          toast.error(toServerError(error)?.message ?? "Failed to set groups"),
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
          // A freed seat can change pending-invite affordances.
          invalidateInvitations();
          toast.success("Member removed");
          setRemoveTarget(null);
        },
        // Stay open on error so the server message (e.g. last-owner) shows in
        // the dialog's FormAlert.
      }
    );
  };

  const handleInvite = (req: InviteCreateRequest) => {
    inviteCreate.mutate(req, {
      onSuccess: (invitation) => {
        invalidateInvitations();
        invalidateMembers();
        setLastInviteUrl(invitation.inviteUrl ?? null);
        setInviteOpen(false);
        toast.success("Invitation created");
      },
      // Stay open on error so the server message (cap reached, already a member)
      // shows in the dialog's FormAlert.
    });
  };

  const handleResend = (invitation: InvitationResponse) => {
    invitationResend.mutate(
      { id: invitation.id },
      {
        onSuccess: (updated) => {
          invalidateInvitations();
          setLastInviteUrl(updated.inviteUrl ?? null);
          toast.success("New invite link generated");
        },
        onError: (error) =>
          toast.error(toServerError(error)?.message ?? "Failed to resend"),
      }
    );
  };

  const handleRevoke = (invitation: InvitationResponse) => {
    invitationRevoke.mutate(
      { id: invitation.id },
      {
        onSuccess: () => {
          invalidateInvitations();
          invalidateMembers();
          toast.success("Invitation revoked");
        },
        onError: (error) =>
          toast.error(toServerError(error)?.message ?? "Failed to revoke"),
      }
    );
  };

  const handleCopyLink = (url: string) => {
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied"),
      () => toast.error("Couldn't copy — select the link and copy it manually")
    );
  };

  return (
    <>
      <MembersTabUI
        members={members}
        seatUsage={seatUsage}
        invitations={invitations}
        canManageRoles={can("member.role.assign")}
        callerUserId={callerUserId}
        assignableRoles={assignableRoles}
        onSetRoles={handleSetRoles}
        groups={groups}
        canManageGroups={canManageGroups}
        onSetGroups={handleSetGroups}
        onRemoveClick={setRemoveTarget}
        onInviteClick={() => setInviteOpen(true)}
        onResend={handleResend}
        onRevoke={handleRevoke}
        canInvite={!capReached}
        inviteDisabledReason={inviteDisabledReason}
        lastInviteUrl={lastInviteUrl}
        onCopyLink={handleCopyLink}
        onDismissLink={() => setLastInviteUrl(null)}
        isLoading={membersQuery.isLoading}
        error={membersQuery.error}
        mutating={setRoles.isPending || setGroups.isPending || remove.isPending}
        invitesMutating={
          invitationResend.isPending || invitationRevoke.isPending
        }
      />
      <RemoveMemberDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        member={removeTarget}
        onConfirm={handleRemoveConfirm}
        isPending={remove.isPending}
        serverError={toServerError(remove.error)}
      />
      <InviteMemberDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSubmit={handleInvite}
        isPending={inviteCreate.isPending}
        serverError={toServerError(inviteCreate.error)}
      />
    </>
  );
};
