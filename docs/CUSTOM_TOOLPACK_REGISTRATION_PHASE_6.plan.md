# Custom Toolpack Registration — Phase 6 — Plan

**TDD-sequenced implementation of HMAC outbound signing, replay-window timestamps, idempotency request-IDs, SSRF filtering, HTTPS-only registration, runtime response cap, and the companion mock-server verifier.**

Spec: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_6.spec.md`. Phase 1–5: see the spec for back-references.

Phase 6 is materially larger than phases 1–5 (the audit's tier 1 + tier 2 minus delivery-resilience). The work splits cleanly into **three PRs** along risk boundaries:

- **PR 1 — Foundations.** Pure helpers, DB column + migration, contract refinement. Lands the primitives without changing wire behavior. Safe to ship alone.
- **PR 2 — Wire-up.** Outbound services start signing; routes return the secret once + rotation endpoint; mock server starts verifying. Atomic — the three slices must land together to keep the dev workflow consistent.
- **PR 3 — Frontend.** One-time secret display on registration; rotate button on edit dialog; SDK additions. Backend works without it (curl-driven), so this is independent.

Run tests with the project's npm scripts (per `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Migration commands (per `apps/api/README.md`):

```bash
cd apps/api && npm run db:migrate
cd apps/api && npm run scripts:migrate-signing-secrets   # added in slice 2
```

---

## Sequence summary

| PR | Slice | What lands | Tests added |
|---|---|---|---|
| 1 | 1 | URL safety + signing helpers (pure utils) + `ssrf-req-filter` dep | 8 (140–147) |
| 1 | 2 | Migration + repository encrypt/decrypt for `signingSecret` | 3 (149–151) |
| 1 | 3 | Contract refinement + model + new payload types | 1 (148) |
| 2 | 4 | Outbound services sign all three endpoint types; SSRF-safe agent; runtime size cap | 4 (152–155) |
| 2 | 5 | Routes: `signingSecret` once on POST + `POST /:id/rotate-signing-secret` | 2 (156–157) |
| 2 | 6 | Mock-server verification middleware | 3 (158–160) |
| 3 | 7 | Frontend: one-time secret display, rotate button, SDK + cache invalidation | 2 (web rendering) |

Total **23 new test cases** across the three PRs.

---

# PR 1 — Foundations

Three slices. Lands the primitives. No behavior change on the wire — the encrypted `signingSecret` column gets populated, but no service reads it yet (slice 4 onward). Safe to ship alone.

## Slice 1 — URL safety + signing helpers

Pure utility modules. No DB, no service wiring, no React.

**Files**

- New: `apps/api/src/utils/webhook-signing.util.ts`
- New: `apps/api/src/utils/url-safety.util.ts`
- New: `packages/core/src/utils/toolpack-url-safety.util.ts` (sync validator only — agent factory stays in `apps/api`)
- New: `apps/api/src/__tests__/utils/webhook-signing.util.test.ts`
- New: `apps/api/src/__tests__/utils/url-safety.util.test.ts`
- New: `packages/core/src/__tests__/utils/toolpack-url-safety.util.test.ts`
- Edit: `apps/api/package.json` — add `ssrf-req-filter` to `dependencies`

**Steps**

1. **Add the dep.** From `apps/api/`:
   ```bash
   npm install ssrf-req-filter
   ```
   Verify the version pins in `package.json` and `package-lock.json`. Re-run `npm run lint && npm run type-check` to make sure the package is resolvable.

2. **Write the failing tests for `webhook-signing.util.ts` (cases 140–142).**

   - 140: deterministic round-trip. With fixed `now: 1779000000000` and `webhookId: "11111111-..."`, calling `signRequest("test-secret", "hello")` produces a known hex digest the test asserts byte-for-byte. Recomputing `crypto.createHmac("sha256", "test-secret").update("1779000000.11111111-....hello").digest("hex")` independently in the test asserts the contract.
   - 141: variance. Three sub-asserts in one case: changing `webhookId`, `now`, or `body` each produces a different signature than case 140's baseline. Confirms the timestamp + id + body are all bound into the digest.
   - 142: `generateSigningSecret()` returns a string starting with `whsec_`; two consecutive calls produce different outputs; the post-prefix portion decodes from base64url to ≥ 32 bytes.

3. **Author `webhook-signing.util.ts`** per the spec. The two exported functions are `signRequest(secret, body, opts?)` and `generateSigningSecret()`. Both are pure; no I/O.

4. **Write the failing tests for `url-safety.util.ts` (cases 143–147).**

   - 143: `validateToolpackUrl("https://example.com/x")` returns `null`.
   - 144: `validateToolpackUrl("ftp://example.com")` returns `TOOLPACK_URL_INVALID`.
   - 145: HTTP gating. With `NODE_ENV=production`, `http://example.com` returns `TOOLPACK_URL_NOT_HTTPS`. With `NODE_ENV=development`, `http://localhost:4100` returns `null`. With `NODE_ENV=development`, `http://example.com` returns `TOOLPACK_URL_NOT_HTTPS` (only localhost gets the non-prod escape hatch). Use `jest.replaceProperty(environment, "NODE_ENV", "production" | "development")` to drive the env without leaking state across cases — `afterEach` resets.
   - 146: `validateToolpackUrl("http://10.0.0.5/x")` returns `TOOLPACK_URL_PRIVATE_HOST` (RFC1918 caught at the static layer regardless of HTTPS gating).
   - 147: `validateToolpackUrl("https://169.254.169.254/...")` returns `TOOLPACK_URL_PRIVATE_HOST`.

