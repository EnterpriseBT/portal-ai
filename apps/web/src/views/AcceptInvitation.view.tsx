import React, { useEffect, useState } from "react";

import { CircularProgress } from "@mui/material";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import type { AcceptInvitationResponse } from "@portalai/core/contracts";

import {
  Box,
  Paper,
  Stack,
  Typography,
  Button,
  Icon,
  IconName,
} from "@portalai/core/ui";

import { sdk } from "../api/sdk";
import { queryKeys } from "../api/keys";
import { useToast } from "../utils/toast.context";
import { toServerError } from "../utils/api.util";

// ── UI (pure) ──────────────────────────────────────────────────────────

export type AcceptInvitationStatus =
  | "pending"
  | "success"
  | "expired"
  | "invalid"
  | "missingToken"
  | "error";

export interface AcceptInvitationViewUIProps {
  status: AcceptInvitationStatus;
  /** The joined org's name, shown on success. */
  orgName?: string | null;
  /** The server message, shown on a generic error. */
  errorMessage?: string | null;
  onGoHome: () => void;
}

interface StateCopy {
  icon: IconName;
  color: "success" | "warning" | "error" | "info";
  title: string;
  body: string;
}

const COPY: Record<Exclude<AcceptInvitationStatus, "pending">, StateCopy> = {
  success: {
    icon: IconName.CheckCircle,
    color: "success",
    title: "Invitation accepted",
    body: "You're now a member of the organization.",
  },
  expired: {
    icon: IconName.Warning,
    color: "warning",
    title: "This invitation has expired",
    body: "Ask an admin of the organization to send you a fresh invite link.",
  },
  invalid: {
    icon: IconName.Error,
    color: "error",
    title: "This invitation link is no longer valid",
    body: "It may have already been used or been revoked. Ask an admin to resend it.",
  },
  missingToken: {
    icon: IconName.Error,
    color: "error",
    title: "This invitation link is incomplete",
    body: "The link is missing its token. Use the full link from your invitation.",
  },
  error: {
    icon: IconName.Error,
    color: "error",
    title: "Couldn't accept this invitation",
    body: "Something went wrong. Please try again, or ask an admin to resend it.",
  },
};

/**
 * Pure accept-invitation view (#585). Renders the outcome of the accept-on-mount
 * mutation the container runs; `pending` is a spinner, every other state is a
 * titled card with a "Go to dashboard" affordance. On success the container
 * also navigates home + toasts, so this state is transitional.
 */
export const AcceptInvitationViewUI: React.FC<AcceptInvitationViewUIProps> = ({
  status,
  orgName,
  errorMessage,
  onGoHome,
}) => {
  const center = {
    minHeight: "60vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } as const;

  if (status === "pending") {
    return (
      <Box sx={center}>
        <Stack spacing={2} alignItems="center">
          <CircularProgress aria-label="Accepting invitation" />
          <Typography color="text.secondary">
            Accepting your invitation…
          </Typography>
        </Stack>
      </Box>
    );
  }

  const copy = COPY[status];
  const body =
    status === "success" && orgName
      ? `You're now a member of ${orgName}.`
      : status === "error" && errorMessage
        ? errorMessage
        : copy.body;

  return (
    <Box sx={center}>
      <Paper elevation={3} sx={{ p: 4, maxWidth: 480, width: "100%" }}>
        <Stack spacing={2} alignItems="center" textAlign="center">
          <Icon name={copy.icon} color={copy.color} sx={{ fontSize: 48 }} />
          <Typography variant="h5" component="h1">
            {copy.title}
          </Typography>
          <Typography color="text.secondary">{body}</Typography>
          <Button variant="contained" onClick={onGoHome}>
            Go to dashboard
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
};

// ── Container ──────────────────────────────────────────────────────────

const statusFromError = (code?: string): AcceptInvitationStatus =>
  code === "INVITATION_EXPIRED"
    ? "expired"
    : code === "INVITATION_NOT_FOUND"
      ? "invalid"
      : "error";

/**
 * In-flight accept POSTs keyed by token, module-scoped so they survive a
 * component unmount/remount. This is what makes accept-on-mount both
 * **single-fire** and **StrictMode-safe**: React's dev double-mount (and any
 * real remount) reuses the same promise instead of firing a second POST — which
 * would 404 against an already-consumed token and strand the result on the
 * discarded observer. Cleared once the promise settles.
 */
const acceptInFlight = new Map<string, Promise<AcceptInvitationResponse>>();

export interface AcceptInvitationViewProps {
  token?: string;
}

interface AcceptOutcome {
  status: AcceptInvitationStatus;
  orgName?: string;
  errorMessage?: string;
}

/**
 * Accept-invitation landing (#585) — the invitee arrives at
 * `/invitations/accept?token=…` (after login, thanks to the `returnTo` wiring).
 * Accepts once on mount; on success invalidates `organizations.root` (the new
 * membership changes the org switcher), toasts, and navigates home. The outcome
 * is held in local state (not the mutation observer) so it survives the
 * unmount/remount that would otherwise leave a stranded observer stuck on the
 * spinner.
 */
export const AcceptInvitationView: React.FC<AcceptInvitationViewProps> = ({
  token,
}) => {
  const { mutateAsync: acceptAsync } = sdk.invitations.accept();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [outcome, setOutcome] = useState<AcceptOutcome | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;

    let pending = acceptInFlight.get(token);
    if (!pending) {
      pending = acceptAsync({ token });
      acceptInFlight.set(token, pending);
      // Free the slot once settled; the consumer below owns error handling, so
      // swallow here to avoid an unhandled rejection on the cleanup chain.
      void pending.finally(() => acceptInFlight.delete(token)).catch(() => {});
    }

    pending.then(
      (data) => {
        if (!active) return;
        queryClient.invalidateQueries({
          queryKey: queryKeys.organizations.root,
        });
        toast.success(`You've joined ${data.organization.name}`);
        setOutcome({ status: "success", orgName: data.organization.name });
        navigate({ to: "/" });
      },
      (error) => {
        if (!active) return;
        const server = toServerError(error);
        setOutcome({
          status: statusFromError(server?.code),
          errorMessage: server?.message ?? undefined,
        });
      }
    );

    return () => {
      active = false;
    };
    // Re-run only if the token changes; the module-level map dedupes the POST.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const status: AcceptInvitationStatus = !token
    ? "missingToken"
    : (outcome?.status ?? "pending");

  return (
    <AcceptInvitationViewUI
      status={status}
      orgName={outcome?.orgName}
      errorMessage={outcome?.errorMessage}
      onGoHome={() => navigate({ to: "/" })}
    />
  );
};
