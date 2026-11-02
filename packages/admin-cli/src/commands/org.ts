/**
 * `portalai org …` — organization management (#190). Reads are guard-free;
 * mutations run guard → session → store → audit. `org create` and
 * `org reset` are spawn-backed and live in provision.ts (slice 3).
 */

import type { EnvironmentDefinition } from "@portalai/cli-env";
import type { Organization } from "@portalai/core/models";

import type { ListOrgsOptions, OrgPatch } from "../store.js";
import { AdminConflictError } from "../errors.js";
import { audit, beginMutation, withStore, type MutateFlags } from "./common.js";

export function orgList(
  def: EnvironmentDefinition,
  opts: ListOrgsOptions
): Promise<Organization[]> {
  return withStore(def, (s) => s.listOrgs(opts));
}

export function orgGet(
  def: EnvironmentDefinition,
  id: string
): Promise<Organization> {
  return withStore(def, (s) => s.getOrg(id));
}

/** #936: `portalai` holds no Stripe credential, so a rename of an org with a
 *  Stripe customer reports the step that keeps the customer's name (shown on
 *  invoices and in the billing portal) in step with the app. */
export interface StripeNameStep {
  action: "update_customer_name";
  customerId: string;
  name: string;
  command: string;
}

export interface OrgUpdateOutput {
  org: Organization;
  stripe?: StripeNameStep;
}

/** POSIX single-quote a value for the printed shell command. */
const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export async function orgUpdate(
  def: EnvironmentDefinition,
  id: string,
  patch: OrgPatch,
  flags: MutateFlags
): Promise<OrgUpdateOutput> {
  const operator = await beginMutation(def, flags, false);
  // #936: the store records the app's org.update entries in the same
  // transaction; this line is the operator's own local record.
  const { org, changes } = await withStore(def, (s) =>
    s.updateOrg(id, patch, operator)
  );
  await audit(def, operator, "org update", {
    orgId: id,
    fields: Object.keys(changes),
  });

  const customerId = org.stripeCustomerId;
  if (!changes.name || !customerId) return { org };
  return {
    org,
    stripe: {
      action: "update_customer_name",
      customerId,
      name: org.name,
      command: `stripe customers update ${customerId} --name ${shellQuote(org.name)}`,
    },
  };
}

export async function orgSetTier(
  def: EnvironmentDefinition,
  id: string,
  tierSlug: string,
  flags: MutateFlags
): Promise<{ id: string; tier: string; previousTier: string }> {
  const operator = await beginMutation(def, flags, false);
  const result = await withStore(def, async (s) => {
    // #259: a live Stripe subscription drives the tier (webhook-authoritative);
    // setting it here would silently desync the DB from Stripe. Refuse unless
    // the operator explicitly overrides.
    const org = await s.getOrg(id);
    if (org.stripeSubscriptionId != null && !flags.allowStripeDesync) {
      throw new AdminConflictError(
        `Org ${id} has an active Stripe subscription (${org.stripeSubscriptionId}) that drives its tier — ` +
          `change or cancel it in Stripe or the billing portal, or pass --allow-stripe-desync to override.`
      );
    }
    return s.setTier(id, tierSlug, operator);
  });
  await audit(def, operator, "org set-tier", {
    orgId: id,
    tier: result.tier,
    previousTier: result.previousTier,
  });
  return result;
}

export async function orgDelete(
  def: EnvironmentDefinition,
  id: string,
  flags: MutateFlags
): Promise<{ id: string; deleted: true }> {
  const operator = await beginMutation(def, flags, true); // destructive
  await withStore(def, (s) => s.softDeleteOrg(id, operator));
  await audit(def, operator, "org delete", { orgId: id });
  return { id, deleted: true };
}
