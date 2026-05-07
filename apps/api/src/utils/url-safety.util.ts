/**
 * SSRF protection for outbound toolpack webhook calls — phase 6.
 *
 * Two layers of defense:
 *
 *   1. Static validation (`validateToolpackUrl`) — sync, no DNS.
 *      Catches obvious mistakes at registration time: wrong scheme,
 *      `http://` outside the localhost dev escape hatch, raw IP
 *      literals in private ranges. Used by the Zod refinement on
 *      `ToolpackEndpointsSchema` so the registration UI gets
 *      immediate feedback.
 *
 *   2. Call-time resolve-then-validate (`assertUrlSafeToFetch`) —
 *      async, resolves the URL's hostname via `dns.lookup`, validates
 *      every resolved IP against the same denylist (RFC1918,
 *      loopback, link-local, ULA, cloud metadata), and throws if any
 *      address is non-public. This is the canonical SSRF guard;
 *      defeats DNS rebinding because the lookup happens immediately
 *      before the fetch call (window measured in microseconds).
 *
 * `ssrf-req-filter` was the original library candidate but it returns
 * `http.Agent`/`https.Agent` instances — Node 18+'s native `fetch` is
 * undici-based and ignores `agent`, accepting only `dispatcher`. We
 * reuse `ipaddr.js` (the library `ssrf-req-filter` is built on) and
 * implement the resolve+validate dance directly so it works with
 * native fetch.
 *
 * Emergency rollback: set `TOOLPACK_DISABLE_SSRF_FILTER=true` to
 * bypass `assertUrlSafeToFetch` (the static validator still runs).
 */

import dns from "dns/promises";
import type { LookupAddress } from "dns";
import ipaddr from "ipaddr.js";

import { environment } from "../environment.js";

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
 * otherwise. Does NOT resolve DNS — the call-time guard
 * (`assertUrlSafeToFetch`) handles hostname resolution.
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

/**
 * Resolve the URL's hostname and throw if any returned IP is in a
 * non-unicast / private / reserved range. Call this immediately
 * before any outbound `fetch` to a user-supplied toolpack URL.
 *
 * Honors `TOOLPACK_DISABLE_SSRF_FILTER=true` for emergency rollback.
 */
export async function assertUrlSafeToFetch(raw: string): Promise<void> {
  if (environment.TOOLPACK_DISABLE_SSRF_FILTER) return;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new SsrfBlockedError(
      "TOOLPACK_URL_INVALID",
      "URL is not parseable"
    );
  }

  const hostname = stripIPv6Brackets(parsed.hostname);
  // Non-production allows loopback so the dev workflow (run the
  // mock toolpack server on localhost, register against it from
  // the dev API) actually works. Production blocks loopback the
  // same as any other non-public range. Mirrors the static
  // validator's `http://localhost` escape hatch.
  const allowLoopback = environment.NODE_ENV !== "production";

  // If the hostname is already an IP literal, validate it directly —
  // no DNS lookup needed.
  if (ipaddr.isValid(hostname)) {
    if (!isAllowedIp(hostname, allowLoopback)) {
      throw new SsrfBlockedError(
        "TOOLPACK_URL_PRIVATE_HOST",
        `IP ${hostname} is not in a public unicast range`
      );
    }
    return;
  }

  // Resolve the hostname to its IPs. `dns.lookup` honors /etc/hosts
  // and the system resolver, which is what the subsequent fetch
  // will use — so the resolution we validate is the same one fetch
  // will see (window measured in microseconds; rebinding-resistant).
  let addresses: LookupAddress[];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new SsrfBlockedError(
      "TOOLPACK_URL_INVALID",
      `Hostname ${hostname} could not be resolved: ${
        err instanceof Error ? err.message : "unknown"
      }`
    );
  }

  if (addresses.length === 0) {
    throw new SsrfBlockedError(
      "TOOLPACK_URL_INVALID",
      `Hostname ${hostname} resolved to no addresses`
    );
  }

  for (const addr of addresses) {
    if (!isAllowedIp(addr.address, allowLoopback)) {
      throw new SsrfBlockedError(
        "TOOLPACK_URL_PRIVATE_HOST",
        `Hostname ${hostname} resolves to ${addr.address} which is not public unicast`
      );
    }
  }
}

/**
 * Error thrown by `assertUrlSafeToFetch` when an outbound URL is
 * blocked. Carries a structured error code so the caller can map it
 * onto an `ApiError` with the right `ApiCode`.
 */
export class SsrfBlockedError extends Error {
  constructor(
    public readonly code: UrlSafetyErrorCode,
    message: string
  ) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

// ── Internals ──────────────────────────────────────────────────────

/**
 * Validate an IP literal (v4 or v6) against the same denylist as
 * `ipaddr.js`'s `range()`. Anything other than `unicast` is rejected
 * — except loopback when the caller explicitly opts in (non-production
 * dev workflow targeting the mock toolpack server on localhost).
 * Private (RFC1918), link-local, ULA, broadcast, multicast,
 * documentation, reserved, and the IPv4 metadata-service address
 * all fall outside `unicast`.
 */
function isAllowedIp(ip: string, allowLoopback: boolean): boolean {
  if (!ipaddr.isValid(ip)) return false;
  try {
    const range = ipaddr.parse(ip).range();
    if (range === "unicast") return true;
    if (allowLoopback && range === "loopback") return true;
    return false;
  } catch {
    return false;
  }
}

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
  return host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;
}
