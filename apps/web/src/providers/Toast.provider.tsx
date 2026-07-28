import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ToastHost } from "../components/ToastHost.component";
import {
  TOAST_AUTO_HIDE_MS,
  TOAST_MAX_VISIBLE,
  TOAST_QUEUE_CAP,
} from "../utils/toast.constants";
import { ToastContext } from "../utils/toast.context";

import type { Toast, ToastApi, ToastOptions } from "../utils/toast.context";

/** Raise-time id. Never a render-time counter: StrictMode double-invokes renders. */
const nextId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `toast-${Math.random().toString(36).slice(2)}${Date.now()}`;

export interface ToastProviderProps {
  children: React.ReactNode;
}

/**
 * Owns the toast queue (#293) and renders the host.
 *
 * Policy, all of it deliberate:
 * - **Bounded stack.** The first `TOAST_MAX_VISIBLE` are shown; the rest
 *   queue behind a "+N more" row so multiplicity is visible without an
 *   unbounded pile.
 * - **Asymmetric timing.** `error` persists until dismissed; other severities
 *   auto-hide. Each *visible* toast runs its own timer, so a success fades
 *   from beside a persistent error.
 * - **Timers start on promotion**, not on raise — a toast that waited its turn
 *   still gets its full reading time.
 * - **Dedupe against visible toasts**, so double-clicking a failing button
 *   yields one toast rather than two.
 * - **The system never auto-dismisses an error** to make room. Only the user
 *   may discard an unread one (per-toast close, or Dismiss all).
 */
export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [queue, setQueue] = useState<Toast[]>([]);

  /** Live auto-hide timers, keyed by toast id. */
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setQueue((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setQueue([]);
  }, []);

  const show = useCallback((toast: Omit<Toast, "id">) => {
    setQueue((prev) => {
      // Dedupe against what the user can currently SEE. Pending duplicates
      // are not compared — they are not yet competing for attention.
      const visible = prev.slice(0, TOAST_MAX_VISIBLE);
      const isDuplicate = visible.some(
        (t) => t.message === toast.message && t.severity === toast.severity
      );
      if (isDuplicate) return prev;

      const next = [...prev, { ...toast, id: nextId() }];
      if (next.length <= TOAST_QUEUE_CAP) return next;

      // Over cap: drop the OLDEST PENDING toast. Visible ones are never
      // evicted — this is the only bound on a retry loop behind a
      // persistent error.
      const kept = [
        ...next.slice(0, TOAST_MAX_VISIBLE),
        ...next.slice(TOAST_MAX_VISIBLE + (next.length - TOAST_QUEUE_CAP)),
      ];
      return kept;
    });
  }, []);

  const visible = useMemo(() => queue.slice(0, TOAST_MAX_VISIBLE), [queue]);

  /**
   * Arm one timer per visible toast, and only once it is visible — hence
   * keying off `visible` rather than the whole queue. Timers for toasts that
   * have left the visible set are cleared, so a dismissal cannot fire a
   * stale callback.
   */
  useEffect(() => {
    const live = timers.current;
    const visibleIds = new Set(visible.map((t) => t.id));

    for (const [id, handle] of live) {
      if (!visibleIds.has(id)) {
        clearTimeout(handle);
        live.delete(id);
      }
    }

    for (const toast of visible) {
      if (live.has(toast.id)) continue;
      const duration = TOAST_AUTO_HIDE_MS[toast.severity];
      if (duration == null) continue; // errors persist
      live.set(
        toast.id,
        setTimeout(() => {
          live.delete(toast.id);
          dismiss(toast.id);
        }, duration)
      );
    }
  }, [visible, dismiss]);

  // Clear every timer on unmount.
  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const handle of live.values()) clearTimeout(handle);
      live.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      dismissAll,
      success: (message: string, options?: ToastOptions) =>
        show({ message, severity: "success", ...options }),
      info: (message: string, options?: ToastOptions) =>
        show({ message, severity: "info", ...options }),
      warning: (message: string, options?: ToastOptions) =>
        show({ message, severity: "warning", ...options }),
      error: (message: string, options?: ToastOptions) =>
        show({ message, severity: "error", ...options }),
    }),
    [show, dismiss, dismissAll]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastHost
        toasts={visible}
        hiddenCount={queue.length - visible.length}
        onDismiss={dismiss}
        onDismissAll={dismissAll}
      />
    </ToastContext.Provider>
  );
};
