# Outbound fetches past the SSRF guard — Spec

This spec pins the contract for #931. One primitive, `guardedFetch`, checks every connection to an org-supplied URL at connect time and applies a per-caller redirect policy. Custom toolpacks (registration, refresh, PATCH, demo seed, runtime) and the REST API connector (every request it makes) use it. Discovery: `docs/TOOLPACK_REDIRECT_SSRF.discovery.md`. Issue: [#931](https://github.com/EnterpriseBT/portal-ai/issues/931), amended to include the REST connector.

## Key decisions (flag for review)

1. **Connect-time check through the global `fetch`.**
   - `guardedFetch` calls `globalThis.fetch(url, { ...init, redirect: "manual", dispatcher: GUARDED_AGENT })`.
   - `GUARDED_AGENT` is an undici `Agent` whose `connect.lookup` resolves every address and refuses the connection if any is disallowed. The socket then connects to the checked address, so there's no second lookup and no rebinding window.
   - This was verified on Node 22.23.4: its bundled undici is 6.29.1, a userland `Agent` of the same version is honoured, the lookup runs per connection, the refusal surfaces as `err.cause` with its code intact, and `redirect: "manual"` returns the real 3xx.
   - The suites that mock `globalThis.fetch` keep working, because the mock ignores `dispatcher`.
2. **An IP literal needs a per-hop static check.** `net.connect` never calls `lookup` for an IP-literal host, so `guardedFetch` checks a literal before each hop with the same `isAllowedIp` rule.
3. **Redirect policy per caller.**
   - **Toolpacks refuse every 3xx**, with a new `TOOLPACK_REDIRECT_REFUSED`.
   - **REST follows by hand** up to 5 hops, applying fetch's method rules. On a cross-origin hop it keeps only an allow-list of harmless headers, so auth headers, the HMAC headers and cookies never follow.
4. **Fail closed.** A lookup failure, a disallowed address, a refused redirect or a hop-limit overflow fails the request. The only bypass is the dev/rollback flag. That flag is renamed `TOOLPACK_DISABLE_SSRF_FILTER` → **`DISABLE_OUTBOUND_URL_GUARD`**, because it now covers REST too. There's no alias (a clean cut, and no deployed env sets it). It disables only the address check, never the redirect policy.
5. **Loopback stays allowed when `NODE_ENV !== "production"`**, as today, so local mocks and the smoke walks keep working.
6. **The REST refusal is a non-retryable code.** `withRetry` replays a `REST_API_FETCH_FAILED` that has no `status` as a network failure, so a refusal maps to a new `REST_API_URL_BLOCKED`, which is never retried.
7. **A runtime refusal is a typed tool result.** The agent relays `{ error: { code, message } }`, the same shape as `webhookCallbackRefusal`, instead of a thrown string.
8. **`assertUrlSafeToFetch` is deleted**, along with its callers; its job moves into `guardedFetch`. `validateToolpackUrl` (the static check, used by the Zod contract) stays.

## Scope

### In scope
- `guardedFetch` and its lookup, the static per-hop check and the redirect loop.
- Toolpack registration, refresh, PATCH and demo-seed fetches; the runtime webhook call; the REST connector's `fetchJson` and `streamFetchRecords` defaults, and so every REST request: probe, preview, test connection, sync, and pagination next-URLs.
- The new ApiCodes, the flag rename, error-body hygiene in `parseJson`, the guard test, and the docs.

### Out of scope
- Fixed vendor hosts (Google, Microsoft Graph `nextLink`, Mapbox, GitHub, the SNS `SubscribeURL`).
- Per-org or residency egress allow-lists (`allowHosts`): the option bag leaves room; no caller yet.
- Network-layer egress controls (VPC egress proxy, metadata blocking): an ops ticket.

## Surface

### `apps/api/src/utils/guarded-fetch.util.ts` (new)

