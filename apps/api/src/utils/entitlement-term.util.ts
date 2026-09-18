/**
 * Entitlement-term helpers (#568).
 *
 * A marketplace-granted org carries an `entitlementThrough` — the epoch-ms end
 * of its contract term (null for SaaS / non-marketplace orgs). Read-only is
 * *derived* from the term, not stored: once the term has lapsed the org is
 * read-only (writes stop, reads and data are untouched). Deriving it means the
 * state can never drift from what the customer bought, and it degrades even if
 * an expiry notification is missed.
 */

/** The org fields this predicate reads. */
export interface EntitlementBearingOrg {
  entitlementThrough: number | null;
}

/**
 * True when the org's marketplace entitlement term has lapsed. A null term
 * (SaaS / never marketplace-granted) is never expired.
 */
export function isEntitlementExpired(
  org: EntitlementBearingOrg,
  now: number
): boolean {
  return org.entitlementThrough != null && org.entitlementThrough < now;
}