5. **Author `url-safety.util.ts`** per the spec. The static validator's `isPrivateHostnameLiteral` checks (in order):
   - hostname `localhost` → only blocked in production (the spec's HTTPS gate covers non-prod localhost separately).
   - IPv4 literal: regex `^(\d+)\.(\d+)\.(\d+)\.(\d+)$`. Block `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `0.0.0.0/8`.
   - IPv6 literal: hostname starts with `[` → strip brackets → block `::1`, `fc00::/7` (ULA), `fe80::/10` (link-local).
   - Anything else (DNS hostname): no block at this layer; the call-time agent does the resolve-then-validate dance.

6. **Author the agent factory** (`createSafeOutboundAgents()`). Wraps `ssrf-req-filter`'s `http:` and `https:` agent factories. The two agents are returned as a pair so callers can pass both to `fetch` (Node's fetch picks per-protocol).

7. **Mirror the static validator into `packages/core/src/utils/toolpack-url-safety.util.ts`.** The contract refinement (slice 3) needs to run in the contract package; `apps/api/src/utils/url-safety.util.ts` re-exports the core validator and adds the agent factory. Test the core validator independently — case 143–147 are duplicated here as `core` cases (Jest still runs them; ~6 quick cases). The duplication is intentional: the static validator runs in two places (apps/api routes for explicit error codes, packages/core contract layer for declarative refinement).

8. **Run the focused suites.**
   ```bash
   cd apps/api && npm run test:unit -- webhook-signing url-safety
   cd packages/core && npm run test -- toolpack-url-safety
   ```
   Cases 140–147 green. Lint + type-check clean.

**Done when:** all helper tests pass; `ssrf-req-filter` resolves at import; lint + type-check clean.

**Risk:** `ssrf-req-filter`'s API may have changed since the spec was written (the README is brief and the lib has multiple major versions). If the agent shape returned doesn't match `import("https").Agent`, wrap it in an adapter. The `dispatcher` API in undici/Node 18+ is a fallback if the lib's old http.Agent shape doesn't fit Node's modern fetch — note in the implementation if so.

---

## Slice 2 — DB column + migration + repository

Add the encrypted `signing_secret` column. Backfill existing rows via a one-shot Node script (the SQL migration leaves a sentinel; the script encrypts real secrets in place). Extend the repository's encrypt/decrypt helpers from phase 5 to also handle the new column.

**Files**

- New: `apps/api/drizzle/0051_add_toolpack_signing_secret.sql` (hand-written, like phase 5)
- New: `apps/api/src/scripts/migrate-signing-secrets.ts`
- Edit: `apps/api/drizzle/meta/_journal.json` (add idx 51 entry)
- Edit: `apps/api/src/db/schema/organization-toolpacks.table.ts`
- Edit: `apps/api/src/db/schema/type-checks.ts` (add `signingSecret` to `_OrgToolpackOpaqueCols`)
- Edit: `apps/api/src/db/repositories/organization-toolpacks.repository.ts`
- Edit: `apps/api/src/__tests__/__integration__/db/repositories/organization-toolpacks.repository.integration.test.ts` — cases 149–151
- Edit: `apps/api/src/constants/api-codes.constants.ts` — add `TOOLPACK_SIGNING_SECRET_NOT_INITIALIZED`
- Edit: `apps/api/package.json` — `scripts:migrate-signing-secrets` script entry

**Steps**

1. **Author the SQL migration.** Per the spec:
   ```sql
   ALTER TABLE "organization_toolpacks" ADD COLUMN "signing_secret" text;
   UPDATE "organization_toolpacks"
     SET "signing_secret" = '__pending_phase6_rotation__'
     WHERE "signing_secret" IS NULL;
   ALTER TABLE "organization_toolpacks"
     ALTER COLUMN "signing_secret" SET NOT NULL;
   ```
   File: `apps/api/drizzle/0051_add_toolpack_signing_secret.sql`. Comment block at the top per the convention in 0049/0050.

2. **Update the journal.** Add the idx 51 entry to `apps/api/drizzle/meta/_journal.json` matching the format used for idx 50.

3. **Edit the table.** In `organization-toolpacks.table.ts`:
   ```diff
        authHeaders: text("auth_headers"),
   +    signingSecret: text("signing_secret").notNull(),
        tools: jsonb("tools")
   ```
   Update the file-top comment block to mention the new column briefly (encrypted at rest, surfaced once at registration).

4. **Update type-checks.** In `db/schema/type-checks.ts`:
   ```diff
    type _OrgToolpackOpaqueCols =
      | "endpoints"
      | "authHeaders"
   +  | "signingSecret"
      | "tools"
      | "metadata";
   ```
   Comment block updated to mention `signing_secret` follows the same encrypted-at-rest pattern as `auth_headers`.

5. **Apply the migration locally.** `npm run db:migrate`. Verify via `db:studio` that `signing_secret` exists, NOT NULL, with the sentinel value on every row.

6. **Author the migration script.** `apps/api/src/scripts/migrate-signing-secrets.ts`:

   ```ts
   /**
    * One-shot script: replace every '__pending_phase6_rotation__'
    * sentinel value in organization_toolpacks.signing_secret with
    * a freshly-generated, encrypted real secret. Idempotent —
    * re-running is a no-op for already-real rows.
    *
    * Usage: cd apps/api && npm run scripts:migrate-signing-secrets
    */
   ```

   Logic:
   - Connect to `DATABASE_URL`, query rows where `signing_secret = '__pending_phase6_rotation__'`.
   - For each row: `generateSigningSecret()` → `encryptCredentials({ value: secret })` → write back. (We wrap the string in a `{ value }` object so it conforms to `encryptCredentials`'s `Record<string, unknown>` signature without changing crypto.util. The decrypt helper unwraps.)
   - Print progress: how many rows updated, how many already-real (sentinel-free) skipped.
   - Exit 0 on success.

7. **Add the script entry** to `apps/api/package.json`:
   ```json
   "scripts:migrate-signing-secrets": "dotenv -e .env -- tsx src/scripts/migrate-signing-secrets.ts"
   ```

8. **Run the script locally.** Should print "0 rows pending" on a fresh DB (since no toolpack rows existed before this migration). On the dev DB if any rows were carried over from phase 5, they should each get a real secret.

9. **Extend repository helpers.** In `organization-toolpacks.repository.ts`:

   ```ts
   const SIGNING_SECRET_SENTINEL = "__pending_phase6_rotation__";

   function decryptRow<
     T extends { authHeaders: string | null; signingSecret: string }
   >(row: T): T & {
     authHeaders: Record<string, string> | null;
     signingSecret: string;
   } {
     if (row.signingSecret === SIGNING_SECRET_SENTINEL) {
       throw new Error(
         `TOOLPACK_SIGNING_SECRET_NOT_INITIALIZED: row ${(row as any).id} ` +
         `still has the migration sentinel. Run scripts:migrate-signing-secrets.`
       );
     }
     const decrypted = decryptCredentials(row.signingSecret) as { value: string };
     return {
       ...row,
       authHeaders: row.authHeaders
         ? (decryptCredentials(row.authHeaders) as Record<string, string>)
         : null,
       signingSecret: decrypted.value,
     };
   }
   ```

   `encryptInsert` extends symmetrically: when the input has a string `signingSecret` field, wrap and encrypt; when undefined, leave alone (preserves prior ciphertext on partial updates).

10. **Write the failing tests (cases 149–151).**

    - 149: `repo.create({ ..., signingSecret: "whsec_test123" })` stores a ciphertext blob in `signing_secret` (the raw column does not contain `whsec_test123`); `findByIdScoped` returns `signingSecret === "whsec_test123"`.
    - 150: `findByOrganizationId` decrypts every row's `signingSecret`. Two rows, two distinct secrets, both round-trip.
    - 151: rotation flow: `repo.update(id, { signingSecret: "whsec_new" })` overwrites; old plaintext (`whsec_old`) no longer recoverable — `findByIdScoped` returns the new value. The raw blob differs byte-for-byte from the pre-update blob.

    Existing fixture `makeRow()` adds `signingSecret: "whsec_test_fixture"` so all pre-existing repository cases continue to pass — they don't assert on the new field but they need it set to satisfy NOT NULL.

11. **Run the focused suite.**
    ```bash
    npm run test:integration -- organization-toolpacks
    ```
    All 11 cases green (5 pre-existing + cases 130–134 from phase 5 + cases 149–151).

12. **Lint + type-check.**

**Done when:** migration applies; script replaces sentinels; cases 149–151 pass; existing repository tests stay green.

**Risk:** the sentinel-detection guard in `decryptRow` is the load-bearing safety against forgetting the script. CI should run the script as part of the post-migrate step in any deploy automation; until then, the sentinel-detection error surfaces loudly the first time anyone queries a toolpack post-deploy. Document in the PR description.

---

## Slice 3 — Contract refinement + model

Wire the static URL validator into `ToolpackEndpointsSchema` so registration rejects bad URLs at the contract layer. Extend the model with `signingSecret`. Add the new payload types for the rotation endpoint.

**Files**

- Edit: `packages/core/src/contracts/toolpack.contract.ts`
- Edit: `packages/core/src/models/organization-toolpack.model.ts`
- Edit: `packages/core/src/__tests__/contracts/toolpack.contract.test.ts` — case 148
- Edit: `apps/api/src/constants/api-codes.constants.ts` — add `TOOLPACK_URL_NOT_HTTPS`, `TOOLPACK_URL_PRIVATE_HOST`

**Steps**

1. **Write the failing test (case 148).** In `toolpack.contract.test.ts`:

   - With `NODE_ENV=production` (use `jest.replaceProperty` if the contract reads env, or pass a context parameter — see step 3): `RegisterToolpackBodySchema.safeParse({ ..., endpoints: { schema: "http://example.com/s", runtime: "http://example.com/r" } })` is `success: false`. The `error.issues` includes a refinement code matching `TOOLPACK_URL_NOT_HTTPS`.
   - With `NODE_ENV=development`: same shape with `http://localhost:4100/...` succeeds.
   - With either env: `http://10.0.0.5/x` fails with `TOOLPACK_URL_PRIVATE_HOST`.

2. **Author the contract refinement.** In `packages/core/src/contracts/toolpack.contract.ts`:

   ```ts
   import { validateToolpackUrl } from "../utils/toolpack-url-safety.util.js";

   const ToolpackUrlSchema = z.string().url().superRefine((url, ctx) => {
     const err = validateToolpackUrl(url);
     if (err) {
       ctx.addIssue({
         code: z.ZodIssueCode.custom,
         message: err.message,
         params: { code: err.code },
       });
     }
   });

   export const ToolpackEndpointsSchema = z.object({
     schema: ToolpackUrlSchema,
     runtime: ToolpackUrlSchema,
     metadata: ToolpackUrlSchema.optional(),
   });
   ```

3. **Decide on environment surface for `validateToolpackUrl`.** The validator reads `environment.NODE_ENV` from `apps/api/src/environment.ts`, but `packages/core` mustn't depend on `apps/api`. Move the `NODE_ENV` lookup inside the core validator using `process.env.NODE_ENV` directly with a `string | undefined` fallback to `"development"`. The api re-export keeps the same behavior. Document the decision inline.

4. **Extend the model.** In `organization-toolpack.model.ts`:

   ```diff
        authHeaders: z.record(z.string(), z.string()).nullable(),
   +    signingSecret: z.string(),
        tools: z.array(ToolpackToolDefinitionSchema).min(1).max(32),
   ```

5. **Extend the API contract types.** In `toolpack.contract.ts`:

   ```ts
   // CustomToolpackRecord (existing) gains:
   signingSecretStatus: z.object({ has: z.boolean() }),

   // New response payloads:
   export const ToolpackRegisterResponsePayloadSchema = z.object({
     toolpack: CustomToolpackRecordSchema,
     signingSecret: z.string(),  // surfaced once on registration
   });
   export type ToolpackRegisterResponsePayload =
     z.infer<typeof ToolpackRegisterResponsePayloadSchema>;

   export const ToolpackRotateSigningSecretResponsePayloadSchema = z.object({
     id: z.string(),
     signingSecret: z.string(),
     rotatedAt: z.number(),
   });
   export type ToolpackRotateSigningSecretResponsePayload =
     z.infer<typeof ToolpackRotateSigningSecretResponsePayloadSchema>;
   ```

   The existing `ToolpackRegisterResponsePayload` (without `signingSecret`) is replaced. Search for callers — the route handler is the only one (slice 5 updates it).

6. **Add the new ApiCode entries.** Per the spec:
   ```ts
   TOOLPACK_URL_NOT_HTTPS = "TOOLPACK_URL_NOT_HTTPS",
   TOOLPACK_URL_PRIVATE_HOST = "TOOLPACK_URL_PRIVATE_HOST",
   ```

7. **Run the focused tests.**
   ```bash
   cd packages/core && npm run test -- toolpack.contract
   ```
   Case 148 green. Lint + type-check.

8. **Verify the wider type-check.** The new model field (`signingSecret: z.string()`) means the existing assignability checks in `apps/api/src/db/schema/type-checks.ts` need `signingSecret` in the `_OrgToolpackOpaqueCols` skip-list (already done in slice 2 step 4). Re-run `npm run type-check` from the repo root to confirm.

**Done when:** case 148 passes; the model + contract round-trip clean; type-check is clean across `apps/api`, `apps/web`, `packages/core`.

**Risk:** `process.env.NODE_ENV` in `packages/core` is read at refinement-call time, which is fine in Node but in the browser bundle (web) it'll be inlined to `"production"` by Vite's `define`. The web frontend should never run server-side validation, so this asymmetry is fine — but call it out in the validator's comment block so future readers don't get confused.

**PR 1 — done.** All 12 cases (140–142, 143–147, 148, 149–151) pass; migration applies + script idempotent; existing tests green; lint + type-check clean. Wire behavior unchanged — primitives are in place but not yet read.

---

# PR 2 — Wire-up

Three slices that must land together. Outbound services start signing; routes return the secret once and add the rotation endpoint; mock server starts verifying. Atomic because:

- A signed request hitting an unverifying mock works fine (mock ignores headers).
- An unsigned request hitting a verifying mock fails — but the mock only verifies when `MOCK_TOOLPACK_SIGNING_SECRET` is set, which is opt-in.
- The rotation endpoint depends on slices 4+5 to be useful end-to-end.

## Slice 4 — Outbound services: sign + SSRF agent + runtime size cap

Wire the helpers from PR 1 into the two outbound callers.

**Files**

- Edit: `apps/api/src/services/toolpack-registration.service.ts`
- Edit: `apps/api/src/services/tools.service.ts`
- Edit: `apps/api/src/environment.ts` — `TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES`, `TOOLPACK_DISABLE_SSRF_FILTER`, `TOOLPACK_DISABLE_SIGNING`
- Edit: `apps/api/src/constants/api-codes.constants.ts` — add `TOOLPACK_RUNTIME_TOO_LARGE`
- Edit: `apps/api/src/__tests__/services/toolpack-registration.service.test.ts` — cases 152, 153
- Edit: `apps/api/src/__tests__/services/tools.service.test.ts` — cases 154, 155

**Steps**

1. **Add the env vars.** In `environment.ts`:
   ```ts
   TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES: parseInt(
     process.env.TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES || String(1024 * 1024),
     10
   ),
   TOOLPACK_DISABLE_SSRF_FILTER: process.env.TOOLPACK_DISABLE_SSRF_FILTER === "true",
   TOOLPACK_DISABLE_SIGNING: process.env.TOOLPACK_DISABLE_SIGNING === "true",
   ```
   Add the new ApiCode entry (`TOOLPACK_RUNTIME_TOO_LARGE`).

2. **Write the failing tests (cases 152–155).** `mockFetch` already exists in the existing test files; extend the assertions to inspect headers.

   - 152: `fetchSchema(url, headers, signingSecret)` includes the three signing headers when `signingSecret` is provided. Recompute the expected signature in the test using the same `signRequest` from the util module; assert on equality. Confirm `X-Portalai-Timestamp` is a numeric string within ±5s of `Date.now()/1000`.
   - 153: `fetchSchema(url, headers, undefined)` does NOT include any `X-Portalai-*` header. Used by the path where signing is disabled (env var) or for a row that hasn't been migrated yet (slice 2 throws, so this case is more about defense in depth — the function honors `undefined` cleanly).
   - 154: `callWebhook(...)` body is signed; the captured signature verifies against the body the spy received. Body bytes are JSON-stringified once, signed, and sent — assert the signature is over `JSON.stringify(input)` not over a re-stringified version.
   - 155: runtime size cap. Mock `fetch` returns a response with a 1.5 MB body (use a generated string `"x".repeat(1_500_000)`). The call rejects with `ApiError(502, TOOLPACK_RUNTIME_TOO_LARGE)`. Confirm the error is raised before the body is parsed (i.e. the streaming reader bails early). Mock returns a `text` async generator that yields chunks; the runtime caller cumulates and aborts at the cap.

3. **Author the registration-service edits.**

   ```ts
   import { signRequest } from "../utils/webhook-signing.util.js";
   import { createSafeOutboundAgents } from "../utils/url-safety.util.js";
   import { environment } from "../environment.js";

   async function fetchWithCap(
     url: string,
     headers: Record<string, string> | undefined,
     signingSecret: string | undefined
   ): Promise<FetchResult> {
     const controller = new AbortController();
     const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
     try {
       const body = "";  // GETs sign over the empty body — timestamp + id still bind
       const signedHeaders =
         signingSecret && !environment.TOOLPACK_DISABLE_SIGNING
           ? signRequest(signingSecret, body)
           : {};
       const agents = environment.TOOLPACK_DISABLE_SSRF_FILTER
         ? {}
         : createSafeOutboundAgents();
       const response = await fetch(url, {
         method: "GET",
         headers: { ...(headers ?? {}), ...signedHeaders },
         signal: controller.signal,
         // dispatcher: agents (Node 18+ undici); fall back per the slice-1 risk note
       });
       // ... existing size-cap + ok-check logic unchanged
     } finally {
       clearTimeout(timeout);
     }
   }
   ```

   `fetchSchema` and `fetchMetadata` both gain a third `signingSecret` parameter; call sites in the routes (slice 5) thread it through.

4. **Author the runtime-call edits in `tools.service.ts`.** `callWebhook` now:

   ```ts
   const bodyString = JSON.stringify(input);
   const signedHeaders =
     implementation.signingSecret && !environment.TOOLPACK_DISABLE_SIGNING
       ? signRequest(implementation.signingSecret, bodyString)
       : {};
   const agents = environment.TOOLPACK_DISABLE_SSRF_FILTER
     ? {}
     : createSafeOutboundAgents();

   const response = await fetch(implementation.url, {
     method: "POST",
     headers: {
       "Content-Type": "application/json",
       ...(implementation.headers ?? {}),
       ...signedHeaders,
     },
     body: bodyString,
     signal: controller.signal,
   });

   // Streaming size cap — read in chunks, abort over the limit.
   const reader = response.body?.getReader();
   if (!reader) throw new Error("no reader");
   const cap = environment.TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES;
   let total = 0;
   const chunks: Uint8Array[] = [];
   for (;;) {
     const { value, done } = await reader.read();
     if (done) break;
     total += value.byteLength;
     if (total > cap) {
       reader.cancel();
       throw new ApiError(
         502,
         ApiCode.TOOLPACK_RUNTIME_TOO_LARGE,
         `Runtime response exceeds ${cap} bytes`
       );
     }
     chunks.push(value);
   }
   const text = Buffer.concat(chunks).toString("utf8");
   ```

   `WebhookTool`'s `implementation` interface in `tools.service.ts:345-372` extends with `signingSecret: string`. The custom-toolpack expansion reads `pack.signingSecret` (decrypted by phase 5's repository) and threads it through.

5. **Run focused suites.**
   ```bash
   cd apps/api && npm run test:unit -- toolpack-registration tools
   cd apps/api && npm run test:integration -- organization-toolpacks
   ```
   Cases 152–155 green. Existing service + repository tests stay green (they don't pass `signingSecret`, so the fall-through path unsigned-headers path runs, mirroring case 153).

6. **Lint + type-check.**

**Done when:** cases 152–155 pass; existing tests green; outbound calls now sign whenever a secret is present; runtime responses are capped.

**Risk:** the streaming size-cap implementation in step 4 is the most error-prone part. Test 155's "abort before parse" assertion catches the wrong-order bug. If `response.body` is null (some test mocks), the implementation should fall back to `await response.text()` with the cap checked post-read — also asserted in case 155 if the test mock returns a non-streaming response.

---

## Slice 5 — Routes: signingSecret on POST + rotate endpoint

Routes return the freshly-generated secret once on registration; add the rotation endpoint.

**Files**

- Edit: `apps/api/src/routes/toolpacks.router.ts`
- Edit: `apps/api/src/__tests__/__integration__/routes/toolpacks.router.integration.test.ts` — cases 156, 157

**Steps**

1. **Write the failing tests (cases 156–157).**

   - 156: `POST /api/toolpacks` response body contains `signingSecret` matching `/^whsec_/`. `GET /api/toolpacks/:id` for the same row returns `signingSecretStatus.has === true` and the response body does NOT contain `whsec_` (substring check on the JSON-stringified body).
   - 157: `POST /api/toolpacks/:id/rotate-signing-secret` returns a fresh `whsec_*` distinct from the original. The on-disk ciphertext blob differs from the pre-rotation blob (raw-DB query). The response body shape matches `ToolpackRotateSigningSecretResponsePayloadSchema`.

2. **Edit `POST /api/toolpacks`.** The handler now:

   ```ts
   const signingSecret = generateSigningSecret();
   model.update({
     organizationId,
     name,
     description: description ?? null,
     endpoints,
     authHeaders: authHeaders ?? null,
     signingSecret,        // plaintext at this layer; repository encrypts on insert
     tools,
     metadata,
     schemaFetchedAt: now,
     metadataFetchedAt: metadata !== null ? now : null,
   });
   const row = await DbService.repository.organizationToolpacks.create(
     model.parse() as never
   );

   return HttpService.success<ToolpackRegisterResponsePayload>(
     res,
     {
       toolpack: toCustomApiRecord(row as unknown as OrganizationToolpack),
       signingSecret,        // surfaced once; never returned by GET
     },
     201
   );
   ```

   `toCustomApiRecord` adds `signingSecretStatus: { has: true }` (always true; the column is NOT NULL).

3. **Schema/metadata fetches in POST and PATCH** thread the signing secret through. POST uses the freshly-generated `signingSecret`; PATCH and refresh read `existing.signingSecret` (decrypted by the repository).

4. **Add `POST /api/toolpacks/:id/rotate-signing-secret`.**

   ```ts
   toolpacksRouter.post(
     "/:id/rotate-signing-secret",
     getApplicationMetadata,
     async (req, res, next) => {
       try {
         const { id } = req.params;
         const { organizationId, userId } = req.application!.metadata;
         const existing = await DbService.repository.organizationToolpacks
           .findByIdScoped(id, organizationId);
         if (!existing) {
           return next(new ApiError(404, ApiCode.TOOLPACK_NOT_FOUND, "Toolpack not found"));
         }
         const newSecret = generateSigningSecret();
         const now = Date.now();
         await DbService.repository.organizationToolpacks.update(id, {
           signingSecret: newSecret,
           updated: now,
           updatedBy: userId,
         } as never);
         return HttpService.success<ToolpackRotateSigningSecretResponsePayload>(
           res,
           { id, signingSecret: newSecret, rotatedAt: now }
         );
       } catch (error) {
         return next(error instanceof ApiError ? error :
           new ApiError(500, ApiCode.TOOLPACK_NOT_FOUND, "Failed to rotate signing secret"));
       }
     }
   );
   ```

   The OpenAPI block follows the convention used by the existing routes.

5. **Run the route integration suite.**
   ```bash
   cd apps/api && npm run test:integration -- toolpacks.router
   ```
   24+ cases green (existing 23 + cases 156, 157). Phase 5's case 135 still passes — `secret-token-xyz-135` doesn't appear in any response body.

6. **Lint + type-check.**

**Done when:** cases 156–157 pass; rotation endpoint round-trips end-to-end; pre-existing route tests stay green.

**Risk:** the rotation route's auth requirements aren't called out in the spec — assuming the existing `getApplicationMetadata` middleware (org-scoped) is sufficient. A future enhancement might gate rotation behind an additional admin check, but that's phase 7+ work.

---

## Slice 6 — Mock server verification

Add the `captureRawBody` and `verifySignature` middlewares so the mock server demonstrates the receiving-end contract.

**Files**

- Edit: `apps/api/src/scripts/mock-toolpack-server.ts`
- New: `apps/api/src/__tests__/scripts/mock-toolpack-server.test.ts` — cases 158–160

**Steps**

1. **Write the failing tests (cases 158–160).** The mock server is an Express app — extract the app construction into a tested-friendly shape if it isn't already. Use `supertest` to exercise it:

   - 158: with `MOCK_TOOLPACK_SIGNING_SECRET` set, `POST /runtime` without the three signing headers returns `401` with `error: "SIGNATURE_MISSING"`.
   - 159: with the secret set, `POST /runtime` with a stale timestamp (`Math.floor(Date.now()/1000) - 600`) returns `401` with `error: "TIMESTAMP_STALE"` and an `ageSec` field.
   - 160: with the secret set, three sub-asserts in one case:
     - Tampered body but valid headers → `401 SIGNATURE_INVALID`.
     - Round-trip success: sign a real request via `signRequest("the-secret", JSON.stringify({ tool: "echo", input: { message: "hi" }}))` and POST it; expect `200` with `{ echoed: "hi" }`.
     - Without the env var: same unsigned request as 158 returns `200` (warn-and-skip path; the warning to stderr is asserted via a console spy).

2. **Refactor the mock server.** Extract the app construction into a `createMockApp()` factory exported from the module:

   ```ts
   export function createMockApp() {
     const app = express();
     app.use(captureRawBody);
     app.use(express.json({ limit: "1mb" }));
     app.use(verifySignature);
     app.get("/schema", ...);
     app.get("/metadata", ...);
     app.post("/runtime", ...);
     return app;
   }
   ```

   The `app.listen(...)` block at the bottom calls `createMockApp().listen(...)`. Tests import `createMockApp` and pass it to `supertest(app)`.

3. **Author `captureRawBody` and `verifySignature`** per the spec. The `captureRawBody` middleware uses `req.on("data", ...)` to accumulate chunks; the `verifySignature` middleware reads `req.rawBody`, validates timestamp window, recomputes HMAC, timing-safe-compares.

4. **Run the focused tests.**
   ```bash
   cd apps/api && npm run test:unit -- mock-toolpack-server
   ```
   Cases 158–160 green.

5. **Manual smoke (PR 2 acceptance gate).** From two terminals:

   ```bash
   # terminal A:
   cd apps/api
   export MOCK_TOOLPACK_SIGNING_SECRET=whsec_TBD     # placeholder; will update
   npm run mock-toolpack

   # terminal B:
   cd apps/api && npm run dev
   # then in the UI (or via curl):
   #   1. POST /api/toolpacks with the mock URLs → captures `signingSecret` from the response
   #   2. Set MOCK_TOOLPACK_SIGNING_SECRET=<that-secret>, restart the mock server
   #   3. From a portal session, invoke a tool from the registered pack
   #      → succeeds, mock logs the verified call
   #   4. POST /api/toolpacks/:id/rotate-signing-secret
   #   5. From the portal session, invoke again
   #      → 401 SIGNATURE_INVALID at the mock (because the mock's env still has the old secret)
   #   6. Update MOCK_TOOLPACK_SIGNING_SECRET to the new value, restart mock
   #   7. Invoke again → succeeds
   ```

6. **Lint + type-check.**

**Done when:** cases 158–160 pass; manual smoke confirms the end-to-end signing + rotation round-trip.

**Risk:** capturing the raw body in middleware while also using `express.json()` requires careful ordering — the raw-body handler must fire *before* `express.json()` consumes the stream. Step 3's middleware-order block is the load-bearing detail. Test 160's round-trip success case catches this.

**PR 2 — done.** All 9 cases (152–160) pass; outbound calls sign whenever a secret is present; rotation endpoint round-trips; mock demonstrates the verify path; pre-existing tests green.

---

# PR 3 — Frontend

Single slice. Adds the one-time secret display, rotate button, SDK + cache invalidation. Backend works without it (curl-driven manual flow), so this PR is independent and can land later if reviewer bandwidth is tight.

## Slice 7 — UI: one-time secret display + rotate button

**Files**

- Edit: `apps/web/src/components/RegisterToolpackDialog.component.tsx`
- Edit: `apps/web/src/components/EditToolpackDialog.component.tsx`
- Edit: `apps/web/src/api/toolpacks.api.ts` — `rotateSigningSecret` mutation
- Edit: `apps/web/src/api/sdk.ts` — re-export the mutation
- New: `apps/web/src/components/SigningSecretRevealDialog.component.tsx` — shared display panel
- Edit: `apps/web/src/__tests__/RegisterToolpackDialog.test.tsx` — extended case
- Edit: `apps/web/src/__tests__/EditToolpackDialog.test.tsx` — extended case

**Steps**

1. **Author `SigningSecretRevealDialog`.** Pure UI component (`*UI` + container, per CLAUDE.md). Renders a Modal with:
   - Title: "Your toolpack signing secret"
   - Body: a monospace `<TextField readOnly>` containing the secret + a copy-to-clipboard `<IconButton>`. An `<Alert severity="warning">` reads "Copy this now — it will not be shown again. Configure your toolpack server to verify webhooks with this secret."
   - Close button (no Cancel; close means the user has saved the secret somewhere).

   Props: `open: boolean`, `signingSecret: string | null`, `onClose: () => void`.

2. **Wire into `RegisterToolpackDialog`.** On successful registration, the response now includes `signingSecret`. The container captures it into local state and renders the reveal dialog after the registration dialog closes.

3. **Add the rotate flow to `EditToolpackDialog`.** A new "Rotate signing secret" button next to "Refresh schema". On click, calls `sdk.toolpacks.rotateSigningSecret({ id })`; on success, opens the reveal dialog with the new secret.

4. **Extend the SDK.**
   ```ts
   // apps/web/src/api/toolpacks.api.ts
   rotateSigningSecret: useAuthMutation<
     ToolpackRotateSigningSecretResponsePayload,
     { id: string }
   >({
     method: "POST",
     url: ({ id }) => `/api/toolpacks/${id}/rotate-signing-secret`,
     body: () => undefined,
     onSuccess: (queryClient) => {
       queryClient.invalidateQueries({ queryKey: queryKeys.toolpacks.root });
     },
   });
   ```
   Same for the changed registration response shape (the existing register mutation now returns `{ toolpack, signingSecret }`).

5. **Frontend tests.** Two cases:
   - `RegisterToolpackDialog` test: after the SDK mock resolves with `{ toolpack, signingSecret: "whsec_test" }`, the reveal dialog appears and shows the secret. Closing the reveal dialog also closes the registration flow.
   - `EditToolpackDialog` test: clicking the rotate button calls the SDK mock; on resolve, the reveal dialog shows the new secret.

6. **Run the web suite.**
   ```bash
   cd apps/web && npm run test:unit
   ```
   All 2100+ cases green.

7. **Manual smoke (PR 3 acceptance gate).** Re-run the smoke from PR 2 step 5 entirely through the UI: register a toolpack, see the reveal dialog, copy the secret, configure the mock, invoke a tool, rotate via the edit dialog, see the new secret, configure the mock with the new secret, invoke again. No curl required.

8. **Lint + type-check.**

**Done when:** the two new web cases pass; manual smoke is fully UI-driven.

**Risk:** copying to clipboard requires an HTTPS context in some browsers (or `localhost`). For the dev workflow at `http://localhost:3000`, the `navigator.clipboard.writeText` call works fine. Production runs over HTTPS so it's also fine. The fallback (a `document.execCommand('copy')` on a hidden textarea) isn't worth implementing for v1.

---

## Cross-PR notes

- **PR ordering is enforceable.** PR 2 depends on PR 1's helpers + DB column + repository. PR 3 depends on PR 2's response shape changes. CI gates on PR 1 merging before PR 2 opens, etc.

- **`ssrf-req-filter` is the only new runtime dep.** All other crypto + agents are Node built-ins. Confirm the lockfile diff in PR 1 is exactly `ssrf-req-filter` (transitive deps are minimal).

- **Migration step in deploy.** PR 1 ships `0051_add_toolpack_signing_secret.sql` *and* `migrate-signing-secrets.ts`. Deploy ordering is: schema migration → run script. CI's deploy workflow needs an explicit step. Document in PR 1's description: "After merge, the deploy workflow runs `npm run db:migrate:ci` (existing) then `node dist/scripts/migrate-signing-secrets.js` (new step — wire into the deploy YAML)."

- **Feature flags for emergency rollback.** `TOOLPACK_DISABLE_SSRF_FILTER=true` and `TOOLPACK_DISABLE_SIGNING=true` provide environment-flip rollbacks without code reverts. Document both in `apps/api/README.md` next to the existing env-var section.

- **No new permission scopes.** All routes inherit the existing `getApplicationMetadata` org-scoping. Rotation is org-scoped — any org member can rotate a toolpack their org owns. A finer-grained admin gate is phase 7+ if it ever becomes necessary.

- **CLAUDE.md compliance.** New files follow suffix conventions (`*.util.ts`, `*.component.tsx`, `*.test.ts`, `*.test.tsx`). The `SigningSecretRevealDialog` follows the pure-UI + container split. SDK additions go through `useAuthMutation` per the API-calls policy. Cache invalidation uses `queryKeys.toolpacks.root` per the mutation invalidation policy.

- **Total work estimate.** PR 1 ~5 hours; PR 2 ~5 hours; PR 3 ~3 hours. Total ~13 hours across three reviewable PRs.

- **What we're not doing.** Retries / DLQ / circuit breakers / rate limiting / audit log / delivery dashboard / multiple signing keys / TLS pinning / mTLS / KMS / domain allowlist / verification-helper SDK distributed as a separate package. All deferred per the spec's "out of scope" enumeration. Each is its own future phase if real usage warrants.
