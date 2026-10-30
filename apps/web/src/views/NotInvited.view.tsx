import React from "react";

import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import {
  Box,
  Button,
  Icon,
  IconName,
  Paper,
  Stack,
  Typography,
} from "@portalai/core/ui";

import { sdk } from "../api/sdk";
import { queryKeys } from "../api/keys";

// ── UI (pure) ──────────────────────────────────────────────────────────

export interface NotInvitedViewUIProps {
  onTryAgain: () => void;
  onSignOut: () => void;
}

/**
 * #916: what a caller refused with `SSO_PROVISIONING_NOT_INVITED` sees. Their
 * organization signs them in through an invite-gated enterprise connection,
 * and they have no invitation yet. Names no role: whoever can invite them
 * depends on their org's policies (#711).
 */
export const NotInvitedViewUI: React.FC<NotInvitedViewUIProps> = ({
  onTryAgain,
  onSignOut,
}) => (
  <Box
    sx={{
      minHeight: "60vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <Paper elevation={3} sx={{ p: 4, maxWidth: 480, width: "100%" }}>
      <Stack spacing={2} alignItems="center" textAlign="center">
        <Icon name={IconName.Lock} color="info" sx={{ fontSize: 48 }} />
        <Typography variant="h5" component="h1">
          You need an invitation
        </Typography>
        <Typography color="text.secondary">
          Your organization signs you in with its own identity provider, so you
          need an invitation before you can use Portals AI. Ask someone in your
          organization to invite this email address, then try again.
        </Typography>
        <Button variant="contained" onClick={onTryAgain}>
          Try again
        </Button>
        <Button variant="text" onClick={onSignOut}>
          Sign out
        </Button>
      </Stack>
    </Paper>
  </Box>
);

// ── Container ──────────────────────────────────────────────────────────

/**
 * Try again goes home: the next API call re-runs provisioning, which accepts
 * an invitation that has arrived since (#916). Still uninvited, the refusal
 * lands the caller back here.
 */
export const NotInvitedView: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { logout } = sdk.auth.logout();

  const handleTryAgain = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.organizations.root });
    navigate({ to: "/" });
  };

  return <NotInvitedViewUI onTryAgain={handleTryAgain} onSignOut={logout} />;
};
