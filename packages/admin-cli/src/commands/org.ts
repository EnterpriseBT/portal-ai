/**
 * `portalai org …` — organization management (#190). Reads are guard-free;
 * mutations run guard → session → store → audit. `org create` and
 * `org reset` are spawn-backed and live in provision.ts (slice 3).
 */

import type { EnvironmentDefinition } from "@portalai/cli-env";
import type { Organization } from "@portalai/core/models";

import type { ListOrgsOptions, OrgPatch } from "../store.js";
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

export async function orgUpdate(
  def: EnvironmentDefinition,
  id: string,
  patch: OrgPatch,
  flags: MutateFlags
): Promise<Organization> {
  const operator = await beginMutation(def, flags, false);
  const org = await withStore(def, (s) => s.updateOrg(id, patch, operator));
  await audit(def, operator, "org update", {
    orgId: id,
    fields: Object.keys(patch),
  });
  return org;
}

export async function orgSetTier(
  def: EnvironmentDefinition,
  id: string,
  tierSlug: string,
  flags: MutateFlags
): Promise<{ id: string; tier: string; previousTier: string }> {
  const operator = await beginMutation(def, flags, false);
  const result = await withStore(def, (s) => s.setTier(id, tierSlug, operator));
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