```ts
export type RedirectPolicy = "refuse" | { max: number };

export interface GuardedFetchOptions {
  redirects: RedirectPolicy;
}

export type OutboundBlockReason =
  | "unsupported-scheme"   // a hop's URL isn't http(s)
  | "private-address"      // a literal, or any resolved address, fails isAllowedIp
  | "unresolvable"         // the lookup failed or returned nothing
  | "redirect-refused"     // a 3xx under redirects: "refuse"
  | "too-many-redirects"   // more than max hops
  | "unreplayable-body";   // a 307/308 with a body that can't be resent (a stream)

export class OutboundFetchBlockedError extends Error {
  readonly name = "OutboundFetchBlockedError";
  constructor(
    readonly reason: OutboundBlockReason,
    readonly url: string,      // the hop that was refused
    readonly status?: number   // the 3xx, for redirect reasons
  );
}

export async function guardedFetch(
  url: string,
  init: RequestInit,
  opts: GuardedFetchOptions
): Promise<Response>;

/** Walks err, err.cause, … and returns the first OutboundFetchBlockedError. */
export function findOutboundBlock(err: unknown): OutboundFetchBlockedError | null;

/** Exported for tests: the connect-time lookup over an injectable resolver. */
export function createGuardedLookup(
  resolve: (host: string) => Promise<Array<{ address: string; family: number }>>,
  allowLoopback: () => boolean
): LookupFunction; // node:net's lookup signature, handling options.all
```

**Behaviour, per hop:**
1. `new URL(current)`. A protocol other than `http:`/`https:` → `unsupported-scheme`. An IP-literal host (brackets stripped) that fails `isAllowedIp(host, allowLoopback)` → `private-address`. Both checks are skipped when `DISABLE_OUTBOUND_URL_GUARD` is set.
2. `globalThis.fetch(current, { ...hopInit, redirect: "manual", dispatcher })`. The dispatcher is `GUARDED_AGENT`, a module singleton, or `undefined` when the flag is set.
   - A rejection whose cause chain holds an `OutboundFetchBlockedError` rethrows that error. Any other rejection propagates unchanged, so callers' network-failure mapping stays as it is.
3. A status of 301, 302, 303, 307 or 308 **with** a `Location` header:
   - **`"refuse"`:** cancel the body and throw `redirect-refused` (`url` = this hop, `status`).
   - **`{ max }`:** on hop `max + 1`, throw `too-many-redirects`. Otherwise cancel the body and resolve `Location` against `current`.
     - 303, or 301/302 on a POST → method `GET`, no body, and `content-type`/`content-length` dropped.
     - 307/308 keep the method and body; a body that isn't a `string`, `Buffer` or `Uint8Array`, or `undefined`, → `unreplayable-body`.
     - When the new origin differs from the **original** URL's origin, headers are reduced to the allow-list `accept`, `accept-language`, `user-agent`, plus `content-type` when a body is kept.
     - Loop to 1.
4. Any other response (including a 3xx without `Location`) is returned as-is. `init.signal` carries across hops, so callers' timeouts still bound the whole chain.

**`GUARDED_AGENT`** = `new Agent({ connect: { lookup: createGuardedLookup(defaultResolve, () => environment.NODE_ENV !== "production") } })`.
- `defaultResolve` is `dns.lookup(host, { all: true, verbatim: true })`.
- The lookup fails with `OutboundFetchBlockedError("unresolvable", …)` on a resolver error or an empty result. If **any** address fails `isAllowedIp`, it fails with `private-address`, carrying the host only (never the resolved address) in `.message`.
- Otherwise it returns every address when `options.all` is set, else the first.
- `isAllowedIp` moves here from `url-safety.util.ts`, unchanged (ipaddr.js `range() === "unicast"`, plus `"loopback"` when allowed).

### `apps/api/src/utils/url-safety.util.ts` (edit)
- Delete `assertUrlSafeToFetch`, `SsrfBlockedError` and `isAllowedIp`; import `isAllowedIp` from `guarded-fetch.util.ts` for `isPrivateHostnameLiteral`.
- `validateToolpackUrl` is unchanged.
- The header comment describes the two layers: static at the contract, connect-time in `guardedFetch`.

### `apps/api/src/environment.ts` (edit)
- `TOOLPACK_DISABLE_SSRF_FILTER` is replaced by `DISABLE_OUTBOUND_URL_GUARD: process.env.DISABLE_OUTBOUND_URL_GUARD === "true"`.
- `subprocessor-egress-parity.test.ts` classifies the new name `DEV_ONLY` and drops the old one.

### `apps/api/src/constants/api-codes.constants.ts` (edit)
- `TOOLPACK_REDIRECT_REFUSED`: the toolpack server answered a redirect, which toolpack URLs don't follow. Register the final URL instead. 502.
- `REST_API_URL_BLOCKED`: a REST request was refused before it was sent (a private address, an unsupported scheme, too many redirects or an unreplayable body). 502. Never retried.

