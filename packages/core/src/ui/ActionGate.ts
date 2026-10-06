/**
 * #688: what an action affordance should do for this caller, decided by the
 * app (from per-object capabilities, the plan's entitlements and transient
 * state) and rendered by the core CTA components. Core never decides it: it
 * renders the value it's handed.
 *
 * - `allow`: a normal action.
 * - `hide`: a permission says no. Not rendered.
 * - `disable`: transient state says no (a running job, a pending save), or a
 *   page's primary action the caller could plausibly be granted. Rendered
 *   `aria-disabled`, still focusable, with `reason` as its tooltip.
 * - `upsell`: the plan says no. Rendered enabled with a lock; activating it
 *   calls `onUpgrade` and `reason` is its tooltip.
 */
export type ActionGate =
  | { kind: "allow" }
  | { kind: "hide" }
  | { kind: "disable"; reason: string }
  | { kind: "upsell"; reason: string; onUpgrade: () => void };

export const ALLOW: ActionGate = { kind: "allow" };
