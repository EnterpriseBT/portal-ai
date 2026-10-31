/**
 * Outbound fetches to org-supplied URLs (#931).
 *
 * Every request to a URL an organization chose (a custom toolpack's
 * endpoints, a REST connection's API) goes through `guardedFetch`. It
 * keeps those requests on the public internet in two ways:
 *
 *   1. A connect-time address check. The global fetch is given a
 *      dispatcher whose DNS lookup resolves the host, refuses the
 *      connection if any address isn't public unicast, and hands the
 *      socket the address it checked. Every TCP connection the request
 *      makes is checked, and the address checked is the address
 *      connected to, so DNS rebinding has no window. An IP-literal host
 *      never reaches a lookup (`net.connect` skips it), so each hop's
 *      literal is checked statically first.
 *   2. A redirect policy per caller. Redirects are handled here, never by
 *      fetch: `"refuse"` fails on any 3xx (toolpacks, whose URLs are
 *      registered exactly), and `{ max }` follows up to `max` hops, each
 *      hop re-checked, keeping only harmless headers when the origin
 *      changes (the REST connector).
 *
 * Loopback is allowed outside production, so local mock servers work.
 * `DISABLE_OUTBOUND_URL_GUARD=true` turns off the address check (dev and
 * emergency rollback); the redirect policy still applies.
 */

import dns from "dns/promises";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

import { environment } from "../environment.js";

export type RedirectPolicy = "refuse" | { max: number };

export interface GuardedFetchOptions {
  redirects: RedirectPolicy;
}

export type OutboundBlockReason =
  | "unsupported-scheme"
  | "private-address"
  | "unresolvable"
  | "redirect-refused"
  | "too-many-redirects"
  | "unreplayable-body";

/** Why an outbound request was refused, and at which hop. */
export class OutboundFetchBlockedError extends Error {
  readonly name = "OutboundFetchBlockedError";

  constructor(
    readonly reason: OutboundBlockReason,
    readonly url: string,
    readonly status?: number
  ) {
    // The trailing reason tag lets `findOutboundBlock` recognise this error
    // after it crosses a realm boundary, where it arrives rebuilt as a plain
    // Error carrying only `String(err)` (seen under Jest's VM modules).
    super(`${describe(reason, url, status)} [${reason}]`);
  }
}

const REASONS: ReadonlySet<string> = new Set<OutboundBlockReason>([
  "unsupported-scheme",
  "private-address",
  "unresolvable",
  "redirect-refused",
  "too-many-redirects",
  "unreplayable-body",
]);

const REBUILT = /^OutboundFetchBlockedError: .* \[([a-z-]+)\]$/s;

function describe(
  reason: OutboundBlockReason,
  url: string,
  status?: number
): string {
  switch (reason) {
    case "unsupported-scheme":
      return `${url} isn't an http or https URL`;
    case "private-address":
      return `${url} resolves to an address that isn't public`;
    case "unresolvable":
      return `The host of ${url} could not be resolved`;
    case "redirect-refused":
      return `${url} answered with a redirect (${status})`;
    case "too-many-redirects":
      return `${url} redirected too many times`;
    case "unreplayable-body":
      return `${url} redirected a request whose body can't be resent`;
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Headers that may follow a request to a different origin. */
const CROSS_ORIGIN_HEADERS = new Set([
  "accept",
  "accept-language",
  "user-agent",
]);

/**
 * Fetch `url` with the connect-time address check and the given redirect
 * policy. Throws `OutboundFetchBlockedError` when a hop is refused; any
 * other failure propagates as the global fetch raised it.
 */
export async function guardedFetch(
  url: string,
  init: RequestInit,
  opts: GuardedFetchOptions
): Promise<Response> {
  const max = opts.redirects === "refuse" ? 0 : opts.redirects.max;
  const originalOrigin = safeOrigin(url);
  let current = url;
  let hopInit: RequestInit = init;

  for (let hop = 0; ; hop++) {
    assertHopAllowed(current);

    let response: Response;
    try {
      response = await fetch(current, {
        ...hopInit,
        redirect: "manual",
        dispatcher: environment.DISABLE_OUTBOUND_URL_GUARD
          ? undefined
          : guardedAgent(),
      } as RequestInit);
    } catch (err) {
      const block = findOutboundBlock(err);
      if (block) throw new OutboundFetchBlockedError(block.reason, current);
      throw err;
    }

    const location = response.headers.get("location");
    if (!REDIRECT_STATUSES.has(response.status) || !location) {
      return response;
    }

    await response.body?.cancel().catch(() => undefined);
    if (opts.redirects === "refuse") {
      throw new OutboundFetchBlockedError(
        "redirect-refused",
        current,
        response.status
      );
    }
    if (hop + 1 > max) {
      throw new OutboundFetchBlockedError(
        "too-many-redirects",
        current,
        response.status
      );
    }

    const next = new URL(location, current).toString();
    hopInit = redirectInit(hopInit, response.status, current);
    if (safeOrigin(next) !== originalOrigin) {
      hopInit = { ...hopInit, headers: crossOriginHeaders(hopInit) };
    }
    current = next;
  }
}

/**
 * The first `OutboundFetchBlockedError` in `err`'s cause chain, if any,
 * including one rebuilt as a plain Error by a realm crossing (its `url` is
 * then empty; `guardedFetch` fills in the hop).
 */
export function findOutboundBlock(
  err: unknown
): OutboundFetchBlockedError | null {
  let cur: unknown = err;
  for (let depth = 0; depth < 10 && cur; depth++) {
    if (cur instanceof OutboundFetchBlockedError) return cur;
    // Duck-typed: a rebuilt error is from another realm, so it isn't an
    // instance of this realm's Error either.
    const message =
      typeof cur === "object" && cur !== null
        ? (cur as { message?: unknown }).message
        : undefined;
    const tag =
      typeof message === "string" ? REBUILT.exec(message)?.[1] : undefined;
    if (tag && REASONS.has(tag)) {
      return new OutboundFetchBlockedError(tag as OutboundBlockReason, "");
    }
    cur =
      typeof cur === "object" && cur !== null
        ? (cur as { cause?: unknown }).cause
        : undefined;
  }
  return null;
}

/**
 * The connect-time lookup: resolve every address, refuse if any isn't
 * allowed, otherwise answer with the checked address(es). The resolver is
 * injectable for tests.
 */
export function createGuardedLookup(
  resolve: (
    host: string
  ) => Promise<Array<{ address: string; family: number }>>,
  allowLoopback: () => boolean
): LookupFunction {
  return (hostname, options, callback) => {
    const all = typeof options === "object" && options?.all === true;
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          return callback(
            new OutboundFetchBlockedError("unresolvable", hostname) as never,
            "",
            0
          );
        }
        const loopback = allowLoopback();
        if (addresses.some((a) => !isAllowedIp(a.address, loopback))) {
          return callback(
            new OutboundFetchBlockedError("private-address", hostname) as never,
            "",
            0
          );
        }
        if (all) {
          (callback as unknown as (e: null, a: typeof addresses) => void)(
            null,
            addresses
          );
        } else {
          callback(null, addresses[0].address, addresses[0].family);
        }
      },
      () =>
        callback(
          new OutboundFetchBlockedError("unresolvable", hostname) as never,
          "",
          0
        )
    );
  };
}

