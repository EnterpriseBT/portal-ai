/**
 * Kind-gated operation guards (#194, Decision 3 + the enterprise lens).
 *
 * The gating keys on the registry's `kind` classification — never on
 * string-matching env names. Confirmations are explicit flags supplied by the
 * caller (non-interactive by design: an agent or CI passes them; nothing here
 * prompts).
 *
 *   development → everything allowed, no flags.
 *   staging     → any operation requires `confirmed` (--yes).
 *   production  → destructive ops are blocked UNCONDITIONALLY;
 *                 non-destructive mutations require `confirmed` AND
 *                 `prodConfirmed` (the distinct prod barrier flag).
 */

import {
  EnvConfirmationRequiredError,
  EnvDestructiveBlockedError,
} from "./errors.js";
import type { EnvironmentDefinition } from "./registry.js";

export interface OperationGuardOptions {
  /** seed / mock / reset / teardown-class operations. */
  destructive: boolean;
  /** The caller's --yes. */
  confirmed: boolean;
  /** The caller's distinct production barrier flag. */
  prodConfirmed: boolean;
}

export function assertOperationAllowed(
  def: EnvironmentDefinition,
  opts: OperationGuardOptions
): void {
  switch (def.kind) {
    case "development":
      return;

    case "staging":
      if (!opts.confirmed) {
        throw new EnvConfirmationRequiredError(
          `Operation against staging environment "${def.name}" requires explicit confirmation (--yes)`
        );
      }
      return;

    case "production":
      if (opts.destructive) {
        throw new EnvDestructiveBlockedError(
          `Destructive operations are never allowed against production environment "${def.name}"`
        );
      }
      if (!opts.confirmed || !opts.prodConfirmed) {
        throw new EnvConfirmationRequiredError(
          `Operation against production environment "${def.name}" requires explicit confirmation (--yes) AND the production barrier flag`
        );
      }
      return;
  }
}

/** The active-env line every command echoes, e.g. `[env: app-dev (staging)]`. */
export function envBanner(def: EnvironmentDefinition): string {
  return `[env: ${def.name} (${def.kind})]`;
}
