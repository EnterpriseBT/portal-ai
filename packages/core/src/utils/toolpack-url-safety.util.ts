/**
 * Sync URL validation for custom-toolpack endpoint URLs — phase 6.
 *
 * Mirror of `apps/api/src/utils/url-safety.util.ts`'s
 * `validateToolpackUrl` half. Lives in `packages/core` so the Zod
 * refinement on `ToolpackEndpointsSchema` can call it from the
 * contract layer (which mustn't depend on `apps/api`). The
 * authoritative DNS-rebinding-resistant guard is the call-time
 * validator in `apps/api/src/utils/url-safety.util.ts` — this
 * function only catches obvious mistakes at registration time so
 * the UI can give immediate feedback.
 *
 * `process.env.NODE_ENV` is read at call time. In Node it's the
 * runtime env; in a browser bundle Vite inlines it via `define` —
 * the validator should never run client-side, but if it ever does
 * the `production` default keeps it strict.
 */

import ipaddr from "ipaddr.js";

const DEV_HTTP_HOSTS = new Set(["localhost", "127.0.0.1"]);

export type UrlSafetyErrorCode =
  | "TOOLPACK_URL_INVALID"
  | "TOOLPACK_URL_NOT_HTTPS"
  | "TOOLPACK_URL_PRIVATE_HOST";

export interface UrlValidationError {
  code: UrlSafetyErrorCode;
  message: string;
}

export function validateToolpackUrl(raw: string): UrlValidationError | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { code: "TOOLPACK_URL_INVALID", message: "URL is not parseable" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      code: "TOOLPACK_URL_INVALID",
      message: "URL must use http or https",
    };
  }
  const isProd = (process.env.NODE_ENV ?? "production") === "production";
  if (isProd && parsed.protocol !== "https:") {
    return {
      code: "TOOLPACK_URL_NOT_HTTPS",
      message: "Toolpack URLs must use https in production",
    };
  }
  const hostname = stripIPv6Brackets(parsed.hostname);
  if (
    !isProd &&
    parsed.protocol === "http:" &&
    !DEV_HTTP_HOSTS.has(hostname)
  ) {
    return {
      code: "TOOLPACK_URL_NOT_HTTPS",
      message: "http URLs are only allowed for localhost in non-production",
    };
  }
  if (isProd && hostname === "localhost") {
    return {
      code: "TOOLPACK_URL_PRIVATE_HOST",
      message: "Toolpack URLs cannot target localhost in production",
    };
  }
  if (ipaddr.isValid(hostname)) {
    try {
      if (ipaddr.parse(hostname).range() !== "unicast") {
        return {
          code: "TOOLPACK_URL_PRIVATE_HOST",
          message: `IP ${hostname} is not in a public unicast range`,
        };
      }
    } catch {
      return {
        code: "TOOLPACK_URL_INVALID",
        message: `IP literal ${hostname} could not be parsed`,
      };
    }
  }
  return null;
}

function stripIPv6Brackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;
}