/**
 * Whether `ip` may be connected to: ipaddr.js `unicast` only, plus
 * loopback when allowed. Private (RFC1918), link-local (cloud metadata),
 * ULA, IPv4-mapped, multicast and reserved ranges all fall outside it.
 */
export function isAllowedIp(ip: string, allowLoopback: boolean): boolean {
  if (!ipaddr.isValid(ip)) return false;
  try {
    const range = ipaddr.parse(ip).range();
    if (range === "unicast") return true;
    return allowLoopback && range === "loopback";
  } catch {
    return false;
  }
}

// ── Internals ──────────────────────────────────────────────────────

let agent: Agent | null = null;

function guardedAgent(): Agent {
  agent ??= new Agent({
    connect: {
      lookup: createGuardedLookup(
        (host) => dns.lookup(host, { all: true, verbatim: true }),
        () => environment.NODE_ENV !== "production"
      ),
    },
  });
  return agent;
}

/** The static half of the per-hop check: scheme, and an IP-literal host. */
function assertHopAllowed(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new OutboundFetchBlockedError("unsupported-scheme", raw);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new OutboundFetchBlockedError("unsupported-scheme", raw);
  }
  if (environment.DISABLE_OUTBOUND_URL_GUARD) return;
  const host = parsed.hostname.replace(/^\[(.*)\]$/, "$1");
  if (
    ipaddr.isValid(host) &&
    !isAllowedIp(host, environment.NODE_ENV !== "production")
  ) {
    throw new OutboundFetchBlockedError("private-address", raw);
  }
}

/** Fetch's method rules for a followed redirect. */
function redirectInit(
  init: RequestInit,
  status: number,
  url: string
): RequestInit {
  const method = (init.method ?? "GET").toUpperCase();
  const toGet =
    (status === 303 && method !== "HEAD") ||
    ((status === 301 || status === 302) && method === "POST");
  if (toGet) {
    const headers = new Headers(init.headers);
    headers.delete("content-type");
    headers.delete("content-length");
    const { body: _body, ...rest } = init;
    return { ...rest, method: "GET", headers };
  }
  const body = init.body;
  if (
    body !== undefined &&
    body !== null &&
    typeof body !== "string" &&
    !(body instanceof Uint8Array)
  ) {
    throw new OutboundFetchBlockedError("unreplayable-body", url, status);
  }
  return init;
}

function crossOriginHeaders(init: RequestInit): Headers {
  const kept = new Headers();
  const keepContentType = init.body !== undefined && init.body !== null;
  new Headers(init.headers).forEach((value, key) => {
    if (
      CROSS_ORIGIN_HEADERS.has(key) ||
      (keepContentType && key === "content-type")
    ) {
      kept.set(key, value);
    }
  });
  return kept;
}

function safeOrigin(raw: string): string {
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}
