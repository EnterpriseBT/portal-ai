import React from "react";

import {
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from "@portalai/core/ui";
import Alert from "@mui/material/Alert";

/**
 * Slug-agnostic OAuth authorize step.
 *
 * Shared by every OAuth-driven connector (`google-sheets`,
 * `microsoft-excel`, …). Connector-specific copy + icon come in via
 * props; the state-machine surface (`idle | connecting | authorized |
 * error`) is identical across providers.
 */

export type OAuthAuthorizeStepState =
  | "idle"
  | "connecting"
  | "authorized"
  | "error";

export interface OAuthAuthorizeStepUIProps {
  state: OAuthAuthorizeStepState;
  /** Email / UPN / workspace identity from the OAuth callback. */
  accountIdentity?: string | null;
  /** Error message — only consulted when state === "error". */
  error?: string;
  /** Triggers the OAuth popup. Must be invoked synchronously from a click. */
  onConnect: () => void;
  /** Provider display label, e.g. `"Google Sheets"` or `"Microsoft 365"`. */
  providerLabel: string;
  /** Provider icon, e.g. `<GoogleIcon />` or `<MicrosoftIcon />`. */
  providerIcon: React.ReactNode;
  /** Body copy explaining what the user is granting. */
  scopesDescription: string;
}

export const OAuthAuthorizeStep: React.FC<OAuthAuthorizeStepUIProps> = ({
  state,
  accountIdentity,
  error,
  onConnect,
  providerLabel,
  providerIcon,
  scopesDescription,
}) => {
  const isConnecting = state === "connecting";
  const isAuthorized = state === "authorized";
  const isError = state === "error";

  return (
    <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
      <Typography variant="body1">{scopesDescription}</Typography>

      {isError && error && (
        <Alert severity="error" sx={{ width: "100%" }}>
          {error}
        </Alert>
      )}

      {isAuthorized && (
        <Box role="status" sx={{ width: "100%" }}>
          <Alert severity="success">
            {accountIdentity ? `Connected as ${accountIdentity}` : "Connected"}
          </Alert>
        </Box>
      )}

      <Button
        variant="contained"
        startIcon={
          isConnecting ? (
            <CircularProgress size={16} color="inherit" />
          ) : (
            providerIcon
          )
        }
        onClick={onConnect}
        disabled={isConnecting || isAuthorized}
      >
        {isError ? "Retry" : `Connect ${providerLabel}`}
      </Button>
    </Stack>
  );
};
