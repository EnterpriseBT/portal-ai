import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "db-credentials" });

/** Default cache TTL — bounds Secrets Manager call volume to ~1/task/window
 *  and bounds post-rotation new-connection failures to one window (#500). */
const DEFAULT_TTL_MS = 300_000;

export interface DbPasswordResolverOptions {
  /** ARN of the RDS-managed master secret (`rds!…`). Absent ⇒ the resolver
   *  is a constant returning `fallbackPassword` and the AWS SDK is never
   *  constructed — local/dev/test behavior is byte-identical to a static
   *  password. */
  masterSecretArn: string | undefined;
  /** The DATABASE_URL's embedded password — the fail-open floor. */
  fallbackPassword: string;
  ttlMs?: number;
  /** Injected in tests. Constructed lazily (first fetch) otherwise. */
  client?: SecretsManagerClient;
  /** Injected clock for deterministic TTL tests. */
  now?: () => number;
}

export interface DbPasswordResolver {
  /** Handed to postgres-js as its `password` option — evaluated per new
   *  connection. Cached ≤ ttl, single-flight, never rejects (fail-open:
   *  last-known-good, else the fallback). */
  resolve(): Promise<string>;
  /** Drop the cache so the next resolve() fetches; last-known-good is
   *  retained as the fail-open floor. Called from the boot-connect
   *  failure path. */
  invalidate(): void;
}

export function createDbPasswordResolver(
  opts: DbPasswordResolverOptions
): DbPasswordResolver {
  const { masterSecretArn, fallbackPassword } = opts;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? Date.now;

  if (!masterSecretArn) {
    return {
      resolve: () => Promise.resolve(fallbackPassword),
      invalidate: () => {},
    };
  }

  let client = opts.client ?? null;
  /** What resolve() serves inside the TTL. Set on success AND on failure
   *  (failure caches the fail-open value) so the TTL bounds Secrets Manager
   *  call volume in both directions. */
  let cached: { password: string; fetchedAt: number } | null = null;
  /** Last successfully-fetched password — the fail-open floor once any
   *  fetch has succeeded. Survives invalidate(). */
  let lastKnownGood: string | null = null;
  let inFlight: Promise<string> | null = null;

  const fetchPassword = async (): Promise<string> => {
    try {
      client ??= new SecretsManagerClient({});
      const result = await client.send(
        new GetSecretValueCommand({ SecretId: masterSecretArn })
      );
      const parsed: unknown = JSON.parse(
        (result as { SecretString?: string }).SecretString ?? ""
      );
      const password = (parsed as { password?: unknown }).password;
      if (typeof password !== "string" || password.length === 0) {
        throw new Error("master secret JSON has no password field");
      }
      if (lastKnownGood !== null && lastKnownGood !== password) {
        // The weekly heartbeat: one of these per task per rotation is
        // healthy; a burst means the fetch path itself is struggling.
        logger.warn(
          { secretArn: masterSecretArn },
          "rotation absorbed — database password re-fetched and changed"
        );
      }
      lastKnownGood = password;
      return password;
    } catch (cause) {
      // FAIL-OPEN (#500 spec Key decision 3): a stale password is the
      // status quo, never a new outage. Serve the best credential we have.
      logger.warn(
        { secretArn: masterSecretArn, cause },
        "database password fetch failed — failing open to the last known credential"
      );
      return lastKnownGood ?? fallbackPassword;
    }
  };

  return {
    async resolve(): Promise<string> {
      if (cached !== null && now() - cached.fetchedAt < ttlMs) {
        return cached.password;
      }
      if (inFlight === null) {
        inFlight = fetchPassword()
          .then((password) => {
            cached = { password, fetchedAt: now() };
            return password;
          })
          .finally(() => {
            inFlight = null;
          });
      }
      return inFlight;
    },
    invalidate(): void {
      cached = null;
    },
  };
}
