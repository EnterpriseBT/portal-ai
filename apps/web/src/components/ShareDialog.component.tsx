import React, { useState } from "react";

import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { useQueryClient } from "@tanstack/react-query";

import {
  Button,
  Modal,
  Stack,
  Typography,
  Icon,
  IconName,
} from "@portalai/core/ui";
import type {
  GrantView,
  GrantAccess,
  ShareGrantee,
} from "@portalai/core/contracts";

import { sdk } from "../api/sdk";
import { queryKeys } from "../api/keys";
import { useToast } from "../utils/toast.context";
import { FormAlert } from "./FormAlert.component";
import { toServerError, type ServerError } from "../utils/api.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";

const TEAM_VALUE = "__team__";

// ── UI (pure) ────────────────────────────────────────────────────────────

export interface ShareDialogUIProps {
  open: boolean;
  onClose: () => void;
  /** Human name of the object being shared (dialog title context). */
  resourceLabel: string;
  /** Selectable member grantees — `{ value: userId, label: email/name }`. */
  memberOptions: { value: string; label: string }[];
  /** Current shares (grouped per principal). */
  grants: GrantView[];
  grantsLoading?: boolean;
  onShare: (grantee: ShareGrantee, access: GrantAccess) => void;
  onRevoke: (id: string) => void;
  isPending?: boolean;
  serverError: ServerError | null;
}

export const ShareDialogUI: React.FC<ShareDialogUIProps> = ({
  open,
  onClose,
  resourceLabel,
  memberOptions,
  grants,
  grantsLoading = false,
  onShare,
  onRevoke,
  isPending = false,
  serverError,
}) => {
  const [grantee, setGrantee] = useState<string>(TEAM_VALUE);
  const [access, setAccess] = useState<GrantAccess>("read");
  const granteeRef = useDialogAutoFocus(open);

  React.useEffect(() => {
    if (open) {
      setGrantee(TEAM_VALUE);
      setAccess("read");
    }
  }, [open]);

  const handleShare = () => {
    const g: ShareGrantee =
      grantee === TEAM_VALUE
        ? { type: "team" }
        : { type: "user", userId: grantee };
    onShare(g, access);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Share “${resourceLabel}”`}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          component: "form",
          onSubmit: (e: React.FormEvent) => {
            e.preventDefault();
            handleShare();
          },
        } as object,
      }}
      actions={
        <Stack direction="row" spacing={1}>
          <Button
            type="button"
            variant="outlined"
            onClick={onClose}
            disabled={isPending}
          >
            Done
          </Button>
          <Button
            type="button"
            variant="contained"
            onClick={handleShare}
            disabled={isPending}
          >
            {isPending ? "Sharing..." : "Share"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <Stack direction="row" spacing={1.5}>
          <TextField
            select
            inputRef={granteeRef}
            label="Share with"
            value={grantee}
            onChange={(e) => setGrantee(e.target.value)}
            fullWidth
            slotProps={{ htmlInput: { "aria-label": "Share with" } }}
          >
            <MenuItem value={TEAM_VALUE}>The team</MenuItem>
            {memberOptions.map((m) => (
              <MenuItem key={m.value} value={m.value}>
                {m.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Access"
            value={access}
            onChange={(e) => setAccess(e.target.value as GrantAccess)}
            sx={{ minWidth: 160 }}
            slotProps={{ htmlInput: { "aria-label": "Access" } }}
          >
            <MenuItem value="read">Read</MenuItem>
            <MenuItem value="read-write">Read &amp; write</MenuItem>
          </TextField>
        </Stack>

        <FormAlert serverError={serverError} />

        <Stack spacing={1}>
          <Typography variant="subtitle2">Shared with</Typography>
          {grantsLoading ? (
            <Typography variant="body2" color="text.secondary">
              Loading…
            </Typography>
          ) : grants.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Not shared with anyone yet.
            </Typography>
          ) : (
            grants.map((g) => (
              <Stack
                key={g.id}
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                spacing={1}
              >
                <Typography variant="body2">{g.principalLabel}</Typography>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Chip size="small" label={g.access} />
                  <Tooltip title="Revoke">
                    <span>
                      <IconButton
                        size="small"
                        color="error"
                        disabled={isPending}
                        onClick={() => onRevoke(g.id)}
                        aria-label={`Revoke share for ${g.principalLabel}`}
                      >
                        <Icon name={IconName.Delete} fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>
              </Stack>
            ))
          )}
        </Stack>
      </Stack>
    </Modal>
  );
};

// ── Container ────────────────────────────────────────────────────────────

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  resourceType: "station" | "pin";
  resourceId: string;
  resourceLabel: string;
}

/**
 * Object-sharing dialog (#621) — wires `sdk.grants` + the member picker and
 * delegates rendering to {@link ShareDialogUI}. Share failures surface in the
 * dialog's `FormAlert` (it stays open to retry); a success toasts and
 * invalidates the object's grant list + the object's own query (so `canShare`
 * / visibility refresh).
 */
export const ShareDialog: React.FC<ShareDialogProps> = ({
  open,
  onClose,
  resourceType,
  resourceId,
  resourceLabel,
}) => {
  const membersQuery = sdk.members.list({ enabled: open });
  const grantsQuery = sdk.grants.list(resourceType, resourceId, {
    enabled: open,
  });
  const share = sdk.grants.share();
  const revoke = sdk.grants.revoke();
  const toast = useToast();
  const queryClient = useQueryClient();

  const memberOptions = (membersQuery.data?.members ?? []).map((m) => ({
    value: m.userId,
    label: m.email ?? m.name ?? m.userId,
  }));

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.grants.list(resourceType, resourceId),
    });
    queryClient.invalidateQueries({
      queryKey:
        resourceType === "station"
          ? queryKeys.stations.root
          : queryKeys.portalResults.root,
    });
  };

  const handleShare = (grantee: ShareGrantee, access: GrantAccess) => {
    share.mutate(
      { resourceType, resourceId, grantee, access },
      {
        onSuccess: () => {
          invalidate();
          toast.success("Shared");
        },
      }
    );
  };

  const handleRevoke = (id: string) => {
    revoke.mutate(
      { id },
      {
        onSuccess: () => {
          invalidate();
          toast.success("Share revoked");
        },
        onError: (error) =>
          toast.error(toServerError(error)?.message ?? "Failed to revoke"),
      }
    );
  };

  return (
    <ShareDialogUI
      open={open}
      onClose={onClose}
      resourceLabel={resourceLabel}
      memberOptions={memberOptions}
      grants={grantsQuery.data?.grants ?? []}
      grantsLoading={grantsQuery.isLoading}
      onShare={handleShare}
      onRevoke={handleRevoke}
      isPending={share.isPending || revoke.isPending}
      serverError={toServerError(share.error)}
    />
  );
};