### Toolpack registration (`apps/api/src/services/toolpack-registration.service.ts`, edit)
- `fetchWithCap` calls `guardedFetch(url, { method: "GET", headers, signal }, { redirects: "refuse" })` in place of `assertUrlSafeToFetch` plus `fetch`.
- `OutboundFetchBlockedError` maps as follows, in `fetchSchema`, and in `fetchMetadata`, which now throws on these instead of returning `null`:
  | reason | ApiError |
  |---|---|
  | `private-address` | 502 `TOOLPACK_URL_PRIVATE_HOST`, "The toolpack URL ${url} resolves to an address that isn't public." |
  | `redirect-refused` | 502 `TOOLPACK_REDIRECT_REFUSED`, "The toolpack server at ${url} answered with a redirect (${status}). Toolpack URLs aren't followed through redirects; register the final URL." |
  | `unresolvable` | 502 `TOOLPACK_SCHEMA_FETCH_FAILED`, "Could not resolve the host of ${url}." |
  | `unsupported-scheme` | 502 `TOOLPACK_SCHEMA_FETCH_FAILED` (unreachable in practice: the contract already requires http(s)) |
  - `details: { url, reason, status? }`. The `url` is the hop as registered, never a redirect `Location`.
- `parseJson`'s message becomes "The toolpack response from ${url} is not valid JSON." The parse reason is dropped, because it quotes the body.
- Routes, the demo seed and the OpenAPI blocks for register, PATCH and refresh list `TOOLPACK_REDIRECT_REFUSED` under 502.

### Runtime webhook (`apps/api/src/services/tools.service.ts` `callWebhook`, `apps/api/src/tools/webhook.tool.ts`, edit)
- `callWebhook` calls `guardedFetch(implementation.url, { method: "POST", headers, body, signal }, { redirects: "refuse" })`. A blocked fetch throws an `ApiError` with the same table as above, keyed `TOOLPACK_URL_PRIVATE_HOST` / `TOOLPACK_REDIRECT_REFUSED` / `TOOLPACK_SCHEMA_FETCH_FAILED`.
- `webhook.tool.ts` catches those three codes from `callWebhook` and **returns** `{ error: { code, message } }`, with the message naming the tool's slug. Every other error still throws.

### REST connector (`apps/api/src/adapters/rest-api/fetch.util.ts`, `stream.util.ts`, edit)
- New `restFetch: typeof globalThis.fetch = (url, init) => guardedFetch(String(url), init ?? {}, { redirects: { max: 5 } })`, exported from `fetch.util.ts`.
- It becomes the default `fetchImpl` of `fetchJson` and `streamFetchRecords`. Injected `fetchImpl`s in tests are unchanged.
- In both `catch` blocks around `fetchImpl(url, init)`, `findOutboundBlock(err)` maps to `ApiError(502, REST_API_URL_BLOCKED, message, { url, reason, status? })`, checked **before** `networkFailure`.
  - `private-address`: "This connection's URL resolves to an address that isn't public."
  - `too-many-redirects`: "The endpoint redirected more than 5 times."
  - `unsupported-scheme`: "The endpoint redirected to a URL that isn't http or https."
  - `unreplayable-body`: "The endpoint redirected a request whose body can't be resent."
- `withRetry` doesn't replay it, because its code isn't `REST_API_FETCH_FAILED`.
- A response that passed the guard keeps today's error detail (`responseBody`, headers): it came from a public host the org chose.

### Guard test (`apps/api/src/__tests__/outbound-fetch.guard.test.ts`, new)
- Scans `services/toolpack-registration.service.ts`, `services/tools.service.ts` and `adapters/rest-api/**/*.ts`.
- Fails on a call to `fetch(` or `globalThis.fetch(`, or a reference to `globalThis.fetch` as a default, outside `guarded-fetch.util.ts`. `fetchImpl(` calls are allowed.
- Its `EXEMPT` list starts empty.

### Docs
- **`docs/CUSTOM_TOOLPACK_INTEGRATION.md` (URL requirements, troubleshooting table):** redirects aren't followed (`TOOLPACK_REDIRECT_REFUSED`), every connection is checked at connect time, and the rebinding sentence is now true.
- **`docs/DEPLOYMENT_SECURITY_REVIEW.md` (§1 egress, :32, :124):** REST connections and webhook toolpacks are both checked at connect time; redirect policy per surface.
- **`apps/api/README.md` env table and `apps/api/.env.example`:** the flag rename.
- **`docs/LOCAL_DEVELOPMENT.md:57`:** confirm the loopback note still reads true; name the new flag if it mentions one.

## Migration
None. No schema change.

## Seed
None.

## TDD test plan

