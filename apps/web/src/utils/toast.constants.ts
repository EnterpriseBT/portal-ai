import type { ToastSeverity } from "./toast.context";

/**
 * Toast policy constants (#293). Kept apart from the context so the provider,
 * the host and their tests share one source of truth for the numbers.
 */

/** Toasts rendered simultaneously; the rest queue behind a "+N more" row. */
export const TOAST_MAX_VISIBLE = 3;

/**
 * Pending toasts held beyond the visible set. At the cap the **oldest
 * pending** is dropped — never a visible one. This is the only thing bounding
 * a retry loop behind a persistent error.
 */
export const TOAST_QUEUE_CAP = 20;

/**
 * Auto-hide per severity; `null` persists until dismissed.
 *
 * Only a success hides itself (#1021, WCAG 2.2.1): it confirms an outcome the
 * page already shows, so nothing is lost when it goes, and the provider holds
 * it while the pointer or focus is in the stack. `info` and `warning` carry
 * something the user needs to read, so they wait for the user like an
 * `error`. A notice whose relevance has a known end passes `autoHideMs`
 * instead (the rate-limit warning, #747).
 */
export const TOAST_AUTO_HIDE_MS: Record<ToastSeverity, number | null> = {
  success: 4_000,
  info: null,
  warning: null,
  error: null,
};

/**
 * Bottom-right — matching `Toolpacks` and `EditLayoutPlan`, and deliberately
 * clear of `UpdateBanner`, which stays bottom-center as a recorded holdout
 * (it reports a polled condition, not the outcome of an action).
 */
export const TOAST_ANCHOR = {
  vertical: "bottom",
  horizontal: "right",
} as const;
