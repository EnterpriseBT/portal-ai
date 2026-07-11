/**
 * `portalai login|logout` — thin wrappers over cli-env's device-flow session
 * (#190). `login` is the session bootstrap the staging/prod mutation guard
 * requires; it's the only human-interactive step in the CLI (and even it is
 * non-TTY: the verification URI surfaces via the io callback).
 */

import { login, logout, type LoginIo } from "@portalai/cli-env";
import type { EnvironmentDefinition } from "@portalai/cli-env";

export function authLogin(
  def: EnvironmentDefinition,
  io: LoginIo
): Promise<void> {
  return login(def.name, io);
}

export function authLogout(def: EnvironmentDefinition): Promise<void> {
  return logout(def.name);
}
