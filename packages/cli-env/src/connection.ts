/**
 * resolveEnvConnection — THE seam (#194, Decision 5, confirmed in review).
 *
 * The one contract the consuming CLIs (#190, #192) and any future public CLI
 * bind to. Lazy by design: resolving does a registry lookup and nothing else;
 * the SSM tunnel only opens on `db()`, the device-flow session is only
 * consulted on `token()`. Explicit lifecycle: `dispose()` closes anything
 * opened and is idempotent.
 */

import { getDatabaseUrl } from "./aws.js";
import { getToken } from "./auth0.js";
import { EnvNotConfiguredError } from "./errors.js";
import { getEnvironment, type EnvKind } from "./registry.js";
import { openDbTunnel, type Tunnel } from "./tunnel.js";

export interface DbHandle {
  /** Ready-to-use Postgres connection string (localhost-rewritten for AWS envs). */
  connectionString: string;
  close(): Promise<void>;
}

export interface EnvConnection {
  readonly env: string;
  readonly kind: EnvKind;
  readonly apiBaseUrl: string;
  /** LAZY — local: DATABASE_URL from .env; AWS: database-url secret + SSM
   *  tunnel, connection string rewritten to the tunnel's local port. Repeated
   *  calls reuse the open handle. */
  db(): Promise<DbHandle>;
  /** LAZY — the env's cached device-flow access token (transparent refresh). */
  token(): Promise<string>;
  /** Close anything opened; idempotent. */
  dispose(): Promise<void>;
}

/** Swap a Postgres URL's endpoint for the tunnel's, preserving credentials
 *  (already percent-encoded), database name and query. String-built because
 *  WHATWG URL setters are unreliable for non-special schemes like postgresql:. */
function rewriteToLocalhost(dbUrl: string, localPort: number): string {
  const parsed = new URL(dbUrl);
  const auth = parsed.username
    ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ""}@`
    : "";
  return `${parsed.protocol}//${auth}localhost:${localPort}${parsed.pathname}${parsed.search}`;
}

export async function resolveEnvConnection(
  name: string
): Promise<EnvConnection> {
  const def = getEnvironment(name); // registry lookup only — no I/O

  let dbHandle: DbHandle | null = null;
  let tunnel: Tunnel | null = null;

  const dispose = async (): Promise<void> => {
    const t = tunnel;
    tunnel = null;
    dbHandle = null;
    if (t) await t.close();
  };

  return {
    env: def.name,
    kind: def.kind,
    apiBaseUrl: def.apiBaseUrl,

    async db(): Promise<DbHandle> {
      if (dbHandle) return dbHandle;

      if (!def.aws) {
        const url = process.env.DATABASE_URL;
        if (!url) {
          throw new EnvNotConfiguredError(
            `Environment "${def.name}" needs DATABASE_URL in the process env (.env)`
          );
        }
        dbHandle = { connectionString: url, close: async () => {} };
        return dbHandle;
      }

      const dbUrl = await getDatabaseUrl(def);
      const parsed = new URL(dbUrl);
      tunnel = await openDbTunnel(def, {
        remoteHost: parsed.hostname,
        remotePort: Number(parsed.port || 5432),
      });
      dbHandle = {
        connectionString: rewriteToLocalhost(dbUrl, tunnel.localPort),
        close: dispose,
      };
      return dbHandle;
    },

    token(): Promise<string> {
      return getToken(def.name);
    },

    dispose,
  };
}