Run from `apps/api`: `npm run test:unit -- --testPathPattern <file>` and `npm run test:integration -- --testPathPattern <file>`.

### `src/__tests__/utils/guarded-fetch.util.test.ts` (new, unit, real local `http` servers on 127.0.0.1)
1. A 200 from loopback in non-prod is returned.
2. `createGuardedLookup` with a resolver returning `10.0.0.5` → `private-address`; with `[public, 169.254.169.254]` → `private-address` (any address fails); with a public address → that address; with `options.all` → the list.
3. A resolver error, or an empty list → `unresolvable`.
4. Through the real global fetch: `http://localhost:<port>/` is refused with `private-address` when `NODE_ENV=production` (`jest.replaceProperty`), and the local server sees no request. This is the case that proves the global fetch honours the dispatcher.
5. `http://10.0.0.1/` and `http://[::ffff:127.0.0.1]/` literals → `private-address`, with no request made.
6. `ftp://…` → `unsupported-scheme`.
7. `"refuse"` + 302 → `redirect-refused` with `status` 302 and `url` = the first hop.
8. `{max: 5}` + 302 → 302 → 200 returns the 200 and makes 3 requests.
9. `{max: 2}` + three 302s → `too-many-redirects`.
10. A redirect to `http://10.0.0.1/` → `private-address`, with no request to it.
11. A POST + 303 → GET, no body. A POST + 302 → GET. A POST + 307 → POST with the same body.
12. A 307 with a `ReadableStream` body → `unreplayable-body`.
13. A cross-origin hop (127.0.0.1 → localhost on another port) receives only `accept`/`user-agent`, not `authorization`, `x-api-key` or `x-portalai-signature`. A same-origin hop keeps them all.
14. `DISABLE_OUTBOUND_URL_GUARD` lets `10.0.0.1` through the static check but still refuses redirects under `"refuse"`.
15. `findOutboundBlock` finds the error two levels deep, and returns `null` otherwise.
16. A 3xx without `Location` is returned as-is.

### `src/__tests__/utils/url-safety.util.test.ts` (edit)
- Remove the `assertUrlSafeToFetch` cases (now covered above). The `validateToolpackUrl` cases are unchanged.

