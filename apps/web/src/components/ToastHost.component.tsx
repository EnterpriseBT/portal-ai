import React from "react";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";

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
 * **One** `Snackbar` containing a `Stack` of `Alert`s, not N Snackbars: MUI
 * positions each Snackbar absolutely, so several would overlap rather than
 * stack.
 */
export const ToastHost: React.FC<ToastHostProps> = ({
  toasts,
  hiddenCount,
  onDismiss,
  onDismissAll,
}) => {
  // Render NOTHING when idle. This host is mounted app-wide (and in the shared
  // test harness), so an always-present container would sit in every page and
  // every snapshot.
  if (toasts.length === 0) return null;

  return (
    <Snackbar
      open
      anchorOrigin={TOAST_ANCHOR}
      data-testid="toast-host"
      // Dismissal is explicit — per-toast close, or Dismiss all. A stray
      // clickaway must never discard an error the user has not read.
      onClose={undefined}
    >
      <Stack spacing={1} sx={{ maxWidth: 480 }}>
        {toasts.map((t) => (
          <Alert
            key={t.id}
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
        ))}

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
    </Snackbar>
  );
};
