/**
 * Public subprocessor list ⇔ the API's egress (#613).
 *
 * The marketing site publishes `SUBPROCESSORS` (`@portalai/core/content`) as
 * the third parties that process customer data. That list is only honest if
 * it moves with the code, and the integration point for every third party is
 * an env var: a key, an endpoint, an OAuth client. So every `process.env.X`
 * the API reads is classified here, as the subprocessor it reaches or as
 * internal with a reason. A new variable fails CI until someone makes that
 * call, which is the moment to ask whether the public list must change.
 *
 * Before #613 two lists disagreed: privacy named seven third parties while
 * `docs/DEPLOYMENT_SECURITY_REVIEW.md` named four. Neither was checked.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "@jest/globals";

import {
  SUBPROCESSORS,
  SUBPROCESSOR_IDS,
  type SubprocessorId,
} from "@portalai/core/content";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../..");

/** Reaches a third party that processes customer data. */
const EGRESS: Record<string, SubprocessorId> = {
  // Hosting: our own AWS account — RDS, ElastiCache, S3, Secrets Manager.
  DATABASE_URL: "aws",
  DB_MASTER_SECRET_ARN: "aws",
  MIGRATE_DATABASE_URL: "aws",
  MIGRATE_DATABASE_PASSWORD: "aws",
  REDIS_URL: "aws",
  UPLOAD_S3_BUCKET: "aws",
  // Can name any S3-compatible store; on the hosted service it is AWS S3. A
  // residency deployment's own review record covers its choice.
  UPLOAD_S3_ENDPOINT: "aws",
  UPLOAD_S3_FORCE_PATH_STYLE: "aws",
  UPLOAD_S3_PREFIX: "aws",
  UPLOAD_S3_PRESIGN_EXPIRY_SEC: "aws",
  UPLOAD_S3_REGION: "aws",
  AWS_MARKETPLACE_PRODUCT_CODE: "aws",
  AWS_MARKETPLACE_REGION: "aws",
  // The demo org's custom toolpack: our own Lambda (#510), in our account.
  DEMO_TOOLPACK_URL: "aws",

  ANTHROPIC_API_KEY: "anthropic",
  ANTHROPIC_BASE_URL: "anthropic",
  INTERPRET_AXIS_NAME_MODEL: "anthropic",
  INTERPRET_CLASSIFIER_MODEL: "anthropic",

  TAVILY_API_KEY: "tavily",
  GEOCODING_API_KEY: "mapbox",

  AUTH0_AUDIENCE: "auth0",
  AUTH0_DOMAIN: "auth0",

  STRIPE_AUTOMATIC_TAX: "stripe",
  STRIPE_SECRET_KEY: "stripe",
  STRIPE_WEBHOOK_SECRET: "stripe",

  GOOGLE_CLOUD_PROJECT_NUMBER: "google",
  GOOGLE_OAUTH_CLIENT_ID: "google",
  GOOGLE_OAUTH_CLIENT_SECRET: "google",
  GOOGLE_OAUTH_REDIRECT_URI: "google",
  GOOGLE_PICKER_API_KEY: "google",

  MICROSOFT_OAUTH_CLIENT_ID: "microsoft",
  MICROSOFT_OAUTH_CLIENT_SECRET: "microsoft",
  MICROSOFT_OAUTH_REDIRECT_URI: "microsoft",
  MICROSOFT_OAUTH_TENANT: "microsoft",
};

const SELF = "our own deployment's identity or wiring; reaches no third party";
const SECRET = "a key used inside the API; reaches no third party";
const TUNING = "an in-process limit or timing knob";
const RETENTION = "a retention window enforced in our own database";
const CUSTOMER_IDP =
  "enterprise SSO against the customer's own identity provider, which they operate; not a Portals AI subprocessor";
const DEV_ONLY = "local development and tests only; unset in deployed envs";

