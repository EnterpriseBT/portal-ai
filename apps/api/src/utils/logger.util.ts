import pino from "pino";
import { environment } from "../environment.js";
import { requestContext } from "./request-context.util.js";

/**
 * PII-safe error serializer (#540).
 *
 * Raw DB errors carry customer row values, and pino's default `err` serializer
 * copies every enumerable own property of the error to the log sink:
 * - `PostgresError` — postgres.js does `Object.assign(this, wireFields)`, so
 *   `detail` ("Key (email)=(alice@corp.com) already exists"), `where`, `table`,
 *   `column`, `constraint` (+ their snake_case wire forms) are all enumerable,
 *   and the default serializer also attaches `.raw = err`.
 * - `DrizzleQueryError` — its `.message` is `Failed query: <SQL>\nparams: <bound
 *   customer values>`.
 *
 * This serializer is an ALLOWLIST rather than a blocklist: it emits only a fixed
 * set of non-sensitive fields and reduces DB-error messages to their error
 * class, so a customer value can never *structurally* reach a log line — even
 * for an error field this code has never seen. It preserves what ops actually
 * need: the error type, a sanitized message, the stack, and safe scalar codes
 * (e.g. the PG SQLSTATE, which names the failure class without the value).
 */
const SAFE_SCALAR_ERR_KEYS = [
  "code",
  "status",
  "statusCode",
  "errno",
  "syscall",
  "signal",
] as const;

const MAX_CAUSE_DEPTH = 5;

export function sanitizeError(err: unknown, depth = 0): unknown {
  if (!(err instanceof Error)) {
    // A thrown non-Error may be a raw row object or a string carrying customer
    // data — emit only its JS type, never its content.
    return { type: err === null ? "null" : typeof err };
  }

  const e = err as Error & Record<string, unknown>;
  const type = e.name || e.constructor?.name || "Error";
  const rawMessage = typeof e.message === "string" ? e.message : "";
  const code = e.code;

  let message = rawMessage;
  let messageSanitized = false;
  if (type === "DrizzleQueryError" || rawMessage.startsWith("Failed query:")) {
    // The wrapper message is the full SQL text plus bound customer params.
    message = "Database query failed";
    messageSanitized = true;
  } else if (type === "PostgresError" || e.severity != null) {
    // PG messages can embed the offending value (e.g. `invalid input syntax
    // for type numeric: "…"`); reduce to the SQLSTATE-named error class.
    message =
      typeof code === "string" ? `Database error (${code})` : "Database error";
    messageSanitized = true;
  }

  const out: Record<string, unknown> = { type, message };
  if (typeof e.stack === "string") {
    // A stack's header line is `<name>: <message>` — and the DB-error messages
    // just sanitized are (multi-line) SQL + params. Keeping the raw stack would
    // re-leak them, so when the message was sanitized, rebuild the stack from
    // only its call frames under a sanitized header.
    out.stack = messageSanitized
      ? [
          `${type}: ${message}`,
          ...e.stack.split("\n").filter((line) => /^\s*at\s/.test(line)),
        ].join("\n")
      : e.stack;
  }
  for (const key of SAFE_SCALAR_ERR_KEYS) {
    const value = e[key];
    if (typeof value === "string" || typeof value === "number") {
      out[key] = value;
    }
  }
  if (e.cause != null && depth < MAX_CAUSE_DEPTH) {
    out.cause = sanitizeError(e.cause, depth + 1);
  }
  return out;
}

/**
 * Application logger configuration using Pino.
 *
 * Configuration is controlled via environment variables:
 * - LOG_LEVEL: trace, debug, info, warn, error, fatal (default: info)
 * - LOG_FORMAT: pretty or json (default: pretty)
 *
 * Pretty format: Human-readable, colorized output for development
 * JSON format: Structured logs for production parsing/aggregation
 */
export const logger = pino({
  level: environment.LOG_LEVEL,
  base: {
    service: "portalai-api",
    env: environment.NODE_ENV,
    version: environment.BUILD_SHA,
  },
  transport:
    environment.LOG_FORMAT === "pretty"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss Z",
            ignore: "pid,hostname,service,env,version",
          },
        }
      : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  serializers: {
    // #540: PII-safe error serializer — never emits DB-error value fields.
    // Registered for both keys errors are logged under across the codebase.
    err: sanitizeError,
    error: sanitizeError,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  redact: {
    paths: [
      "*.password",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
      "*.idToken",
      "*.id_token",
      "*.apiKey",
      "*.api_key",
      "*.clientSecret",
      "*.client_secret",
      "*.secret",
      "*.authorization",
      // #540: DB-error value fields — defense-in-depth behind the `err`
      // serializer above (which already allowlists these away). Scoped to the
      // `err`/`err.cause` paths, not `*.`, so unrelated fields that legitimately
      // carry a `detail`/`query` key are never censored.
      "err.detail",
      "err.where",
      "err.table",
      "err.column",
      "err.constraint",
      "err.internalQuery",
      "err.query",
      "err.parameters",
      "err.raw",
      "err.cause.detail",
      "err.cause.where",
      "err.cause.table",
      "err.cause.column",
      "err.cause.constraint",
    ],
    censor: "[REDACTED]",
  },
});

/**
 * Create a logger bound to a static context (e.g. `{ module: "auth" }`).
 *
 * The returned logger is lazy: on every property access it resolves the
 * active request logger from AsyncLocalStorage (if any) and builds a child
 * with `context`. When called from a request scope, logs inherit `reqId`
 * and `userId` from `req.log`; when called from a worker, queue, or
 * startup path, they fall back to the root logger.
 *
 * @example
 * const routeLogger = createLogger({ module: 'auth' });
 * routeLogger.info('User logged in');
 */
export const createLogger = (context: Record<string, unknown>): pino.Logger => {
  const resolve = (): pino.Logger => {
    const base = requestContext.getStore()?.log ?? logger;
    return base.child(context);
  };

  return new Proxy({} as pino.Logger, {
    get(_target, prop, receiver) {
      const resolved = resolve() as unknown as Record<PropertyKey, unknown>;
      const value = resolved[prop];
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(resolved)
        : Reflect.get(resolved, prop, receiver);
    },
  });
};
