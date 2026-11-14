import React, { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";

import { MAIN_CONTENT_ID } from "./SkipLinks.component";
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
  /**
   * True while the pointer is over the stack or focus is inside it, false
   * once neither is (#1021). The provider stops every timer while held.
   * Reported only on a change.
   */
  onHoldChange: (held: boolean) => void;
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
 *
 * When a toast holding keyboard focus goes (its Close, Dismiss all, or its
 * own timer), focus moves to the close button of the toast that takes its
 * place, else Dismiss all, else `main`, so it never falls to the body.
 *
 * It reports a hold while the pointer or keyboard focus is in the stack, so
 * nothing hides while it's being read (#1021). One hold covers the whole stack:
 * moving between toasts mustn't restart the clock on the one just left.
 */
export const ToastHost: React.FC<ToastHostProps> = ({
  toasts,
  hiddenCount,
  onDismiss,
  onDismissAll,
  onHoldChange,
}) => {
  // One polite live region holds the stack, in the queue's order (#797).
  // It's always in the page, since a screen reader only announces what's
  // added to a region that already exists, and it uses aria-live rather than
  // role="status". Success and info are announced by that region (role
  // "none" on their Alert). Errors and warnings keep MUI's role="alert",
  // which is announced assertively when it's inserted. No alert role is
  // ever present while nothing has gone wrong, so the app's
  // `queryByRole("alert")` checks are unaffected.
  const hostRef = useRef<HTMLDivElement>(null);
  /**
   * Where focus sits in the stack: a toast's position, or `toasts.length`
   * for the overflow row. Null when focus is outside it.
   */
  const focusedAt = useRef<number | null>(null);
  /** The hold's two halves, and the last value reported. */
  const pointerInside = useRef(false);
  const focusInside = useRef(false);
  /**
   * Focus came in with a pointer press (a click on Close keeps focus on the
   * button, and the hand-off then moves it to the next one). That focus
   * doesn't hold: the pointer hold already covers the mouse user, and it
   * ends when they move away. A key press in the stack clears it.
   */
  const pointerFocused = useRef(false);
  const reportedHold = useRef(false);
  const reportHold = () => {
    const held =
      pointerInside.current || (focusInside.current && !pointerFocused.current);
    if (held === reportedHold.current) return;
    reportedHold.current = held;
    onHoldChange(held);
  };

  const handleFocus = (e: React.FocusEvent<HTMLElement>) => {
    const holder = (e.target as HTMLElement).closest("[data-toast-id]");
    const index = holder
      ? toasts.findIndex((t) => t.id === holder.getAttribute("data-toast-id"))
      : -1;
    focusedAt.current = index >= 0 ? index : toasts.length;
    focusInside.current = true;
    reportHold();
  };
  const handleBlur = (e: React.FocusEvent<HTMLElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && hostRef.current?.contains(next)) return;
    // A blur from a node being removed isn't the user leaving; one from a
    // node still in the page is (a click on the page, Tab out). For a
    // removed node the layout effect below settles the hold, once focus
    // has been handed on.
    if ((e.target as Node).isConnected) {
      focusedAt.current = null;
      focusInside.current = false;
      pointerFocused.current = false;
      reportHold();
    }
  };
  const handlePointerDown = () => {
    pointerFocused.current = true;
    reportHold();
  };
  const handleKeyDown = () => {
    pointerFocused.current = false;
    reportHold();
  };
  const handlePointerEnter = () => {
    pointerInside.current = true;
    reportHold();
  };
  const handlePointerLeave = () => {
    pointerInside.current = false;
    reportHold();
  };

  // Runs before paint, after React has removed the gone toast's nodes.
  useLayoutEffect(() => {
    const at = focusedAt.current;
    if (at === null) return;
    const active = document.activeElement;
    const lost = !active || active === document.body || !active.isConnected;
    if (!lost) {
      if (!hostRef.current?.contains(active)) focusedAt.current = null;
      return;
    }
    focusedAt.current = null;
    const host = hostRef.current;
    const heir = toasts[Math.min(at, toasts.length - 1)];
    const target =
      (heir &&
        host?.querySelector<HTMLElement>(
          `[data-toast-id="${heir.id}"] button[aria-label="Close"]`
        )) ||
      host?.querySelector<HTMLElement>('[data-testid="toast-dismiss-all"]') ||
      document.getElementById(MAIN_CONTENT_ID);
    target?.focus();
  }, [toasts, hiddenCount]);

  // Runs after the hand-off above. A focused node that's removed fires no
  // blur, and an emptied stack has nothing left under the pointer, so the
  // hold is recomputed here. A hold left on would stop every later success
  // from hiding. `activeElement` outlives the window losing focus (another
  // tab), so a page without focus has nothing focused in the stack.
  useLayoutEffect(() => {
    const active = document.activeElement;
    focusInside.current =
      document.hasFocus() && !!active && !!hostRef.current?.contains(active);
    if (!focusInside.current) pointerFocused.current = false;
    if (toasts.length === 0 && hiddenCount === 0) pointerInside.current = false;
    reportHold();
  });

  const isUrgent = (t: Toast) =>
    t.severity === "error" || t.severity === "warning";
  const renderToast = (t: Toast) => (
    <Alert
      key={t.id}
      data-toast-id={t.id}
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
      ref={hostRef}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
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
