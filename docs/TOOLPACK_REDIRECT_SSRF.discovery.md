# Outbound fetches past the SSRF guard — Discovery

**Issue:** [EnterpriseBT/portal-ai#931](https://github.com/EnterpriseBT/portal-ai/issues/931)

**Why this exists.** Custom toolpack URLs are checked once by `assertUrlSafeToFetch` (DNS resolve, refuse any non-public address), then fetched with Node's global `fetch` and its default `redirect: "follow"`. A toolpack server that answers `302 Location: http://169.254.169.254/…` (or any internal host) is followed without a second check. The response then reaches the caller:
- **Registration:** a prefix of the body leaks through the `JSON.parse` reason in the 502.
- **Runtime:** a 302/303 turns the webhook POST into a GET, and a JSON body comes back verbatim as the tool result, so the agent and user see it.

The check also resolves DNS separately from `fetch`, so a rebinding host can pass the check and then connect somewhere else. The integration doc claims the opposite.

The survey found the same class of hole, wider, in the **REST API connector**: it calls `fetch` against an org-supplied `baseUrl` with **no** SSRF check at all, follows redirects and pagination next-URLs, and echoes response bodies in its errors.

This is the fix that makes "an org-supplied URL can only reach the public internet" true for every hop and every connection, not just for the URL as typed.

## The current shape

### The guard

| Piece | Location | Note |
|---|---|---|
| `validateToolpackUrl` (static, no DNS) | `apps/api/src/utils/url-safety.util.ts:56-93`; core copy `packages/core/src/utils/toolpack-url-safety.util.ts:36`, wired into `ToolpackEndpointsSchema` at `packages/core/src/models/organization-toolpack.model.ts:43-61` | http(s) only, https in prod, private IP literals refused |
| `assertUrlSafeToFetch(raw): Promise<void>` | `url-safety.util.ts:102-163` | `dns.lookup(…, {all: true, verbatim: true})` (:138), every address must pass `isAllowedIp` (:191-201: ipaddr.js `unicast`, plus `loopback` when `NODE_ENV !== "production"`). Returns nothing, so the fetch can't pin to what was checked. Skipped entirely when `TOOLPACK_DISABLE_SSRF_FILTER` is set (:103) |
| Header comment | `url-safety.util.ts:1-30` | Claims the call-time lookup "defeats DNS rebinding", which it doesn't. It also records why `ssrf-req-filter` was rejected: it returns `http.Agent`s, which native fetch (undici) can't use; fetch takes a `dispatcher` |
| `SsrfBlockedError` | `url-safety.util.ts:170-178` | `.code`: `TOOLPACK_URL_INVALID` / `_NOT_HTTPS` / `_PRIVATE_HOST` |

### Who fetches org-supplied URLs

No fetch in `apps/api` sets `redirect:`, so every one follows redirects.

| Path | Location | Guard | What of the response reaches the caller |
|---|---|---|---|
| Toolpack schema/metadata (register, PATCH, refresh, demo seed) | `fetchWithCap`, `toolpack-registration.service.ts:68-140`; callers `toolpacks.router.ts:459/471, 625/635, 828/838`, `demo-seed.service.ts:454/463` | yes, first URL only (:77) | Parsed tools. On a parse failure, `parseJson` (:142-153) puts the `JSON.parse` reason, which quotes the body, in a 502 `TOOLPACK_SCHEMA_INVALID`. `describeFirstZodIssue` (:225) can echo values |
| Toolpack runtime webhook | `ToolService.callWebhook`, `tools.service.ts:411-465` | yes, first URL only (:420) | The parsed JSON body, verbatim, as the tool result. A raw `SsrfBlockedError` propagates with no ApiCode. The HMAC and custom auth headers are forwarded on a cross-origin redirect (undici strips only `Authorization`/`Cookie`/`Proxy-Authorization`) |
| Custom-tool consumption modes (#124) | `apps/api/src/tools/webhook.tool.ts:197-302` | via `callWebhook` | Pull-on-read is inbound (the webhook calls our API), so there's no extra outbound fetch |
| **REST API connector** | `adapters/rest-api/fetch.util.ts:48-55` (`fetchJson`), `stream.util.ts:89-100`; callers `fetch-first-page.util.ts:115/303`, `rest-api.adapter.ts:449` | **none** (`baseUrl` is only `z.string().url()`, `api-connector.contract.ts:119`) | Records are materialized into entity data. Non-OK responses put `responseBody` and headers in the error details (`fetch.util.ts:63-75`); invalid JSON echoes the parse message (:116-121). Pagination next-URLs from the response (`pagination/link-body.iterator.ts`) get no host check |
| Fixed vendor hosts (GitHub, Google, Mapbox, Microsoft Graph `nextLink`, the SNS `SubscribeURL` after its signature check) | various | n/a | Out of scope: the host isn't org-chosen |

### Runtime, deps, tests, docs

- **Node and undici:** Node ≥ 22 (`package.json` engines, `node:22-alpine` images). `undici` is only a transitive dependency (6.29.1, through `@ai-sdk/provider-utils`). No dispatcher, `Agent` or `lookup` override exists anywhere in `apps/api/src`.
- **Tests:**
  - `url-safety.util.test.ts:85-135` covers IP literals and localhost only; DNS is never mocked.
  - The registration and runtime unit tests stub the whole url-safety module (`toolpack-registration.service.test.ts:22-27`, `tools.service.test.ts:160-167`).
  - The router integration test mocks global fetch with no SSRF assertion, so "integration tests exercise the real SSRF path" (`tools.service.test.ts:163`) isn't true.
  - No test covers a 3xx anywhere.
- **Docs that are wrong today:**
  - `docs/CUSTOM_TOOLPACK_INTEGRATION.md:414` says rebinding is defeated and "the call connects only to the resolved IP".
  - `docs/DEPLOYMENT_SECURITY_REVIEW.md:32/:124` says webhook toolpacks are "SSRF-checked" and lists REST connections beside them, though REST has no check.
  - `apps/site` security claims don't mention SSRF, so they need no change.
- **Egress parity:** `subprocessor-egress-parity.test.ts:153` classifies `TOOLPACK_DISABLE_SSRF_FILTER` as `DEV_ONLY`, so any new flag must be classified there.

## The design space

### Decision 1 — Where the check runs

- **A. Check each redirect hop.** Keep the pre-flight lookup, set `redirect: "manual"`, and re-run `assertUrlSafeToFetch` on each `Location`. This closes redirects but not rebinding: two lookups remain per hop.
- **B. Check at connect time.** Give fetch an undici `Agent` whose `connect.lookup` resolves the host, refuses the connection if any address is disallowed, and hands the checked address to the socket. Every TCP connection the fetch makes is checked, including redirect hops, retries and keep-alive reconnects, and the address checked is the address connected to.
- **C. Both.** B as the boundary, plus an explicit redirect policy on top.

| | A | B | C |
|---|---|---|---|
| Closes redirect bypass | yes | yes | yes |
| Closes DNS rebinding | no | yes | yes |
| Covers callers that forget to opt in | no | only if every caller uses the dispatcher | same as B |
| New dependency | none | `undici` direct, used with its own `fetch` | same as B |
| Clear error on a 3xx | yes | the refusal surfaces as a connect error, so the message must be mapped | yes |

**Lean: C.** The connect-time lookup is the real boundary, and it's the only option that makes the integration doc's rebinding claim true. An explicit redirect policy on top keeps the errors legible and stops signed and auth headers from following a cross-origin redirect.

### Decision 2 — Redirect policy

- **A. Refuse every 3xx** (`redirect: "manual"`, and a 3xx fails with a code naming the redirect).
- **B. Follow manually up to N hops,** same-origin only.
- **C. Follow manually up to N hops,** any public host, removing the signature and auth headers on a cross-origin hop.

Toolpack URLs are registered exactly and signed per request, so a redirect is never needed there. REST APIs do legitimately redirect (http→https, trailing slash, a CDN host).

**Lean: per-caller policy, one primitive.** Toolpacks use **A**. The REST connector uses **C** with N = 5 (OQ1), since every hop still passes the connect-time check from Decision 1.

### Decision 3 — The primitive's shape

- **A. A `guardedFetch(url, init, { redirects: "refuse" | { max } })`** in `apps/api/src/utils/`: undici `fetch` with a module-level guarded `Agent`, the manual redirect loop, and typed errors (`OutboundFetchBlockedError` with a reason of `private-address`, `redirect-refused`, `too-many-redirects` or `invalid-url`). Every org-URL caller imports it. A guard test fails CI on a bare `fetch(` in the org-URL modules.
- **B. Set the global dispatcher** (`setGlobalDispatcher`) to the guarded agent, so every fetch in the process is checked.

| | A | B |
|---|---|---|
| Blast radius | only org-URL callers | every vendor call (Anthropic, Stripe, Auth0, AWS SDK over fetch), so loopback/VPC endpoints and the dev proxies break |
| Enforced by | a guard test listing the modules | the runtime |

**Lean: A.** A global dispatcher would refuse VPC endpoints, the local s3mock and the e2e Anthropic stub. The guard test keeps a new org-URL path from slipping past the primitive.

### Decision 4 — What a refusal or bad response tells the caller

Today's leaks:
- a body prefix in `TOOLPACK_SCHEMA_INVALID`;
- values in Zod issue text;
- REST `responseBody` in error details;
- a raw `SsrfBlockedError` at runtime.

**Lean:**
- Registration and REST errors name the URL, the status and the failure class, never body bytes. Drop the `JSON.parse` reason. Keep REST's `responseBody` only when the request went to the public host the org registered, and never on a refused or redirected hop.
- The runtime maps a refusal to a typed tool result with a new `TOOLPACK_URL_PRIVATE_HOST` / `TOOLPACK_REDIRECT_REFUSED` message, rather than a thrown error string.

## Tradeoff comparison

|  | Check at connect time + redirect policy | Per-caller redirect policy | `guardedFetch` + guard test | Bodies never in errors |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| Contract change | none for valid toolpacks; a redirecting toolpack now fails | REST keeps working through ≤5 public hops | none | 502 messages get shorter |

## Recommendation

1. Add `undici` as a direct `apps/api` dependency and build `guardedFetch` in `apps/api/src/utils/guarded-fetch.util.ts`. It uses undici's own `fetch` with an `Agent` whose `connect.lookup` resolves all addresses, refuses if any is disallowed (`isAllowedIp`, the same loopback rule) and connects to a checked one.
2. `guardedFetch` takes `redirects: "refuse" | { max: number }`. It follows by hand when allowed, re-validates each `Location` statically, and on a cross-origin hop drops the `X-PortalAI-*` signature headers and any registered auth headers.
3. Toolpack registration, refresh, PATCH, the demo seed and the runtime webhook call `guardedFetch` with `redirects: "refuse"`. A 3xx fails with a new `TOOLPACK_REDIRECT_REFUSED` (502), naming the URL and the status but not the `Location`.
4. Fold `assertUrlSafeToFetch` into the primitive: the pre-flight check stays as a fast typed refusal for IP literals and unresolvable hosts, and the connect-time check is the boundary. `TOOLPACK_DISABLE_SSRF_FILTER` keeps disabling both (dev only).
5. Errors never carry response-body bytes. `parseJson` drops the parse reason, and a runtime refusal becomes a typed tool result.
6. A guard test fails CI on a bare `fetch(` in the org-URL modules (toolpack registration, the runtime webhook, the REST adapter).
7. Correct `CUSTOM_TOOLPACK_INTEGRATION.md` (URL requirements: redirects aren't followed; the rebinding claim becomes true) and `DEPLOYMENT_SECURITY_REVIEW.md` §1, and the url-safety header comment.
8. Tests:
   - unit tests for `guardedFetch` against a local server, with a hostname whose mocked lookup returns a private address, a 302 to a private address, a 302 to a public host under `refuse` vs `{max}`, and header stripping;
   - the registration and runtime suites stop stubbing url-safety;
   - an integration case registers against a redirecting server.

## Open questions

1. **Does the REST API connector join #931?** It has no SSRF guard at all, follows redirects and pagination next-URLs, and echoes response bodies. It's the same fix through the same primitive, but it widens the ticket to a second adapter and its tests. **Resolved: yes** (confirmed 2026-10-31; #931 amended). Amend #931's repro and impact to name it, because shipping a guard for toolpacks while REST stays open leaves the bigger hole. REST uses `{ max: 5 }`, and pagination next-URLs go through `guardedFetch` like any other hop.
2. **Loopback outside production.** `allowLoopback` lets dev and test hit `localhost` mocks. Keep it, and keep `TOOLPACK_DISABLE_SSRF_FILTER` dev-only? **Resolved: keep both.** The connect-time check reads the same `NODE_ENV` rule, and the e2e stack and smoke walks depend on it.
3. **Toolpacks registered today against a URL that redirects** (for example an `http://` URL that answers 301 to https in non-prod, or a host that moved). They'd start failing to refresh and run. **Resolved: accept.** No custom toolpacks are registered in prod or app-dev (confirmed 2026-10-31), so nothing deployed breaks. Production already requires https, the failure names `TOOLPACK_REDIRECT_REFUSED` and the URL, and the fix is a PATCH to the final URL.
4. **Does the bundled `fetch` need replacing everywhere for undici version alignment?** **Resolved: no.** `guardedFetch` imports `fetch` and `Agent` from the same direct `undici` dependency, so they always match, and the global fetch is untouched elsewhere.

## Enterprise-scale considerations

- **Concurrency & correctness.** **Lean:** the guarded `Agent` is a module singleton with its own connection pool, and the lookup runs per connection, not per request. Keep-alive reuse is safe because a socket only exists after a checked connect. There's no check-then-act gap left: what's checked is the address connected to.
- **Accuracy & auditability.** **Lean:** log every refusal at warn with `orgId`, the toolpack or connector id, the URL host and the reason (never the resolved private address in a client-facing message; it's fine in the server log). There's no ledger need.
- **Failure modes.** **Lean: fail closed.** A lookup error, a disallowed address or a refused redirect fails the fetch. This is a security boundary, so there's no fail-open path. `TOOLPACK_DISABLE_SSRF_FILTER` stays the explicit, dev-only switch.
- **Scale & unbounded growth.** **Lean:** the redirect loop is capped (`max` ≤ 5 for REST, 0 for toolpacks). The body caps stay as they are (256 KB registration, `TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES` runtime), and the Agent's pool limits are explicit.
- **Multi-tenancy.** **Lean:** this is the tenancy fix. One org's URL can't reach our VPC, other orgs' data plane, or cloud metadata. The guard is per process, not per org, and that's correct.
- **Contract stability.** **Lean:** `guardedFetch`'s option bag (`redirects`, later `allowHosts` for a residency install's internal toolpacks) is the seam. The residency deploy mode can pass an allow-list without re-plumbing callers.
- **Data lifecycle.** N/A because nothing is stored.

## What this doesn't decide

- **Egress allow-lists per org or per residency install** (`allowHosts`). The seam exists; the feature waits for a caller.
- **Network-level egress controls** (a VPC egress proxy, security groups that block metadata). They're defense in depth at the infrastructure layer and a separate ops ticket. The application guard has to be correct either way.
- **IPv6-specific ranges beyond what ipaddr.js `range()` classifies.** We trust its `unicast` classification, as today.
- **The fixed vendor hosts** (Google, Graph `nextLink`, Mapbox, SNS). The host isn't org-chosen.

## Next step

`docs/TOOLPACK_REDIRECT_SSRF.spec.md` pins the following, then `docs/TOOLPACK_REDIRECT_SSRF.plan.md` slices the work into commits:
- `guardedFetch`'s signature and error type;
- the two new ApiCodes;
- each call site's policy;
- the guard test's module list;
- the doc edits.

Expect about five slices:
1. the `guardedFetch` primitive and its unit tests;
2. toolpack registration, refresh and PATCH, plus error-body hygiene;
3. the runtime webhook, plus a typed refusal result;
4. the REST connector, including pagination;
5. the guard test, docs and the security review.
