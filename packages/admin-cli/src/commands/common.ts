/**
 * Shared command plumbing (#190): the guard→session→connect→store lifecycle
 * every command runs through. Library-first — guards and audit live HERE so
 * programmatic consumers (tests, CI, agents) inherit them.
 */

import {
  assertOperationAllowed,
  recordAudit,
  resolveEnvConnection,
  type EnvironmentDefinition,
} from "@portalai/cli-env";

import { createDbAdminStore, type AdminStore } from "../store.js";
import { requireMutationOperator } from "../session.js";

export interface MutateFlags {
  yes?: boolean;
  confirmProd?: boolean;
}

/** Open the env's DB path, hand the store to `fn`, always release both. */
export async function withStore<T>(
  def: EnvironmentDefinition,
  fn: (store: AdminStore) => Promise<T>
): Promise<T> {
  const conn = await resolveEnvConnection(def.name);
  try {
    const db = await conn.db();
    const store = createDbAdminStore(db.connectionString);
    try {
      return await fn(store);
    } finally {
      await store.close();
    }
  } finally {
    await conn.dispose();
  }
}

/** Guard + session for a mutating command; returns the audit operator. */
export async function beginMutation(
  def: EnvironmentDefinition,
  flags: MutateFlags,
  destructive: boolean
): Promise<string> {
  assertOperationAllowed(def, {
    destructive,
    confirmed: !!flags.yes,
    prodConfirmed: !!flags.confirmProd,
  });
  return requireMutationOperator(def);
}

/** One audit line per mutation — ids/slugs only, never row contents. */
export function audit(
  def: EnvironmentDefinition,
  operator: string,
  command: string,
  args: Record<string, unknown>
): Promise<void> {
  return recordAudit({ env: def.name, operator, command, args });
}
