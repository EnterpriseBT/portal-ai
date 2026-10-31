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
  /** #311: marketing-site business config — a successful `vars set` of a
   *  marked key fires the site-rebuild dispatch (slice 4). */
  siteConfig?: boolean;
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
  secret("ANTHROPIC_API_KEY", "anthropic-api-key"),
  secret("TAVILY_API_KEY", "tavily-api-key"),
  // #315: Mapbox access token behind geocode / reverse_geocode /
  // bulk_geocode_records. Wired into backend.yml and deploy-dev.yml when GIS
  // geocoding shipped, but missed here — so `vars apply` reported a complete
  // environment while a required secret was absent (#382). A parity test now
  // asserts every backend.yml secret has an entry.
  secret("GEOCODING_API_KEY", "geocoding-api-key"),
  secret("GOOGLE_OAUTH_CLIENT_SECRET", "google-oauth-client-secret"),
  secret("MICROSOFT_OAUTH_CLIENT_SECRET", "microsoft-oauth-client-secret"),
  secret("OAUTH_STATE_SECRET", "oauth-state-secret"),
  secret("STRIPE_SECRET_KEY", "stripe-secret-key"), // #218 tier apply (rk_ recommended)
  secret("STRIPE_WEBHOOK_SECRET", "stripe-webhook-secret"), // #239 webhook signature verification
  // #311: fine-grained PAT scoped to this repo (Contents: read + repository
  // dispatch) — lets the API request a marketing-site rebuild when a Stripe
  // `price.*` webhook moves an amount the site has baked into static HTML.
  // NOT marked `siteConfig`: rotating the token is not a published fact.
  secret("GITHUB_DISPATCH_TOKEN", "github-dispatch-token"),
  // #510: the demo custom-toolpack signing-secret allow-list — the comma-joined
  // set of whsec_ secrets the shared demo webhook toolpack verifies. Read by
  // the env-agnostic `portalai-demo-toolpack` Lambda
  // (infra/cloudformation/demo-toolpack.yml) and by `db:demo:seed`, which
  // registers the demo toolpack with its first entry (#911). The seed runs
  // from the operator's shell, not the API task, so it stays out of
  // backend.yml — a catalog-only key (the parity test allows these).
  secret("DEMO_TOOLPACK_SIGNING_SECRETS", "demo-toolpack-signing-secrets"),
  // #489: the deployed-env QA identities the e2e harness signs in as: the QA
  // org's owner (also the post-deploy login check), admin and member. Never
  // read by the API, so not in backend.yml.
  secret("QA_AUTH0_USERNAME", "qa-auth0-username"),
  secret("QA_AUTH0_PASSWORD", "qa-auth0-password"),
  secret("QA_AUTH0_USERNAME_ADMIN", "qa-auth0-username-admin"),
  secret("QA_AUTH0_PASSWORD_ADMIN", "qa-auth0-password-admin"),
  secret("QA_AUTH0_USERNAME_MEMBER", "qa-auth0-username-member"),
  secret("QA_AUTH0_PASSWORD_MEMBER", "qa-auth0-password-member"),
  // The QA org's id, which the login check pins every QA identity to. Not
  // secret, but kept beside the identities: the deploy role already reads
  // portalai/<env>/* secrets.
  secret("QA_ORG_ID", "qa-org-id"),
  // ── SSM Parameter Store (config) ─
  ssm("GOOGLE_OAUTH_CLIENT_ID", "google-oauth-client-id"),
  // #580: public Google browser identifiers the API serves at runtime via
  // GET /api/connector-config (moved out of the web build's VITE_GOOGLE_*).
  // Non-secret (the Picker key is restricted in GCP by referrer + API).
  ssm("GOOGLE_PICKER_API_KEY", "google-picker-api-key"),
  ssm("GOOGLE_CLOUD_PROJECT_NUMBER", "google-cloud-project-number"),
  ssm("MICROSOFT_OAUTH_CLIENT_ID", "microsoft-oauth-client-id"),
  ssm("MICROSOFT_OAUTH_TENANT", "microsoft-oauth-tenant"),
  ssm("AUTH0_DOMAIN", "auth0-domain"),
  ssm("AUTH0_AUDIENCE", "auth0-audience"),
  ssm("AUTH0_CLI_CLIENT_ID", "auth0-cli-client-id"), // #194 device-flow app
  // #916: JSON array of { connection, domains }: the Auth0 enterprise
  // connections whose logins are invite-gated, and the email domains "Sign in
  // with SSO" routes to them. Every env stores it; `none` turns it off (SSM
  // can't hold an empty value). The API reads it at task start, so a `vars set`
  // takes effect on the next deploy or task restart.
  ssm("SSO_ENTERPRISE_CONNECTIONS", "sso-enterprise-connections"),
  ssm("CORS_ORIGIN", "cors-origin"),
  ssm("SYSTEM_ID", "system-id"),
  // #509: the shared demo custom-toolpack base URL the seeder registers the
  // demo webhook toolpack from. Config (non-secret); the CLI resolves it and
  // passes it to `db:demo:seed`. Same shared endpoint across demo envs (#510).
  ssm("DEMO_TOOLPACK_URL", "demo-toolpack-url"),
  // #311/#369: the business contact addresses. Baked into the marketing site
  // and the web app at build time — a `vars set` changes the stored value, and
  // the next deploy (or the site-rebuild dispatch) is what publishes it.
  //
  // Same key set in every environment, differing only in value: qa@ serves all
  // roles outside prod so no non-prod surface can advertise a
  // customer-facing inbox.
  { ...ssm("SUPPORT_EMAIL", "support-email"), siteConfig: true },
  { ...ssm("SALES_EMAIL", "sales-email"), siteConfig: true },
  // #369: legal / data-controller contact — the site's terms and privacy
  // pages, and the DMARC `rua=` reporting destination.
  { ...ssm("ADMIN_EMAIL", "admin-email"), siteConfig: true },
  // #613: security-disclosure contact — the site's security.txt `Contact:`
  // and the /security/ page's reporting section.
  { ...ssm("SECURITY_EMAIL", "security-email"), siteConfig: true },
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
