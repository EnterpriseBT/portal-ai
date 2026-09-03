/**
 * composeDatabaseUrl (#500) — compose a connection string LIVE from the
 * RDS-managed master secret (`rds!…`, exported by the database stack as
 * `${envName}-DbMasterSecretArn`, #384). This is the always-current
 * credential path: the stored `portalai/<env>/database-url` secret is a
 * point-in-time copy that goes stale at the next managed rotation, so no
 * consumer reads it for credentials anymore — the app resolves its password
 * at connect time (apps/api credentials.util), and the CLI composes here.
 *
 * Lifted from `portalops db url` (#384), which now delegates to this.
 */

import { getSecretByArn } from "./aws.js";
import { resolveExport } from "./tunnel.js";
import { EnvInfraError } from "./errors.js";
import type { EnvironmentDefinition } from "./registry.js";

const DEFAULT_DB_NAME = "portal_ai";
const DEFAULT_SSL_MODE = "require";

export interface ComposeDatabaseUrlOptions {
  /** Default `portal_ai`; `postgres` reaches the maintenance DB during
   *  bootstrap. */
  dbName?: string;
  /** sslmode query value, default `require`. */
  sslMode?: string;
}

export interface ComposedDatabaseUrl {
  /** Full connection string, credentials included — treat as a secret. */
  url: string;
  /** Password replaced with `***` — the only form safe to print/serialize. */
  redactedUrl: string;
  endpoint: string;
  port: number;
  dbName: string;
}

export async function composeDatabaseUrl(
  def: EnvironmentDefinition,
  opts: ComposeDatabaseUrlOptions = {}
): Promise<ComposedDatabaseUrl> {
  const envName = def.aws?.envName;
  const endpoint = await resolveExport(
    def,
    `${envName}-DbEndpoint`,
    `is the database stack deployed for "${def.name}"?`
  );
  const port = await resolveExport(def, `${envName}-DbPort`);
  const masterArn = await resolveExport(
    def,
    `${envName}-DbMasterSecretArn`,
    "redeploy the database stack; this export was added in #384"
  );

  const raw = await getSecretByArn(def, masterArn);
  let master: { username?: string; password?: string };
  try {
    master = JSON.parse(raw) as typeof master;
  } catch (err) {
    throw new EnvInfraError(
      `RDS master secret ${masterArn} is not JSON — cannot compose a connection string`,
      { cause: err }
    );
  }
  if (!master.username || !master.password) {
    throw new EnvInfraError(
      `RDS master secret ${masterArn} is missing username/password`
    );
  }

  const dbName = opts.dbName ?? DEFAULT_DB_NAME;
  const sslMode = opts.sslMode ?? DEFAULT_SSL_MODE;
  // Both halves are encoded: a password containing @ : / # or ? would
  // otherwise split the authority and silently yield a wrong-host URL.
  const user = encodeURIComponent(master.username);
  const compose = (auth: string) =>
    `postgresql://${auth}@${endpoint}:${port}/${dbName}?sslmode=${sslMode}`;

  return {
    url: compose(`${user}:${encodeURIComponent(master.password)}`),
    redactedUrl: compose(`${user}:***`),
    endpoint,
    port: Number(port),
    dbName,
  };
}
