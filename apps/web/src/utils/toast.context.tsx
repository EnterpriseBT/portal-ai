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
}

/** A queued toast. `id` is assigned at raise time, never from render. */
export interface Toast {
  id: string;
  message: string;
  severity: ToastSeverity;
  action?: ToastAction;
}

export interface ToastApi {
  success(message: string, options?: ToastOptions): void;
  info(message: string, options?: ToastOptions): void;
  warning(message: string, options?: ToastOptions): void;
  error(message: string, options?: ToastOptions): void;
  /** The primitive the four severity methods delegate to. */
  show(toast: Omit<Toast, "id">): void;
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
  success: () => {},
  info: () => {},
  warning: () => {},
  error: () => {},
  show: () => {},
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