/** Read, but sends no customer data to a third party. */
const INTERNAL: Record<string, string> = {
  BUILD_SHA: SELF,
  BUILD_VERSION: SELF,
  CORS_ORIGIN: SELF,
  DEPLOY_MODE: SELF,
  LOG_FORMAT: SELF,
  LOG_LEVEL:
    "logs go to CloudWatch in our AWS account; no third-party telemetry",
  NODE_ENV: SELF,
  PORT: SELF,
  PORTAL_SQL_READER_ROLE: SELF,
  PUBLIC_API_BASE_URL: SELF,
  SYSTEM_ID: SELF,
  TRUST_PROXY_HOPS: SELF,
  WEB_APP_URL: SELF,

  ENCRYPTION_KEY: SECRET,
  OAUTH_STATE_SECRET: SECRET,

  GITHUB_DISPATCH_REPO:
    "triggers the marketing-site rebuild; the payload carries no customer data",
  GITHUB_DISPATCH_TOKEN:
    "triggers the marketing-site rebuild; the payload carries no customer data",

  SSO_ISSUERS: CUSTOMER_IDP,
  SSO_ENTERPRISE_CLAIM: CUSTOMER_IDP,
  SSO_ENTERPRISE_CLAIM_VALUE: CUSTOMER_IDP,
  OIDC_AUDIENCE: CUSTOMER_IDP,
  OIDC_ISSUER: CUSTOMER_IDP,

  AUTH_API_RATE_LIMIT_PER_MIN: TUNING,
  AUTH_TILE_RATE_LIMIT_PER_MIN: TUNING,
  PUBLIC_SITE_RATE_LIMIT_PER_MIN: TUNING,
  DB_PASSWORD_CACHE_TTL_MS: TUNING,
  DISSOLVE_SCOPE_TTL_MS: TUNING,
  FILE_UPLOAD_CACHE_ROWS_PER_CHUNK: TUNING,
  FILE_UPLOAD_CACHE_TTL_SEC: TUNING,
  FILE_UPLOAD_INLINE_CELLS_MAX: TUNING,
  FILE_UPLOAD_PARSE_MAX_BYTES: TUNING,
  FILE_UPLOAD_SLICE_CELLS_MAX: TUNING,
  INVITATION_TTL_DAYS: TUNING,
  JOB_STRANDED_SWEEP_INTERVAL_MS: TUNING,
  JOB_STRANDED_THRESHOLD_MS: TUNING,
  LAYOUT_PLAN_COMMIT_LOCK_WAIT_MS: TUNING,
  REQUEST_JSON_LIMIT_BYTES: TUNING,
  SQL_QUERY_JOB_COST_THRESHOLD: TUNING,
  TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES: TUNING,
  UPLOAD_ALLOWED_EXTENSIONS: TUNING,
  UPLOAD_MAX_FILES_PER_SESSION: TUNING,
  UPLOAD_MAX_FILE_SIZE_BYTES: TUNING,
  WIDE_TABLE_SEARCH_INDEX_SWEEP_MAX_BUILDS: TUNING,

  AUDIT_LOG_RETENTION_MONTHS: RETENTION,
  ENTITY_RECORD_ORPHAN_RETENTION_DAYS: RETENTION,
  ENTITY_RECORD_RETENTION_DAYS: RETENTION,
  LEDGER_RETENTION_MONTHS: RETENTION,
  MESSAGE_DISSOLVE_RETENTION_DAYS: RETENTION,

  // Custom webhook tools call endpoints the customer hosts, which the public
  // list says are not subprocessors; these only harden that path.
  TOOLPACK_DISABLE_SIGNING: DEV_ONLY,
  TOOLPACK_DISABLE_SSRF_FILTER: DEV_ONLY,
  MOCK_TOOLPACK_FLAKY_MOD: DEV_ONLY,
  MOCK_TOOLPACK_LATENCY_MS: DEV_ONLY,
  MOCK_TOOLPACK_SIGNING_SECRET: DEV_ONLY,
};

/** Every `process.env.X` read under src/, excluding test trees. */
function readsInSource(): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "__integration__")
          continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      const body = fs.readFileSync(full, "utf8");
      for (const m of body.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
        if (!found.has(m[1])) found.set(m[1], path.relative(ROOT, full));
      }
    }
  };
  walk(path.join(ROOT, "src"));
  return found;
}

/** Reads that are in neither map, or in both, described for a failure. */
function misclassified(
  reads: Map<string, string>,
  egress: Record<string, unknown>,
  internal: Record<string, unknown>
): string[] {
  return [...reads.entries()].flatMap(([key, where]) => {
    const e = key in egress;
    const i = key in internal;
    if (e && i)
      return [`${key} (read at ${where}) is in both EGRESS and INTERNAL`];
    if (!e && !i)
      return [
        `${key} (read at ${where}) is unclassified: does it reach a subprocessor?`,
      ];
    return [];
  });
}

describe("the public subprocessor list matches the API's egress (#613)", () => {
  const reads = readsInSource();

  it("finds a plausible number of reads", () => {
    // Guards the guard: a broken walk that finds nothing would pass silently.
    expect(reads.size).toBeGreaterThan(40);
  });

  it("classifies every variable the code reads exactly once", () => {
    expect(misclassified(reads, EGRESS, INTERNAL)).toEqual([]);
  });

  it("reports an unclassified read by name", () => {
    // The failure message is the worklist when a new integration lands.
    const reads = new Map([["NEWVENDOR_API_KEY", "src/services/x.ts"]]);
    expect(misclassified(reads, EGRESS, INTERNAL)).toEqual([
      "NEWVENDOR_API_KEY (read at src/services/x.ts) is unclassified: does it reach a subprocessor?",
    ]);
  });

  it("classifies nothing the code no longer reads", () => {
    const stale = [...Object.keys(EGRESS), ...Object.keys(INTERNAL)].filter(
      (key) => !reads.has(key)
    );
    expect(stale).toEqual([]);
  });

  it("maps egress only to published subprocessors", () => {
    for (const id of Object.values(EGRESS)) {
      expect(SUBPROCESSOR_IDS).toContain(id);
    }
  });

  it("publishes no server-side subprocessor the API never reaches", () => {
    // The other direction: a removed integration must leave the public list.
    // Browser-side entries are held by apps/web's host guard instead.
    const reached = new Set(Object.values(EGRESS));
    const unreached = SUBPROCESSORS.filter((s) =>
      s.reachedBy.includes("server")
    )
      .map((s) => s.id)
      .filter((id) => !reached.has(id));
    expect(unreached).toEqual([]);
  });
});