### `src/__tests__/services/toolpack-registration.service.test.ts` (edit; global fetch mocked)
17. `fetch` is called with `redirect: "manual"` and a `dispatcher`.
18. A mocked 302 → `TOOLPACK_REDIRECT_REFUSED`, `details.status` 302, and the `Location` appears nowhere in the error.
19. `fetchMetadata` with a 302 throws `TOOLPACK_REDIRECT_REFUSED` (it doesn't return `null`).
20. A fetch rejecting with an `OutboundFetchBlockedError("private-address")` cause → `TOOLPACK_URL_PRIVATE_HOST`.
21. A non-JSON body `"SECRET-BODY…"` → `TOOLPACK_SCHEMA_INVALID`, whose message doesn't contain `SECRET`.
- Remove the url-safety module stub.

### `src/__tests__/services/tools.service.test.ts` and `src/__tests__/tools/webhook.tool.test.ts` (edit)
22. `callWebhook` with a mocked 302 → `TOOLPACK_REDIRECT_REFUSED`.
23. `callWebhook` with a blocked cause → `TOOLPACK_URL_PRIVATE_HOST`.
24. The webhook tool returns `{error: {code: "TOOLPACK_REDIRECT_REFUSED", message}}` naming the slug, and doesn't throw.
25. Other `callWebhook` errors still throw.

### `src/__tests__/adapters/rest-api/fetch.util.test.ts`, `stream.util.test.ts` (edit; `fetchImpl` injected)
26. `fetchJson` with a `fetchImpl` rejecting with a blocked cause → `REST_API_URL_BLOCKED` with `details.reason`.
27. The same through `withRetry` → one attempt (not retried).
28. `streamFetchRecords` with a blocked cause → `REST_API_URL_BLOCKED`.
29. The default `fetchImpl` is `restFetch` (identity check).

### `src/__tests__/outbound-fetch.guard.test.ts` (new)
30. The real tree passes.
31. Embedded fixtures: a bare `fetch(` and a `= globalThis.fetch` default each fail; `fetchImpl(` passes.

### Integration (`npm run test:integration`)
32. `toolpacks.router.integration.test.ts`: `POST /api/toolpacks` whose schema fetch answers 302 (strict fetch mock) → 502 `TOOLPACK_REDIRECT_REFUSED`, nothing persisted.
33. The same suite: refresh of a registered toolpack whose server now answers 302 → 502, row unchanged.
34. `rest-api.probe.integration.test.ts`: a probe against `http://10.255.255.1/` (no mock; the real `restFetch`) → 502 `REST_API_URL_BLOCKED`, `details.reason: "private-address"`.
35. `connector-instances.test-connection.integration.test.ts`: test connection against a private literal → `REST_API_URL_BLOCKED`.

### Parity
36. `subprocessor-egress-parity.test.ts` passes with the renamed flag.

**Totals ≈ 36 cases** (16 primitive, 5 registration, 4 runtime, 4 REST, 2 guard, 4 integration, 1 parity).

## Acceptance criteria

- [ ] A toolpack whose schema, metadata or runtime URL answers any 3xx fails with `TOOLPACK_REDIRECT_REFUSED` (registration, refresh and PATCH as a 502 with nothing persisted; at runtime as a typed tool result), and no request reaches the `Location`.
- [ ] A toolpack or REST URL whose host resolves to any non-public address is refused before a connection is made, including when the address only appears on a later lookup (rebinding) or a redirect hop.
- [ ] A REST connection follows up to 5 redirects through public hosts. A cross-origin hop carries no auth, cookie or signature headers. A sixth redirect fails with `REST_API_URL_BLOCKED`.
- [ ] A refused REST request isn't retried, and its error carries no response body.
- [ ] Toolpack registration errors never quote response-body bytes.
- [ ] Local dev against `localhost` mocks still works with no flag set. `DISABLE_OUTBOUND_URL_GUARD=true` disables only the address check.
- [ ] The integration doc and the deployment security review describe the connect-time check and the redirect policy, and no doc names `TOOLPACK_DISABLE_SSRF_FILTER`.

## Risks & rollback

- **Fail mode: closed.** A misclassified public address would fail a legitimate toolpack or REST connection. Detection: `TOOLPACK_URL_PRIVATE_HOST` / `REST_API_URL_BLOCKED` in logs, and job errors for syncs. The emergency bypass is `DISABLE_OUTBOUND_URL_GUARD=true` (ECS env), which keeps the redirect policy.
- **REST connections that relied on redirects to private hosts stop working.** That's the point. Public redirect chains of 5 hops or fewer keep working.
- **undici version drift.** If a future Node bundles an undici the userland `Agent` doesn't fit, the dispatcher could be ignored or rejected. Unit case 4 (a refusal through the real global fetch) fails in CI on the Node bump, before deploy.
- **Toolpacks behind redirects:** none are registered in prod or app-dev (confirmed 2026-10-31).
- **Rollback:** revert the PR. No data shape changes.

## Files touched

- **New:** `apps/api/src/utils/guarded-fetch.util.ts`, `apps/api/src/__tests__/utils/guarded-fetch.util.test.ts`, `apps/api/src/__tests__/outbound-fetch.guard.test.ts`.
- **Edit (API source):**
  - `apps/api/package.json` (`undici` `^6.29.1`, matching Node 22's bundled version) and the lockfile;
  - `apps/api/src/utils/url-safety.util.ts`, `apps/api/src/environment.ts`, `apps/api/src/constants/api-codes.constants.ts`;
  - `apps/api/src/services/toolpack-registration.service.ts`, `apps/api/src/services/tools.service.ts`, `apps/api/src/tools/webhook.tool.ts`;
  - `apps/api/src/adapters/rest-api/fetch.util.ts`, `apps/api/src/adapters/rest-api/stream.util.ts`;
  - `apps/api/src/routes/toolpacks.router.ts` (OpenAPI 502 lists).
- **Edit (tests):** the unit and integration suites named in the test plan, and `subprocessor-egress-parity.test.ts`.
- **Edit (docs):** `docs/CUSTOM_TOOLPACK_INTEGRATION.md`, `docs/DEPLOYMENT_SECURITY_REVIEW.md`, `apps/api/README.md`, `apps/api/.env.example`, `docs/LOCAL_DEVELOPMENT.md` (if needed).

## Next step

`docs/TOOLPACK_REDIRECT_SSRF.plan.md` sequences this into about five TDD slices on `fix/931-toolpack-redirect-ssrf`:
1. `guardedFetch`, the dependency, the flag rename and the codes;
2. toolpack registration and body hygiene;
3. the runtime webhook and typed refusal;
4. the REST connector;
5. the guard test, the deletion of `assertUrlSafeToFetch`, and the docs.
