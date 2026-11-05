import React from "react";
import { createPortal } from "react-dom";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Snackbar from "@mui/material/Snackbar";

import { getNotificationsRoot } from "../utils/notifications-root.util";
import { useUpdateNotice } from "../utils/update-notice.context";

/**
 * NOT a toast, deliberately (#293). This reports a *polled condition* — a new
 * bundle exists — rather than the outcome of an action the user took, and it
 * must persist until acted on. It also stays anchored bottom-CENTER, clear of
 * the toast host's bottom-right, so the two never contend for the same space.
 *
 * A recorded exception, not a precedent: any new "an action finished" feedback
 * uses `useToast()`. See CLAUDE.md → "Toast Pattern (apps/web)".
 */

// ── Pure UI ──────────────────────────────────────────────────────────

export interface UpdateBannerUIProps {
  open: boolean;
  onReload: () => void;
  onDismiss: () => void;
}

export const UpdateBannerUI: React.FC<UpdateBannerUIProps> = ({
  open,
  onReload,
  onDismiss,
}) => (
  <Snackbar
    open={open}
    anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
  >
    <Alert
      // A polled condition, not an emergency: announced politely (#797).
      role="status"
      severity="info"
      variant="filled"
      action={
        <>
          <Button
            color="inherit"
            size="small"
            onClick={onDismiss}
            type="button"
          >
            Dismiss
          </Button>
          <Button color="inherit" size="small" onClick={onReload} type="button">
            Reload
          </Button>
        </>
      }
    >
      A new version is available.
    </Alert>
  </Snackbar>
);

// ── Container ────────────────────────────────────────────────────────

export const UpdateBanner: React.FC = () => {
  const { open, dismiss } = useUpdateNotice();

  const handleReload = () => window.location.reload();

  const banner = (
    <UpdateBannerUI open={open} onReload={handleReload} onDismiss={dismiss} />
  );
  // In the Notifications region (#797), so "Skip to notifications" reaches it.
  return createPortal(banner, getNotificationsRoot());
};
