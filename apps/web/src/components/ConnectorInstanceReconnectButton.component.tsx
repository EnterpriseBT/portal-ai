import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import LinkOffIcon from "@mui/icons-material/LinkOff";

import { Stack, Typography } from "@portalai/core/ui";

export interface ConnectorInstanceReconnectButtonUIProps {
  /**
   * Current connector-instance status. The reconnect affordance is
   * gated to `"error"` — any other status renders nothing so the
   * caller can drop this component into a layout slot
   * unconditionally.
   */
  status: string;
  /** Reconnect popup in flight (`onReconnect` returned a promise that's still pending). */
  isReconnecting: boolean;
  /** Error message rendered when the reconnect attempt fails. */
  errorMessage: string | null;
  /** Click handler — opens the OAuth popup. */
  onReconnect: () => void;
  /** Closes the error alert. */
  onDismissError: () => void;
  /**
   * Visual variant. `"contained"` is the high-emphasis style used when
   * Reconnect is the page's primary action (status === "error" should
   * always pair with `"contained"` in practice); `"outlined"` for
   * inline placements like the sync-failure alert.
   */
  variant?: "contained" | "outlined";
}

/**
 * Pure UI for the connector-instance Reconnect affordance.
 *
 * Renders a button (and an optional error alert) when the connector
 * instance is in `error` state — typically because Google rejected the
 * stored refresh token (`invalid_grant`, manual permission removal,
 * password rotation). Click opens the OAuth popup so the user can
 * re-grant; the upstream hook handles the postMessage handshake and
 * cache invalidation. Returns `null` for any non-error status so the
 * caller doesn't have to branch.
 *
 * State is owned upstream via `useReconnectConnectorInstance` so this
 * component can be placed in different layout slots (page header
 * primary action, inline in the sync-failure alert) and stay in sync.
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-E.plan.md` §Slice 2.
 */
export const ConnectorInstanceReconnectButtonUI = ({
  status,
  isReconnecting,
  errorMessage,
  onReconnect,
  onDismissError,
  variant = "contained",
}: ConnectorInstanceReconnectButtonUIProps) => {
  if (status !== "error") return null;

  return (
    <Stack spacing={1}>
      <span>
        <Button
          variant={variant}
          startIcon={<LinkOffIcon />}
          onClick={onReconnect}
          disabled={isReconnecting}
        >
          {isReconnecting ? "Reconnecting…" : "Reconnect"}
        </Button>
      </span>

      {errorMessage ? (
        <Alert severity="error" onClose={onDismissError} variant="outlined">
          <Typography variant="body2">{errorMessage}</Typography>
        </Alert>
      ) : null}
    </Stack>
  );
};
