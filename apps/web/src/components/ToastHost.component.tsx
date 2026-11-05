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
  // One polite live region holds the stack, in the queue's order (#797).
  // It's always in the page, since a screen reader only announces what's
  // added to a region that already exists, and it uses aria-live rather than
  // role="status". Success and info are announced by that region (role
  // "none" on their Alert). Errors and warnings keep MUI's role="alert",
  // which is announced assertively when it's inserted. No alert role is
  // ever present while nothing has gone wrong, so the app's
  // `queryByRole("alert")` checks are unaffected.
  const isUrgent = (t: Toast) =>
    t.severity === "error" || t.severity === "warning";
  const renderToast = (t: Toast) => (
    <Alert
      key={t.id}
      role={isUrgent(t) ? "alert" : "none"}
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

  const root = getNotificationsRoot();
  const host = (
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
      <Stack spacing={1} aria-live="polite">
        {toasts.map(renderToast)}
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
    </Box>
  );
  return root ? createPortal(host, root) : host;
};
