/**
 * The managed config-key catalog (#192) — data, not code. Mirrors the bash
 * SECRETS/PARAMS arrays (api-cli.sh:77-98) plus AUTH0_CLI_CLIENT_ID, which
 * #194 provisioned after the bash was written. Adding a managed key is a
 * one-line entry here; `vars describe/list/get/set/apply/template` all read
 * this table.
 */

import {
  EnvNotConfiguredError,
  secretsPrefix,
  ssmPrefix,
  type EnvironmentDefinition,
} from "@portalai/cli-env";

export type CatalogKind = "secret" | "ssm";

export interface CatalogEntry {
  /** The ENV_VAR-style key operators use, e.g. DATABASE_URL. */
  key: string;
  kind: CatalogKind;
  /** The path leaf under the env's prefix, e.g. database-url. */
  name: string;
  /** SSM parameter type (ssm entries only). */
  ssmType?: "String" | "SecureString";
}

const secret = (key: string, name: string): CatalogEntry => ({
  key,
  kind: "secret",
  name,
});
const ssm = (key: string, name: string): CatalogEntry => ({
  key,
  kind: "ssm",
  name,
  ssmType: "String",
});

export const CATALOG: CatalogEntry[] = [
  // ── Secrets Manager (sensitive) ─
  secret("DATABASE_URL", "database-url"),
  secret("ENCRYPTION_KEY", "encryption-key"),
  secret("AUTH0_WEBHOOK_SECRET", "auth0-webhook-secret"),
  secret("ANTHROPIC_API_KEY", "anthropic-api-key"),
  secret("TAVILY_API_KEY", "tavily-api-key"),
  secret("GOOGLE_OAUTH_CLIENT_SECRET", "google-oauth-client-secret"),
  secret("MICROSOFT_OAUTH_CLIENT_SECRET", "microsoft-oauth-client-secret"),
  secret("OAUTH_STATE_SECRET", "oauth-state-secret"),
  secret("STRIPE_SECRET_KEY", "stripe-secret-key"), // #218 tier apply (rk_ recommended)
  secret("STRIPE_WEBHOOK_SECRET", "stripe-webhook-secret"), // #239 webhook signature verification
  // ── SSM Parameter Store (config) ─
  ssm("GOOGLE_OAUTH_CLIENT_ID", "google-oauth-client-id"),
  ssm("MICROSOFT_OAUTH_CLIENT_ID", "microsoft-oauth-client-id"),
  ssm("MICROSOFT_OAUTH_TENANT", "microsoft-oauth-tenant"),
  ssm("AUTH0_DOMAIN", "auth0-domain"),
  ssm("AUTH0_AUDIENCE", "auth0-audience"),
  ssm("AUTH0_CLI_CLIENT_ID", "auth0-cli-client-id"), // #194 device-flow app
  ssm("CORS_ORIGIN", "cors-origin"),
  ssm("NAMESPACE", "namespace"),
  ssm("SYSTEM_ID", "system-id"),
];

/** Resolve a catalog key or throw (typed) pointing at `vars describe`. */
export function lookupKey(key: string): CatalogEntry {
  const entry = CATALOG.find((e) => e.key === key);
  if (!entry) {
    throw new EnvNotConfiguredError(
      `Unknown key: ${key} (run 'portalops vars describe --env <env>' for the catalog)`
    );
  }
  return entry;
}

/** The full Secrets Manager / SSM path for an entry in the given env. */
export function pathFor(
  def: EnvironmentDefinition,
  entry: CatalogEntry
): string {
  return entry.kind === "secret"
    ? `${secretsPrefix(def)}/${entry.name}`
    : `${ssmPrefix(def)}/${entry.name}`;
}

/** Verbatim bash mask rules (api-cli.sh:345-352): empty → "(empty)";
 *  len ≤ 8 → "********"; else first4…last2 with the length. */
export function mask(value: string): string {
  if (value.length === 0) return "(empty)";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}…${value.slice(-2)} (len=${value.length})`;
}
