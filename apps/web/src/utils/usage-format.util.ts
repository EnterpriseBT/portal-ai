/**
 * Formatting helpers for the per-org tool usage balance (#172) — shared by the
 * Settings → Organization display and the portal session details.
 */

/** Render a per-cost-class usage balance; `available: null` = unlimited. */
export const formatUsageValue = (balance?: {
  used: number;
  available: number | null;
}): string => {
  if (!balance) return "—";
  return balance.available === null
    ? `${balance.used} used · Unlimited`
    : `${balance.used} used · ${balance.available} available`;
};
