import { createContext, useContext } from "react";

/**
 * The app's toast surface (#293) — how any component reports the outcome of an
 * action that has no form to attach to. In-dialog failures use `FormAlert`
 * (#285); everything else raises a toast.
 *
 * Replaces five independent `Snackbar` implementations that disagreed on
 * placement, timing and dismissal. `UpdateBanner` and
 * `ConnectorInstanceSyncFeedback` are recorded exceptions, not precedents:
 * polling and progress are not toast surfaces.
 */

export type ToastSeverity = "success" | "info" | "warning" | "error";

/** An affordance rendered in the toast — e.g. Retry on a failed mutation. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  /** Overrides the severity's auto-hide (`TOAST_AUTO_HIDE_MS`) for a notice
   *  whose relevance has a known end, e.g. a rate-limit wait (#747). Ignored
   *  for an error, which persists until dismissed. */
  autoHideMs?: number;
}

/** A queued toast. `id` is assigned at raise time, never from render. */
export interface Toast {
  id: string;
  message: string;
  severity: ToastSeverity;
  action?: ToastAction;
  autoHideMs?: number;
}

/**
 * Each raise returns the toast's id, for a caller that later replaces its own
 * notice (#747). When a raise is dropped as a duplicate of a visible toast,
 * nothing was added and dismissing the returned id is a no-op.
 */
export interface ToastApi {
  success(message: string, options?: ToastOptions): string;
  info(message: string, options?: ToastOptions): string;
  warning(message: string, options?: ToastOptions): string;
  error(message: string, options?: ToastOptions): string;
  /** The primitive the four severity methods delegate to. */
  show(toast: Omit<Toast, "id">): string;
  dismiss(id: string): void;
  dismissAll(): void;
}

/** `null` ⇒ no provider mounted (Storybook, unit tests) — see `useToast`. */
export const ToastContext = createContext<ToastApi | null>(null);

/**
 * Stable no-op API used when no provider is mounted. Module-level so the
 * identity is constant across renders — a fresh object each time would break
 * any consumer that memoizes on it.
 */
const NO_OP_TOAST_API: ToastApi = {
  success: () => "",
  info: () => "",
  warning: () => "",
  error: () => "",
  show: () => "",
  dismiss: () => {},
  dismissAll: () => {},
};

/**
 * Fails open by design: with no provider this returns no-ops rather than
 * throwing, because a missing notification must never break the feature that
 * raised it. Mirrors `useScrollRoot`'s documented null fallback.
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NO_OP_TOAST_API;
}
