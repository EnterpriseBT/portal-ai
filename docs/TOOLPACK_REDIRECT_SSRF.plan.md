# Outbound fetches past the SSRF guard — Plan

**This plan builds `guardedFetch` (a connect-time address check plus a per-caller redirect policy) and moves every fetch to an org-supplied URL onto it: the toolpack registration fetches, the runtime webhook, then the REST connector. The last slice removes the old guard and fixes the docs. Every slice is test-first.**

Spec: `docs/TOOLPACK_REDIRECT_SSRF.spec.md`. Discovery: `docs/TOOLPACK_REDIRECT_SSRF.discovery.md`. Issue: #931. It builds on #911's registration fetchers (`fetchWithCap`, `signatureRejection`).

There are 5 slices. Each one sits behind a green test suite and leaves the repo compilable. They land as **commits on `fix/931-toolpack-redirect-ssrf`**: one fix, one PR (#932).

Run tests from `apps/api` (never jest directly):

```bash
cd apps/api && npm run test:unit -- --testPathPattern <file>
cd apps/api && npm run test:integration -- --testPathPattern <file>
```

Each slice:
1. Write the failing tests.
2. Make the smallest change that turns them green.
3. Run the focused suites.
4. Run `npm run lint && npm run type-check` (apps/api) at the boundary.

**Sequencing rationale:**
1. **The primitive comes first.** It's a leaf: nothing calls it yet, so it ships alone with its full unit suite. The flag rename and the ApiCodes land here so later slices only consume them.
2. **Toolpack registration is next.** It's the reported bug, and its error mapping (`OutboundFetchBlockedError` → ApiError) is reused by slice 3.
3. **The runtime webhook** reuses slice 2's mapping and adds the typed tool result.
4. **The REST connector** is independent of 2–3, but it's the widest blast radius (many suites mock fetch), so it lands after the toolpack paths are proven.
5. **Cleanup and lock-in.** Removing `assertUrlSafeToFetch` is only possible once slices 2–3 stop calling it. The guard test can only pass once every caller has moved.

---

## Slice 1 — `guardedFetch` primitive, dependency, flag and codes

Delivers `guarded-fetch.util.ts` exactly as the spec's Surface describes, with nothing wired to it yet. Also delivers the flag rename and the two ApiCodes.

**Files**

- **New:** `apps/api/src/utils/guarded-fetch.util.ts`. It holds `guardedFetch`, `OutboundFetchBlockedError`, `findOutboundBlock`, `createGuardedLookup`, the `GUARDED_AGENT` singleton and `isAllowedIp`. For now, copy `isAllowedIp` rather than moving it; slice 5 deletes the original.
- **New:** `apps/api/src/__tests__/utils/guarded-fetch.util.test.ts`.
- **Edit:**
  - `apps/api/package.json`: add `undici` `^6.29.1`. Run `npm install` from the root, so the lockfile records the direct dependency (6.29.1 is already hoisted).
  - `apps/api/src/environment.ts`: `TOOLPACK_DISABLE_SSRF_FILTER` → `DISABLE_OUTBOUND_URL_GUARD`.
  - `apps/api/src/utils/url-safety.util.ts`: read the renamed flag.
  - `apps/api/src/__tests__/services/tools.service.test.ts`: its env stub at `:120` uses the renamed key.
  - `subprocessor-egress-parity.test.ts`: classify the new name `DEV_ONLY`.
  - `apps/api/README.md` and `apps/api/.env.example`: the flag row and comment.
  - `apps/api/src/constants/api-codes.constants.ts`: add `TOOLPACK_REDIRECT_REFUSED` and `REST_API_URL_BLOCKED`, with JSDoc.

**Steps**

1. **Tests (spec cases 1–16, 36).**
   - Run real `http` servers on `127.0.0.1` with ephemeral ports.
   - Test `createGuardedLookup` with an injected resolver for cases 2–3.
   - Toggle `NODE_ENV` and `DISABLE_OUTBOUND_URL_GUARD` with `jest.replaceProperty(environment, …)` for cases 4 and 14.
   - Run them; they fail (the module is missing).
2. **Implement** the module: the per-hop static check, the fetch with `redirect: "manual"` and the dispatcher, the redirect loop (method rules, cross-origin header allow-list, `Location` resolution), and the cause-chain unwrap. Green.
3. Run lint and type-check.

**Done when:**
- Cases 1–16 pass, including case 4 (a refusal through the real global `fetch`, which proves the dispatcher is honoured).
- The parity test passes.
- No production code imports the new module yet.

**Risk:** The cross-origin case (13) needs two origins. `127.0.0.1:<a>` → `localhost:<b>` counts as cross-origin and both are loopback, so it's allowed in tests. Make sure the servers close in `afterAll`, so Jest doesn't hang on open handles.

---

## Slice 2 — Toolpack registration through `guardedFetch`

Registration, refresh, PATCH and the demo seed refuse redirects and private addresses, and stop quoting response bodies.

**Files**

- **Edit:** `apps/api/src/services/toolpack-registration.service.ts`.
  - `fetchWithCap` → `guardedFetch(…, { redirects: "refuse" })`.
  - Add a `blockedToApiError(url, err)` helper implementing the spec's mapping table. It's exported for slice 3.
  - `fetchSchema` and `fetchMetadata` map a blocked fetch, and `fetchMetadata` now throws on one.
  - `parseJson` drops the parse reason.
- **Edit:** `apps/api/src/routes/toolpacks.router.ts`: the `@openapi` 502 descriptions for register, PATCH and refresh name `TOOLPACK_REDIRECT_REFUSED`.
- **Edit tests:**
  - `apps/api/src/__tests__/services/toolpack-registration.service.test.ts`: remove the url-safety stub.
  - `apps/api/src/__tests__/__integration__/routes/toolpacks.router.integration.test.ts`.

**Steps**

1. **Tests (spec cases 17–21, 32, 33).**
   - Unit: the mocked global `fetch` asserts `redirect: "manual"` and a `dispatcher`.
   - A mocked 302 response gives `TOOLPACK_REDIRECT_REFUSED`, with no `Location` in the error.
   - A metadata 302 throws.
   - A rejection with a blocked cause gives `TOOLPACK_URL_PRIVATE_HOST`.
   - A non-JSON body isn't echoed.
   - Integration: the strict fetch mock answers 302 on `/schema` for register (nothing persisted) and for refresh (the row is unchanged).
   - Run them; they fail.
2. **Implement.** Green. Re-run the existing #911 cases in both suites (the signature mapping and the strict HMAC mock); they still pass.
3. Run lint and type-check.

**Done when:**
- Cases 17–21, 32 and 33 pass, along with the existing registration, router and demo-seed suites.
- `toolpack-registration.service.ts` no longer imports `assertUrlSafeToFetch`.

**Risk:** The demo-seed integration suite drives these fetchers through its own fetch mock. Its mocked responses are 200s, so it should be unaffected; run it in this slice anyway.

---

## Slice 3 — Runtime webhook: refused fetches become a typed tool result

**Files**

- **Edit:** `apps/api/src/services/tools.service.ts`.
  - `callWebhook` → `guardedFetch(…, { redirects: "refuse" })`, mapping a blocked fetch with slice 2's `blockedToApiError`.
  - Delete the `assertUrlSafeToFetch` call and its import.
- **Edit:** `apps/api/src/tools/webhook.tool.ts`. Catch `TOOLPACK_URL_PRIVATE_HOST`, `TOOLPACK_REDIRECT_REFUSED` and `TOOLPACK_SCHEMA_FETCH_FAILED` from `callWebhook` and return `{ error: { code, message } }`, with the message naming the slug, beside `webhookCallbackRefusal`. Grants are still revoked in `finally`.
- **Edit tests:** `apps/api/src/__tests__/services/tools.service.test.ts` (drop the url-safety stub at `:160-167`), `apps/api/src/__tests__/tools/webhook.tool.test.ts`.

**Steps**

1. **Tests (spec cases 22–25).** Run them; they fail.
2. **Implement.** Green. The cost-gate guard test and the tool-wrapping guard tests still pass: the tool returns a value, so a custom tool's call is charged 0 as before.
3. Run lint and type-check.

**Done when:** Cases 22–25 pass, the existing tools and webhook suites stay green, and nothing in `apps/api/src` calls `assertUrlSafeToFetch` any more.

**Risk:** None beyond the mapping. The output-grant `finally` cleanup path is unchanged.

---

## Slice 4 — REST connector through `guardedFetch`

Every REST request (probe, preview, test connection, sync, pagination) goes through `restFetch` with up to 5 redirects.

**Files**

- **Edit:** `apps/api/src/adapters/rest-api/fetch.util.ts`.
  - Export `restFetch` and make it `fetchJson`'s default `fetchImpl`.
  - Map a blocked fetch in its `catch` to `REST_API_URL_BLOCKED`, before `networkFailure`.
- **Edit:** `apps/api/src/adapters/rest-api/stream.util.ts`: the same default and mapping in `streamFetchRecords`.
- **Edit tests:**
  - `apps/api/src/__tests__/adapters/rest-api/fetch.util.test.ts`, `stream.util.test.ts`, `retry.util.test.ts` (or `fetch-first-page.util.test.ts`, for "not retried");
  - `apps/api/src/__tests__/__integration__/connectors/rest-api.probe.integration.test.ts`;
  - `apps/api/src/__tests__/__integration__/routes/connector-instances.test-connection.integration.test.ts`.

**Steps**

1. **Tests (spec cases 26–29, 34, 35).** The two integration cases use a private literal (`http://10.255.255.1/`) with **no** fetch mock, so they exercise the real `restFetch` and are refused before any connection. Run them; they fail.
2. **Implement.** Green. Then run every suite that mocks `globalThis.fetch` for REST: the integration suites for `rest-api.*`, `api-endpoints.discover-columns`, `connector-instances.probe-endpoint-draft` and `rest-api-endpoint-entity-read.authorization`, plus the unit suites `fetch-first-page.util` and `rest-api.adapter`.
   - Their mocks ignore `dispatcher` and return non-3xx responses, so they should pass unchanged.
   - Any mock that returns a 3xx now goes through the manual loop. Adjust that test's expectation rather than the code.
3. Run lint and type-check.

**Done when:**
- Cases 26–29, 34 and 35 pass.
- Every REST suite that mocks `fetch` is green.
- `adapters/rest-api/**` has no `globalThis.fetch` default left.

**Risk:**
- This slice touches the most suites. Several of them `jest.spyOn(globalThis, "fetch")` and inspect the call arguments, and a strict `toHaveBeenCalledWith(url, init)` now sees `redirect` and `dispatcher` too. Loosen those assertions to `expect.objectContaining` in the test files only.
- The test-connection route may surface errors differently. Assert the code, not the message.

---

## Slice 5 — Guard test, remove the old guard, docs

**Files**

- **New:** `apps/api/src/__tests__/outbound-fetch.guard.test.ts`, which scans the three source areas and includes embedded fixtures.
- **Edit:**
  - `apps/api/src/utils/url-safety.util.ts`: delete `assertUrlSafeToFetch`, `SsrfBlockedError` and the local `isAllowedIp`, and import `isAllowedIp` from `guarded-fetch.util.ts`. Rewrite the header comment (the two layers, and no rebinding claim it can't keep).
  - `apps/api/src/__tests__/utils/url-safety.util.test.ts`: drop the `assertUrlSafeToFetch` block.
  - `docs/CUSTOM_TOOLPACK_INTEGRATION.md`: URL requirements say redirects aren't followed (`TOOLPACK_REDIRECT_REFUSED`) and every connection is checked at connect time. Add a troubleshooting row for `TOOLPACK_REDIRECT_REFUSED`.
  - `docs/DEPLOYMENT_SECURITY_REVIEW.md` §1 (`:32`, `:124`): both REST connections and webhook toolpacks are checked at connect time; redirect policy per surface.
  - `docs/LOCAL_DEVELOPMENT.md:57`: confirm the loopback note and name the new flag if it names one.

**Steps**

1. **Tests (spec cases 30–31).** Write the guard test with fixtures. The real tree passes because slices 2–4 moved every caller. Mutation-check it: a temporary bare `fetch(` in `tools.service.ts` must fail it, then revert.
2. **Implement** the deletion and the docs. `npm run lint:doc-pointers` still passes, since the edited docs are durable ones.
3. Run the full root `npm run build && npm run type-check && npm run lint && npm run format:check`.

**Done when:**
- Cases 30–31 pass.
- `grep -r "assertUrlSafeToFetch\|SsrfBlockedError\|TOOLPACK_DISABLE_SSRF_FILTER" apps packages docs --include=*.ts --include=*.md` finds only this ticket's phase docs.
- The full root checks are green.

**Risk:** `permission-copy.guard` scans the durable `docs/`, so keep the new copy permission-framed (no role names).

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | `guardedFetch` + `undici` + flag rename + 2 codes | cases 1–16, 36 |
| 2 | Toolpack registration/refresh/PATCH/demo seed | cases 17–21, 32–33; #911 suites green |
| 3 | Runtime webhook + typed refusal | cases 22–25 |
| 4 | REST connector (all requests) | cases 26–29, 34–35; all fetch-mocking REST suites green |
| 5 | Guard test, old guard removed, docs | cases 30–31; full root build/type-check/lint/format |

## Cross-slice notes

- **`blockedToApiError`** is defined in slice 2 and imported by slice 3. REST has its own mapping (different code and copy), in slice 4.
- **The loopback rule:** `guardedFetch` reads `environment.NODE_ENV` per connection, the same rule as today, so the local mock toolpack and the smoke walks still work with no flag. Your local `apps/api/.env` sets `TOOLPACK_DISABLE_SSRF_FILTER=true`; after slice 1, rename it (or drop it, since loopback is already allowed).
- **Docs in the same PR:** the flag docs in slice 1, the API-facing docs in slice 5. The OpenAPI 502 lists are in slice 2, beside the code that emits the new code.
- **No migration, no core change:** the static contract check (`packages/core` `toolpack-url-safety.util.ts`) is untouched, so no core rebuild is needed.
- **The smoke doc** comes after slice 5 (`/smoke 931`). It needs a mock toolpack that 302s, a REST connection at a private literal, and a public redirect chain for REST, which the mock server can provide on loopback.

## Next step

Implementation begins on `fix/931-toolpack-redirect-ssrf` with slice 1, tests first, one commit per slice.
