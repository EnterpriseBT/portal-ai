import React from "react";

import {
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from "@portalai/core/ui";
import Alert from "@mui/material/Alert";
import GoogleIcon from "@mui/icons-material/Google";

export type AuthorizeStepState =
  | "idle"
  | "connecting"
  | "authorized"
  | "error";

export interface AuthorizeStepUIProps {
  state: AuthorizeStepState;
  /** Email or workspace identity from the OAuth callback. */
  accountIdentity?: string | null;
  /** Error message (popup closed, OAuth failed, etc.) — only when state === "error". */
  error?: string;
  /** Triggers the OAuth popup. Must be invoked synchronously from a click. */
  onConnect: () => void;
}

export const AuthorizeStep: React.FC<AuthorizeStepUIProps> = ({
  state,
  accountIdentity,
  error,
  onConnect,
}) => {
  const isConnecting = state === "connecting";
  const isAuthorized = state === "authorized";
  const isError = state === "error";

  return (
    <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
      <Typography variant="body1">
        Authorize Portal.ai to read your Google Drive and Sheets. We only ever
        request read access — no writes, no deletions.
      </Typography>

      {isError && error && (
        <Alert severity="error" sx={{ width: "100%" }}>
          {error}
        </Alert>
      )}

      {isAuthorized && (
        <Box role="status" sx={{ width: "100%" }}>
          <Alert severity="success">
            {accountIdentity
              ? `Connected as ${accountIdentity}`
              : "Connected"}
          </Alert>
        </Box>
      )}

      <Button
        variant="contained"
        startIcon={
          isConnecting ? (
            <CircularProgress size={16} color="inherit" />
          ) : (
            <GoogleIcon />
          )
        }
        onClick={onConnect}
        disabled={isConnecting || isAuthorized}
      >
        {isError ? "Retry" : "Connect Google Sheets"}
      </Button>
    </Stack>
  );
};
