/**
 * `portalai member …` — org membership (#190). Commands take EMAILS (how
 * humans identify users) and resolve them to ids via the store; the store
 * stays id-keyed. `member switch` bumps the membership's lastLogin — the
 * app's current-org selector — making the CLI the org switcher the UI
 * doesn't have yet.
 */

import type { EnvironmentDefinition } from "@portalai/cli-env";

import { audit, beginMutation, withStore, type MutateFlags } from "./common.js";

export async function memberAdd(
  def: EnvironmentDefinition,
  orgId: string,
  email: string,
  flags: MutateFlags
): Promise<{ orgId: string; userId: string; added: true }> {
  const operator = await beginMutation(def, flags, false);
  const userId = await withStore(def, async (s) => {
    const user = await s.getUserByEmail(email);
    await s.addMember(orgId, user.id, operator);
    return user.id;
  });
  await audit(def, operator, "member add", { orgId, userId });
  return { orgId, userId, added: true };
}

export async function memberRemove(
  def: EnvironmentDefinition,
  orgId: string,
  email: string,
  flags: MutateFlags
): Promise<{ orgId: string; userId: string; removed: true }> {
  const operator = await beginMutation(def, flags, false);
  const userId = await withStore(def, async (s) => {
    const user = await s.getUserByEmail(email);
    await s.removeMember(orgId, user.id, operator);
    return user.id;
  });
  await audit(def, operator, "member remove", { orgId, userId });
  return { orgId, userId, removed: true };
}

export async function memberSwitch(
  def: EnvironmentDefinition,
  orgId: string,
  email: string,
  flags: MutateFlags
): Promise<{ orgId: string; userId: string; switched: true }> {
  const operator = await beginMutation(def, flags, false);
  const userId = await withStore(def, async (s) => {
    const user = await s.getUserByEmail(email);
    await s.switchMember(orgId, user.id, operator);
    return user.id;
  });
  await audit(def, operator, "member switch", { orgId, userId });
  return { orgId, userId, switched: true };
}
