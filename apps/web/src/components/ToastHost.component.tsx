import React from "react";
import { createPortal } from "react-dom";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";

import { getNotificationsRoot } from "../utils/notifications-root.util";
import { TOAST_ANCHOR } from "../utils/toast.constants";

import type { Toast } from "../utils/toast.context";

export interface ToastHostProps {
  /** Already sliced to `TOAST_MAX_VISIBLE` by the provider. */
  toasts: Toast[];
  /** Queued but not visible — renders the "+N more" row when > 0. */
  hiddenCount: number;
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
}

/**
 * The toast surface (#293) — pure UI over the provider's queue. No state, no
 * timers: the provider owns both and hands down an already-sliced visible set.
 *
 * One fixed-position region holding a `Stack` of `Alert`s, anchored by
 * `TOAST_ANCHOR`: errors and warnings in an assertive live region, success
 * and info in a polite one (#797), portalled into the page's Notifications
 * region (`getNotificationsRoot`), which the skip links target while a toast
 * is shown.
 */
export const ToastHost: React.FC<ToastHostProps> = ({
  toasts,
  hiddenCount,
  onDismiss,
  onDismissAll,
}) => {
  // The live regions are always in the page (#797): a screen reader only
  // announces what's added to a region that already exists. They're portalled
  // into the Notifications region on <body>, so a test's render container stays empty when idle and the
  // shared harness's snapshots are untouched. They carry aria-live, not
  // role="alert"/"status": an always-present alert role would answer every
  // `queryByRole("alert")` in the app, and each toast's own Alert role is
  // dropped so it's announced once, by its region.
  const urgent = toasts.filter(
    (t) => t.severity === "error" || t.severity === "warning"
  );
  const routine = toasts.filter(
    (t) => t.severity === "success" || t.severity === "info"
  );
  const renderToast = (t: Toast) => (
    <Alert
      key={t.id}
      role="none"
      severity={t.severity}
      variant="filled"
      data-testid={`toast-${t.severity}`}
      onClose={() => onDismiss(t.id)}
      // MUI renders its own close button from `onClose` ONLY when
      // `action` is unset, so the action path must supply both.
      action={
        t.action ? (
          <>
            <Button
              color="inherit"
              size="small"
              type="button"
              onClick={t.action.onClick}
            >
              {t.action.label}
            </Button>
            <IconButton
              color="inherit"
              size="small"
              aria-label="Close"
              onClick={() => onDismiss(t.id)}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </>
        ) : undefined
      }
    >
      {t.message}
    </Alert>
  );

  return createPortal(
    <Box
      // Dismissal is explicit: per-toast close, or Dismiss all. Nothing
      // here closes on a click elsewhere.
      data-testid={toasts.length > 0 ? "toast-host" : undefined}
      sx={(theme) => ({
        position: "fixed",
        zIndex: theme.zIndex.snackbar,
        [TOAST_ANCHOR.vertical]: theme.spacing(3),
        [TOAST_ANCHOR.horizontal]: theme.spacing(3),
        maxWidth: 480,
      })}
    >
      <Stack spacing={1}>
        <Stack spacing={1} aria-live="assertive">
          {urgent.map(renderToast)}
        </Stack>
        <Stack spacing={1} aria-live="polite">
          {routine.map(renderToast)}
        </Stack>
        {hiddenCount > 0 ? (
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", justifyContent: "flex-end" }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              data-testid="toast-overflow-count"
            >
              +{hiddenCount} more
            </Typography>
            <Button
              size="small"
              type="button"
              onClick={onDismissAll}
              data-testid="toast-dismiss-all"
            >
              Dismiss all
            </Button>
          </Stack>
        ) : null}
      </Stack>
    </Box>,
    getNotificationsRoot()
  );
};
