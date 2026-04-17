import pino from "pino";
import { environment } from "../environment.js";
import { requestContext } from "./request-context.util.js";

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
    err: pino.stdSerializers.err,
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
