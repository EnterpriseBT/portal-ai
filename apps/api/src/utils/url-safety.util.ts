/**
 * Static URL validation for custom toolpack endpoints.
 *
 * Outbound requests to org-supplied URLs are guarded in two layers:
 *
 *   1. Static validation (`validateToolpackUrl`, here) — sync, no DNS.
 *      Catches obvious mistakes at registration time: wrong scheme,
 *      `http://` outside the localhost dev escape hatch, raw IP
 *      literals in private ranges. The contract's Zod refinement on
 *      `ToolpackEndpointsSchema` uses core's copy of this check.
 *
 *   2. The connect-time check (`guardedFetch`, `guarded-fetch.util.ts`,
 *      #931) — every connection a toolpack or REST request makes is
 *      resolved and refused if any address isn't public, connecting to
 *      the address it checked, and redirects follow the caller's policy.
 *      This is the boundary; this file only gives early feedback.
 */

import ipaddr from "ipaddr.js";

import { environment } from "../environment.js";
import { isAllowedIp } from "./guarded-fetch.util.js";

const DEV_HTTP_HOSTS = new Set(["localhost", "127.0.0.1"]);

export type UrlSafetyErrorCode =
  | "TOOLPACK_URL_INVALID"
  | "TOOLPACK_URL_NOT_HTTPS"
  | "TOOLPACK_URL_PRIVATE_HOST";

export interface UrlValidationError {
  code: UrlSafetyErrorCode;
  message: string;
}

/**
 * Sync URL validation suitable for Zod refinements. Returns `null`
 * when the URL is acceptable, or a structured error code/message
 * otherwise. Does NOT resolve DNS — the connect-time guard
 * (`guardedFetch`) handles hostname resolution.
 */
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
  const isProd = environment.NODE_ENV === "production";
  if (isProd && parsed.protocol !== "https:") {
    return {
      code: "TOOLPACK_URL_NOT_HTTPS",
      message: "Toolpack URLs must use https in production",
    };
  }
  if (
    !isProd &&
    parsed.protocol === "http:" &&
    !DEV_HTTP_HOSTS.has(stripIPv6Brackets(parsed.hostname))
  ) {
    return {
      code: "TOOLPACK_URL_NOT_HTTPS",
      message: "http URLs are only allowed for localhost in non-production",
    };
  }
  if (isPrivateHostnameLiteral(parsed.hostname, isProd)) {
    return {
      code: "TOOLPACK_URL_PRIVATE_HOST",
      message: "URL hostname targets a private network",
    };
  }
  return null;
}

// ── Internals ──────────────────────────────────────────────────────

/** Back-compat shim used by the static-literal hostname check below. */
function isUnicastIp(ip: string): boolean {
  return isAllowedIp(ip, false);
}

/**
 * Sync hostname-literal check used by the static validator. Catches
 * the common cases without touching DNS:
 *  - `localhost` (only in production; non-prod allows it via the
 *    HTTPS gate's localhost escape hatch)
 *  - IPv4 / IPv6 literals in non-unicast ranges
 */
function isPrivateHostnameLiteral(host: string, isProd: boolean): boolean {
  const stripped = stripIPv6Brackets(host);
  if (isProd && stripped === "localhost") return true;
  if (ipaddr.isValid(stripped)) return !isUnicastIp(stripped);
  return false;
}

/** Strip the `[...]` wrapping that URL puts on IPv6 hostnames. */
function stripIPv6Brackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}
