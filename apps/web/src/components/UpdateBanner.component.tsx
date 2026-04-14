import React from "react";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Snackbar from "@mui/material/Snackbar";

import { useAppVersion } from "../utils/app-version.util";

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
  <Snackbar open={open} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
    <Alert
      severity="info"
      variant="filled"
      action={
        <>
          <Button color="inherit" size="small" onClick={onDismiss} type="button">
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
  const { updateAvailable, dismiss } = useAppVersion();

  const handleReload = () => window.location.reload();

  return (
    <UpdateBannerUI
      open={updateAvailable}
      onReload={handleReload}
      onDismiss={dismiss}
    />
  );
};
