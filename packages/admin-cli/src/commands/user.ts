/**
 * `portalai user …` — read-only user lookups (#190). Users originate in
 * Auth0 (webhook sync); the CLI reads and links them, never creates them.
 */

import type { EnvironmentDefinition } from "@portalai/cli-env";
import type { User } from "@portalai/core/models";

import type { ListUsersOptions } from "../store.js";
import { withStore } from "./common.js";

export function userList(
  def: EnvironmentDefinition,
  opts: ListUsersOptions
): Promise<User[]> {
  return withStore(def, (s) => s.listUsers(opts));
}

export function userGet(
  def: EnvironmentDefinition,
  email: string
): Promise<User> {
  return withStore(def, (s) => s.getUserByEmail(email));
}
