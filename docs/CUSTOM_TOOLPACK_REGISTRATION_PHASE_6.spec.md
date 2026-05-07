# Custom Toolpack Registration — Phase 6 — Spec

**Industry-standard outbound webhook security: HMAC request signing, replay-window timestamps, idempotency request IDs, SSRF filtering, HTTPS-only registration, and a runtime response-size cap.** Closes the highest-leverage gaps from the phase-4 security audit's audit, lifts the platform from "passes user-supplied tokens around" to "operates webhooks." The companion mock-toolpack server is updated to verify everything we send so toolpack authors have a working reference for their own implementation.

Discovery: `docs/CUSTOM_TOOLPACK_REGISTRATION.discovery.md`. Phase 1: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_1.{spec,plan}.md`. Phase 2: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_2.{spec,plan}.md`. Phase 3: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_3.{spec,plan}.md`. Phase 4: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_4.{spec,plan}.md`. Phase 5: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_5.{spec,plan}.md`.

After phase 5: stored auth headers are encrypted at rest, but on the wire we still hand a static bearer token to a third-party URL with no proof that the request came from us, no defense against replay, and no protection against a registered URL pointing at `169.254.169.254` or `localhost:6379`. Phase 6 is the wire-protocol upgrade — every outbound call is signed, timestamped, and idempotency-keyed; every registered URL is filtered at registration *and* at call time (defeating DNS rebinding); only HTTPS URLs are accepted in production; and runtime responses join schema/metadata under a hard size cap.

The mock toolpack server (`apps/api/src/scripts/mock-toolpack-server.ts`) gains a verification middleware that demonstrates exactly what an industry-standard toolpack should check. This is the artifact toolpack authors copy-paste from when implementing their own server.

Resolved decision points specific to phase 6:

- **P-6.1 (signing-secret reveal model):** one-time on the registration response, never visible again. Stripe/AWS-IAM pattern. The `POST /api/toolpacks` response body includes a `signingSecret` field exactly once; on every subsequent read (`GET`, `PATCH`, `refresh`) the secret is encrypted at rest (same crypto.util as phase 5's auth headers) and the API responds only with `{ signingSecretStatus: { has: true } }`. Admins who lose the secret rotate via `POST /api/toolpacks/:id/rotate-signing-secret` — generates a fresh secret, returns it once, invalidates the old one immediately.
- **P-6.2 (rollout — existing toolpacks):** auto-sign + ignore. The migration generates a fresh signing secret for every existing row (`gen_random_bytes(32)::text` server-side, then encrypted in place). From deploy onward we sign every outbound call. Toolpack servers that haven't been updated to verify simply ignore the new headers — they continue to work. When an admin is ready to enable verification on their toolpack server, they rotate the secret to view it (the auto-generated one was never exposed; rotation is the canonical way to get a known-plaintext secret out).
- **P-6.3 (SSRF approach):** library for runtime + Zod refinement at registration. The `ssrf-req-filter` HTTP agent handles DNS-rebinding-safe call-time filtering (resolve → validate → connect to the resolved IP). A Zod URL refinement at the contract layer (`packages/core`) rejects obvious private hostnames at registration so admins get immediate feedback in the UI. Belt-and-braces — same library footprint either way.
- **P-6.4 (signing algorithm):** HMAC-SHA256 over `<timestamp>.<request_id>.<body>`. Stripe / Slack / GitHub all use SHA256; no reason to deviate. The `.` joiner with timestamp and request-id baked into the signed payload binds the signature to that specific delivery — replay with a different body or timestamp fails. The header is versioned (`v1=<hex>`) so a future algorithm change is non-breaking.
- **P-6.5 (header naming):** three separate headers for clarity. `X-Portalai-Timestamp: <unix-seconds>`, `X-Portalai-Webhook-Id: <uuid>`, `X-Portalai-Signature: v1=<hex>`. Stripe-style combined headers (`Stripe-Signature: t=...,v1=...`) are also valid, but separate headers are easier for toolpack authors to inspect with curl and easier to verify field-by-field.
- **P-6.6 (replay window):** 300 seconds (5 minutes). Stripe / Slack / Svix default. The toolpack rejects timestamps older than 300s; the mock implements this. Includes a forward window of 60s to absorb minor clock skew.
- **P-6.7 (which calls get signed):** all three. Schema, metadata, and runtime fetches are all signed. Same threat model — schema fetches at registration / refresh time touch attacker-controllable URLs and the toolpack should be able to verify the request came from us.
- **P-6.8 (HTTPS-only at registration):** required in production, `http://localhost*` and `http://127.0.0.1*` allowed when `NODE_ENV !== "production"`. Avoids the dev-loop tax of "spin up TLS for the mock server."
- **P-6.9 (runtime response size cap):** 1 MB (1,048,576 bytes), configurable via `TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES` env var. Schema/metadata stay at 256 KB (those are tool-definition payloads; runtime responses can legitimately carry larger results like search snippets). The cap is enforced via a streaming reader, not a `Content-Length` check alone — a misbehaving toolpack could omit the header and dump GBs.
- **P-6.10 (mock server scope):** the mock verifies all three headers (timestamp window, signature, request-id presence) on every endpoint. Returns `401 SIGNATURE_MISSING` / `401 SIGNATURE_INVALID` / `401 TIMESTAMP_STALE`. Demonstrates exactly what an industry-standard toolpack should check, with comments explaining each step. Configured via `MOCK_TOOLPACK_SIGNING_SECRET` env var.
- **P-6.11 (signed-payload normalization):** the body is signed verbatim (the JSON-encoded request body string, byte-for-byte). No canonicalization. The toolpack must verify against the raw body before parsing — same model as Stripe / GitHub. A small middleware on the mock side captures the raw body before `express.json()` parses.
- **P-6.12 (NotImplemented for retries / DLQ / rate-limit / circuit-breakers / audit log):** out of scope. These are operational reliability concerns that pair with delivery-dashboard UI; phase 6 is the wire-protocol cut. Phase 7 candidate.

After this phase: every outbound webhook call carries a signed, timestamped, idempotency-keyed envelope verifiable by the receiving toolpack; registered URLs are SSRF-filtered at call time *and* at registration time; only HTTPS URLs are accepted in production; runtime responses are size-capped. The mock server demonstrates the full receiving-end contract for toolpack authors.

---

## Scope

### In scope (Tier 1 + Tier 2 minus delivery-resilience)

**Tier 1 — defining features:**

1. **Per-toolpack signing secret** stored encrypted at rest (reuses `crypto.util.ts` from phase 5).
2. **HMAC-SHA256 outbound request signing** on schema, metadata, and runtime calls.
3. **Timestamp header + 300s replay window** sent with every signed request.
4. **Idempotency request-id header** (`X-Portalai-Webhook-Id: <uuid>`) on every signed request.
5. **Runtime response size cap** at 1 MB (configurable; matches phase 5's bounded-everything posture).

**Tier 2 — operational hardening (security-shaped):**

6. **SSRF protection at call time** via `ssrf-req-filter` agent, applied to every outbound call (schema / metadata / runtime).
7. **SSRF refinement at registration** — Zod URL validator in `packages/core` rejects private hostnames before the row is even attempted.
8. **HTTPS-only at registration** — production rejects `http://`; non-production allows `http://localhost*` and `http://127.0.0.1*`.

**Mock-server companion:**

9. **Mock toolpack server verification middleware** — reads + verifies the signing headers on every endpoint, demonstrates the contract.

**Routes:**

10. **`POST /api/toolpacks/:id/rotate-signing-secret`** — generates a fresh secret, invalidates the old one, returns the new value once.

### Out of scope (deferred to phase 7+)

- **Retries with exponential backoff.** Delivery resilience, queue-shaped, naturally pairs with a delivery dashboard.
- **Dead-letter queue.** Same cluster as retries.
- **Circuit breakers per endpoint.** Same cluster.
- **Per-toolpack rate limiting.** Same cluster.
- **Audit log of credential / signing-secret usage.** Operational observability — small but standalone, can land independently.
- **Delivery dashboard UI.** Surfaces all of the above; warrants its own spec.
- **Multiple active signing keys (rotation overlap window).** Useful at scale; v1 rotation is hard-cutover (rotate now → old secret immediately invalid).
- **TLS certificate pinning.** Higher-trust integrations only — most webhook providers don't ship this.
- **mTLS.** Enterprise / regulated industries; orthogonal to HMAC.
- **Envelope encryption / KMS.** Phase 5 used a single static `ENCRYPTION_KEY`; upgrading both columns at once is a future effort.
- **Domain allowlist / blocklist.** Enterprise governance; warrants its own spec.
- **PII redaction in delivery logs.** Pairs with the dashboard.
- **Verification-helper SDK / client libraries** (TS / Python / Go reference implementations distributed as packages). The mock server fills this gap for v1 — toolpack authors copy it. A real SDK comes later.
- **Frontend "view signing secret" affordance beyond one-time display on registration.** Rotation lands as the refresh path; admin who needs the secret again uses rotate.

### Adjacent files that don't change

- `packages/core/src/models/organization-toolpack.model.ts` — model already describes plaintext shapes; new `signingSecret` field added but only at the storage layer, like phase 5's `authHeaders`.
- `apps/web/**` — minimal: registration dialog displays the one-time secret on success; rotate button on the edit dialog. UI work is folded into the plan, but the contract layer is the load-bearing change.

---

## Surface

### Webhook signing module

**File: `apps/api/src/utils/webhook-signing.util.ts`** (new)

```ts
import crypto from "crypto";

export interface SignedRequestEnvelope {
  timestamp: string;     // unix seconds
  webhookId: string;     // uuid v4
  signature: string;     // "v1=<hex>"
}

export interface SignedRequestHeaders {
  "X-Portalai-Timestamp": string;
  "X-Portalai-Webhook-Id": string;
  "X-Portalai-Signature": string;
}

const SIGNATURE_VERSION = "v1";
const SIGNED_PAYLOAD_SEPARATOR = ".";

/**
 * Compute the HMAC-SHA256 signature over `<timestamp>.<webhookId>.<body>`
 * and produce the three headers an outbound request carries.
 *
 * The body is signed verbatim — no JSON canonicalization. Receivers
 * must verify against the raw body before parsing.
 */
export function signRequest(
  secret: string,
  body: string,
  opts?: { now?: number; webhookId?: string }
): SignedRequestHeaders {
  const timestamp = String(Math.floor((opts?.now ?? Date.now()) / 1000));
  const webhookId = opts?.webhookId ?? crypto.randomUUID();
  const payload = [timestamp, webhookId, body].join(SIGNED_PAYLOAD_SEPARATOR);
  const hex = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return {
    "X-Portalai-Timestamp": timestamp,
    "X-Portalai-Webhook-Id": webhookId,
    "X-Portalai-Signature": `${SIGNATURE_VERSION}=${hex}`,
  };
}

/**
 * Generate a fresh signing secret. 32 random bytes, base64-encoded —
 * 256 bits of entropy, URL-safe-ish, prefixed with `whsec_` for
 * out-of-band identification (matches Stripe's whsec_xxx convention).
 */
export function generateSigningSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString("base64url")}`;
}
```

For GET requests (schema / metadata fetches) the body is the empty string — the signature still binds the timestamp + webhookId so a captured request can't be replayed past the 5-min window.

### URL safety module

**File: `apps/api/src/utils/url-safety.util.ts`** (new)

Two responsibilities:

1. **Static validation** — for use at the contract layer (sync, no DNS): is this URL syntactically allowed in the current environment? Rejects non-HTTP(S) schemes; rejects `http://` in production; rejects obvious private hostnames (`localhost`, IP literals in private ranges).
2. **Outbound HTTP agent** — for use at call time: an `https.Agent` (and `http.Agent`) backed by `ssrf-req-filter` that resolves DNS, validates the resolved IP against the denylist, and connects to that resolved IP. Defeats DNS rebinding.

```ts
import ssrfFilter from "ssrf-req-filter";
import { environment } from "../environment.js";

const DEV_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface UrlValidationError {
  code:
    | "TOOLPACK_URL_INVALID"
    | "TOOLPACK_URL_NOT_HTTPS"
    | "TOOLPACK_URL_PRIVATE_HOST";
  message: string;
}

/**
 * Sync URL validation suitable for Zod refinements. Does NOT resolve DNS;
 * only catches obvious mistakes (wrong scheme, `localhost` in prod, raw
 * private-range IP literals). The call-time agent (below) is the
 * authoritative SSRF guard.
 */
export function validateToolpackUrl(raw: string): UrlValidationError | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { code: "TOOLPACK_URL_INVALID", message: "URL is not parseable" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { code: "TOOLPACK_URL_INVALID", message: "URL must be http or https" };
  }
  const isProd = environment.NODE_ENV === "production";
  if (isProd && parsed.protocol !== "https:") {
    return {
      code: "TOOLPACK_URL_NOT_HTTPS",
      message: "Toolpack URLs must use https in production",
    };
  }
  if (parsed.protocol === "http:" && !DEV_HTTP_HOSTS.has(parsed.hostname)) {
    return {
      code: "TOOLPACK_URL_NOT_HTTPS",
      message: "http URLs are only allowed for localhost in non-production",
    };
  }
  if (isPrivateHostnameLiteral(parsed.hostname)) {
    return {
      code: "TOOLPACK_URL_PRIVATE_HOST",
      message: "URL hostname resolves to a private network",
    };
  }
  return null;
}

/**
 * The HTTP / HTTPS agents to use for every outbound call to a
 * toolpack URL. Wraps `ssrf-req-filter` which resolves the URL's
 * hostname to an IP, rejects RFC1918 / link-local / loopback /
 * cloud-metadata addresses, and connects to the *resolved* IP —
 * defeating DNS rebinding.
 */
export function createSafeOutboundAgents(): {
  httpAgent: import("http").Agent;
  httpsAgent: import("https").Agent;
} {
  return {
    httpAgent: ssrfFilter("http:") as unknown as import("http").Agent,
    httpsAgent: ssrfFilter("https:") as unknown as import("https").Agent,
  };
}

/**
 * Internal: catches obvious literals before DNS resolution.
 * The call-time agent is the canonical guard; this is just for
 * good registration-time error messages.
 */
function isPrivateHostnameLiteral(host: string): boolean {
  // ... implementation: regex IPv4 against RFC1918 + 127/8 + 169.254/16,
  // IPv6 link-local + ULA, and the hostname `localhost` (in prod only).
  // Detail in the plan.
}
```

`ssrf-req-filter` is added to `apps/api`'s `dependencies`. Latest stable; ~30 KB; actively maintained.

### Database changes

**File: `apps/api/src/db/schema/organization-toolpacks.table.ts`** (edit)

```diff
     authHeaders: text("auth_headers"),
+    signingSecret: text("signing_secret").notNull(),
     tools: jsonb("tools")
```

Stored encrypted at rest exactly like `authHeaders` — same `text` column type, same crypto.util pattern. `NOT NULL` because every row gets a generated secret at insert time (the migration backfills existing rows).

**File: `apps/api/drizzle/0051_add_toolpack_signing_secret.sql`** (new, hand-written)

```sql
-- Add signing_secret column to organization_toolpacks. Phase 6 signs
-- every outbound webhook with a per-toolpack HMAC secret. Existing
-- rows get an auto-generated encrypted secret so the column can be
-- NOT NULL. Admins rotate via POST /api/toolpacks/:id/rotate-signing-secret
-- to view the plaintext value (the auto-generated one is never
-- surfaced — rotation is the canonical reveal path for legacy rows).

ALTER TABLE "organization_toolpacks"
  ADD COLUMN "signing_secret" text;

-- Generate a fresh secret per existing row. We cannot call our
-- `encryptCredentials()` from SQL, so the migration leaves the
-- value as a plaintext placeholder and a follow-up Node script
-- (`apps/api/src/scripts/migrate-signing-secrets.ts`) reads each
-- row, generates+encrypts a real secret, and writes it back.
-- The placeholder is a sentinel string the script recognizes.
UPDATE "organization_toolpacks"
  SET "signing_secret" = '__pending_phase6_rotation__'
  WHERE "signing_secret" IS NULL;

ALTER TABLE "organization_toolpacks"
  ALTER COLUMN "signing_secret" SET NOT NULL;
```

The deploy sequence is: `db:migrate` → `npm run scripts:migrate-signing-secrets` (idempotent, finds rows with the sentinel, replaces with encrypted real secrets, never touches already-real rows). Detail in the plan.

### Repository changes

**File: `apps/api/src/db/repositories/organization-toolpacks.repository.ts`** (edit)

The encrypt/decrypt helpers from phase 5 generalize cleanly. Add `signingSecret` to the field list both helpers handle:

```ts
function decryptRow<T extends { authHeaders: string | null; signingSecret: string }>(
  row: T
): T & {
  authHeaders: Record<string, string> | null;
  signingSecret: string;
} {
  return {
    ...row,
    authHeaders: row.authHeaders
      ? (decryptCredentials(row.authHeaders) as Record<string, string>)
      : null,
    signingSecret: decryptSigningSecret(row.signingSecret),
  };
}
```

`decryptSigningSecret` is a thin wrapper over `decryptCredentials` (the value is a `string`, not a `Record`, so the types differ but the underlying crypto is identical). New helper `encryptSigningSecret(plaintext)` mirrors it on the write side.

The five base-class overrides (`findById`, `findMany`, `create`, `update`, `upsert`) stay structurally identical — they delegate to the helpers which now also handle the new column. Same for the bespoke finders (`findByOrganizationId`, `findManyByIds`, `findByIdScoped`).

### Outbound caller changes

**File: `apps/api/src/services/toolpack-registration.service.ts`** (edit)

`fetchWithCap` accepts an optional signing-secret parameter; when present, it computes signed headers and merges them into the request:

```ts
async function fetchWithCap(
  url: string,
  headers: Record<string, string> | undefined,
  signingSecret: string | undefined,
  opts?: { httpAgent?: Agent; httpsAgent?: Agent }
): Promise<FetchResult> {
  const safeAgents = createSafeOutboundAgents();
  const body = ""; // GET requests
  const signedHeaders = signingSecret
    ? signRequest(signingSecret, body)
    : {};
  const response = await fetch(url, {
    method: "GET",
    headers: { ...(headers ?? {}), ...signedHeaders },
    agent: agentForUrl(url, safeAgents),
    signal: controller.signal,
  });
  // ... existing size-cap + ok-check logic unchanged
}
```

Both `fetchSchema` and `fetchMetadata` now take a third `signingSecret` parameter; the route handlers thread it through from the toolpack row.

**File: `apps/api/src/services/tools.service.ts`** (edit)

`callWebhook` (lines 154–182 today) gains:

1. Body serialization happens once, before the signature is computed (so the signature binds the exact bytes sent).
2. Signing headers merged in alongside the user-supplied auth headers.
3. The SSRF-safe agent passed to `fetch`.
4. Streaming response read with the runtime size cap (`TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES`, default 1 MB).

`WebhookTool`'s `implementation` shape extends with `signingSecret: string`; the custom-toolpack expansion in `tools.service.ts:345-372` reads `pack.signingSecret` from the (now-decrypted) repository row and threads it through.

### Route changes

**File: `apps/api/src/routes/toolpacks.router.ts`** (edit)

1. **`POST /api/toolpacks` response** — returns the freshly-generated `signingSecret` plaintext exactly once, alongside the existing `toolpack` payload. Schema:
   ```ts
   { toolpack: { ..., signingSecretStatus: { has: true } }, signingSecret: "whsec_..." }
   ```
   The `signingSecret` field appears only on the registration response. `GET` / `PATCH` / `refresh` responses include `signingSecretStatus` but never `signingSecret`.

2. **`POST /api/toolpacks/:id/rotate-signing-secret`** — new route. Generates a fresh secret, encrypts and persists, invalidates the old one immediately, returns:
   ```ts
   { id, signingSecret: "whsec_...", rotatedAt: <timestamp> }
   ```

3. **Existing routes** that call `fetchSchema` / `fetchMetadata` thread `existing.signingSecret` (decrypted by the repository) into the call.

**File: `packages/core/src/contracts/toolpack.contract.ts`** (edit)

`ToolpackEndpointsSchema` adds a Zod `.refine()` that calls `validateToolpackUrl` from `apps/api/src/utils/url-safety.util.ts` — except it can't, because `packages/core` mustn't depend on `apps/api`. Move the static URL validator (the `validateToolpackUrl` half) into `packages/core/src/utils/toolpack-url-safety.util.ts`; the SSRF-agent half stays in `apps/api`. The contract refinement uses the core-side validator.

`ToolpackRegisterResponsePayload` and `ToolpackRotateSigningSecretResponsePayload` declared on the contract.

`CustomToolpackRecord` adds `signingSecretStatus: { has: boolean }`.

### Mock server changes

**File: `apps/api/src/scripts/mock-toolpack-server.ts`** (edit)

Adds a `verifySignature` middleware applied to all three endpoints. Reads `MOCK_TOOLPACK_SIGNING_SECRET` from env (with a fallback for backwards compatibility — if unset, prints a warning and skips verification, so existing dev workflows aren't broken).

```ts
function captureRawBody(req: Request, _res: Response, next: NextFunction) {
  let buf = "";
  req.on("data", (chunk) => (buf += chunk));
  req.on("end", () => {
    (req as Request & { rawBody?: string }).rawBody = buf;
    next();
  });
}

function verifySignature(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.MOCK_TOOLPACK_SIGNING_SECRET;
  if (!secret) {
    console.warn("⚠️  MOCK_TOOLPACK_SIGNING_SECRET not set — accepting unsigned requests. " +
                 "Configure the env var to demonstrate phase-6 verification.");
    return next();
  }
  const ts = req.header("X-Portalai-Timestamp");
  const id = req.header("X-Portalai-Webhook-Id");
  const sig = req.header("X-Portalai-Signature");
  if (!ts || !id || !sig) {
    res.status(401).json({ error: "SIGNATURE_MISSING" });
    return;
  }
  const ageSec = Math.floor(Date.now() / 1000) - Number(ts);
  if (Number.isNaN(ageSec) || ageSec > 300 || ageSec < -60) {
    res.status(401).json({ error: "TIMESTAMP_STALE", ageSec });
    return;
  }
  const body = (req as Request & { rawBody?: string }).rawBody ?? "";
  const expected = crypto
    .createHmac("sha256", secret)
    .update([ts, id, body].join("."))
    .digest("hex");
  const provided = sig.startsWith("v1=") ? sig.slice(3) : "";
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (
    expectedBuf.length !== providedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, providedBuf)
  ) {
    res.status(401).json({ error: "SIGNATURE_INVALID" });
    return;
  }
  next();
}

app.use(captureRawBody);          // raw body before json parse
app.use(express.json({ limit: "1mb" }));
app.use(verifySignature);          // applied to ALL endpoints
```

Each step has a brief comment explaining what it's doing — the file becomes the "how to verify a Portal.ai webhook" reference.

### Frontend changes

Minimum viable: the registration dialog displays the one-time signing secret on success and the edit dialog has a "Rotate signing secret" button that opens the same one-time-display panel. Signature secret is highlighted, copy-to-clipboard available. Detail in the plan.

---

## TDD test plan

Cases 140–160, continuing from phase 5.

### Layer 1 — Pure helpers (unit)

**`apps/api/src/__tests__/utils/webhook-signing.util.test.ts`** (new):

140. Round-trip: `signRequest(secret, body)` produces stable output for fixed `now` + `webhookId`; verifying with the same inputs reproduces the signature byte-for-byte.
141. Different `webhookId` → different signature with the same body. Different `now` → different signature. Different body → different signature. (Three sub-asserts; one case.)
142. `generateSigningSecret()` returns 256 bits of entropy in the `whsec_` prefix; two calls produce unequal outputs.

**`apps/api/src/__tests__/utils/url-safety.util.test.ts`** (new):

143. `validateToolpackUrl("https://example.com/x")` returns `null` (valid).
144. `validateToolpackUrl("ftp://example.com")` returns `TOOLPACK_URL_INVALID`.
145. `validateToolpackUrl("http://example.com")` returns `TOOLPACK_URL_NOT_HTTPS` when `NODE_ENV=production`; returns `null` when `NODE_ENV=development` *and* hostname is `localhost`.
146. `validateToolpackUrl("http://10.0.0.5/x")` returns `TOOLPACK_URL_PRIVATE_HOST` (raw IP literal in RFC1918 caught by the static check).
147. `validateToolpackUrl("https://169.254.169.254/latest/meta-data/")` returns `TOOLPACK_URL_PRIVATE_HOST` (cloud metadata IP literal).

**`packages/core/src/__tests__/contracts/toolpack.contract.test.ts`** (extend):

148. `ToolpackEndpointsSchema` rejects `http://` URLs in production via the refinement; accepts `http://localhost:4100` in non-production.

### Layer 2 — Repository (integration)

**`apps/api/src/__tests__/__integration__/db/repositories/organization-toolpacks.repository.integration.test.ts`** (extend):

149. `create` encrypts the new `signingSecret` column (raw blob ≠ `whsec_...` plaintext; decrypts on read).
150. `findByIdScoped` returns the decrypted secret.
151. Rotation flow: `update(id, { signingSecret: <new> })` overwrites with a new ciphertext blob; old plaintext is no longer recoverable.

### Layer 3 — Service (integration)

**`apps/api/src/__tests__/services/toolpack-registration.service.test.ts`** (extend):

152. `fetchSchema` includes `X-Portalai-Signature`, `X-Portalai-Timestamp`, `X-Portalai-Webhook-Id` on the outbound mock request when given a signing secret. Captured via the existing `mockFetch` spy.
153. `fetchSchema` does NOT include signing headers when no secret is provided (legacy / migration / explicit unsigned mode for testing).

**`apps/api/src/__tests__/services/tools.service.test.ts`** (extend):

154. `callWebhook` signs the runtime POST body and includes the three headers; signature verifies against the body the spy captured.
155. `callWebhook` rejects responses larger than `TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES` (1 MB default). Mock returns 1.5 MB; the call throws `TOOLPACK_RUNTIME_TOO_LARGE`.

### Layer 4 — Routes (integration)

**`apps/api/src/__tests__/__integration__/routes/toolpacks.router.integration.test.ts`** (extend):

156. `POST /api/toolpacks` response contains `signingSecret` exactly once, redacts on subsequent `GET /api/toolpacks/:id`. Distinctive prefix (`whsec_`) lets us substring-search the GET response and assert absence.
157. `POST /api/toolpacks/:id/rotate-signing-secret` returns a new secret distinct from the original; the old secret no longer verifies any signature; the on-disk ciphertext changes.

### Layer 5 — Mock server (unit, run against the script)

**`apps/api/src/__tests__/scripts/mock-toolpack-server.test.ts`** (new):

158. With `MOCK_TOOLPACK_SIGNING_SECRET` set: a request without the signature headers gets `401 SIGNATURE_MISSING`.
159. With the secret set: a request with a stale timestamp (>300s old) gets `401 TIMESTAMP_STALE`.
160. With the secret set: a request with a tampered body but valid headers gets `401 SIGNATURE_INVALID`. Round-trip success case (correct signature) returns the expected tool output.

### Test totals

**21 new test cases** (140–160) across helpers, repositories, services, routes, and the mock-server script. No frontend cases in this spec — the dialog edits are simple display-of-a-string and are covered by manual smoke + a single rendering assertion in the plan's frontend slice.

---

## Acceptance criteria

- [ ] Cases 140–160 pass.
- [ ] All existing toolpack route + repository + service tests stay green without modification (the signing infrastructure is additive when no secret is configured; the mock server's verification middleware honors the `MOCK_TOOLPACK_SIGNING_SECRET=<unset>` fallback path).
- [ ] `cd apps/api && npm run test:unit && npm run test:integration` green.
- [ ] `npm run lint && npm run type-check` clean from the repo root.
- [ ] Migration applies cleanly to a fresh DB and to the dev DB; the `migrate-signing-secrets` script replaces every sentinel placeholder with a real encrypted secret.
- [ ] Manual smoke: register a custom toolpack against the mock server (with `MOCK_TOOLPACK_SIGNING_SECRET` set to the secret returned in the registration response). Confirm: (a) the secret appears in the registration response, (b) `GET /api/toolpacks/:id` does not include it, (c) a runtime call from a portal session succeeds, (d) tampering with the mock-server's secret causes the runtime call to fail with `SIGNATURE_INVALID`. Then rotate via the new endpoint; confirm the old secret stops verifying and the new one starts.
- [ ] Manual SSRF check: attempt to register a toolpack with `http://169.254.169.254/x` — registration rejected at the contract layer with `TOOLPACK_URL_PRIVATE_HOST`. Attempt with a hostname that resolves to a private IP via DNS rebinding (use `dns.spoofed-private.example` configured locally) — call-time agent rejects.
- [ ] Manual HTTPS check: in production-like env (`NODE_ENV=production`), register with `http://example.com/x` — rejected with `TOOLPACK_URL_NOT_HTTPS`. Same URL with `https://` succeeds.

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| **Existing toolpacks break because they don't verify signatures.** | They don't have to — phase 6 sends headers, doesn't require the receiver to check them. Existing toolpack servers ignore the new headers and continue to work. P-6.2. |
| **Existing toolpacks break because their URL fails the new SSRF refinement.** | Refinement runs at registration time — no migration-time validation. Already-registered URLs are not re-validated; only new POST/PATCH calls run the static check. The call-time SSRF agent is the canonical guard regardless. |
| **`ssrf-req-filter` agent rejects a legitimate URL** (e.g. an enterprise toolpack hosted on a corp-VPN private IP). | The agent's denylist is the standard RFC1918 + reserved set; legitimate enterprise integrations on private networks are an explicit phase-7 concern (per-org URL allowlist). For v1, the assumption is that toolpacks are public-internet-reachable. Document in the spec; rollback is feature-flagging the agent (env var `TOOLPACK_DISABLE_SSRF_FILTER=true` for emergencies). |
| **The migration script fails or is forgotten; rows are left with the `__pending_phase6_rotation__` sentinel.** | The repository's decrypt helper detects the sentinel and throws `TOOLPACK_SIGNING_SECRET_NOT_INITIALIZED` rather than silently succeeding with garbage. The script is idempotent — re-run replaces the sentinel cleanly. CI checks for the absence of sentinel rows post-migration. |
| **Mock server's "warn-and-skip when env var unset" path masks a misconfiguration in dev.** | The warning is loud (red ANSI). The integration test suite (case 158) sets the env var to enforce verification, so CI catches it. Dev workflows that haven't been updated continue to work — the path is intentional, not a bug. |
| **Replay window of 300s rejects legitimate retries from a slow client.** | 300s is the industry default (Stripe, Slack, Svix). For our use case — synchronous tool invocations from a portal session — call latency is sub-second. The 60s forward-window absorbs minor clock skew. If a real toolpack ever needs more, the constant becomes an env var. |
| **Loss of `ENCRYPTION_KEY` makes every signing secret undecryptable.** | Same operational risk as phase 5's authHeaders. Treat the key as immutable per environment. Rotation is the recovery path: admin rotates each toolpack to receive a fresh secret. |
| **A toolpack that was working under phase 5 fails under phase 6 because of the new SSRF agent.** | Feature flag (`TOOLPACK_DISABLE_SSRF_FILTER=true`) provides a rollback for emergencies without reverting the deploy. Same idea for `TOOLPACK_DISABLE_SIGNING=true` — emergency disable. Both are documented but neither is on by default. |

**Rollback** is a multi-PR sequence:

1. Front-half revert: delete the rotate route, undo the routes/services/repository edits, undo the contract refinement. The `signing_secret` column stays in the DB (NOT NULL), but values aren't read anywhere — no functional impact.
2. Back-half revert (optional): a follow-up migration drops the `signing_secret` column.
3. Rollback of the SSRF agent is independent — flip `TOOLPACK_DISABLE_SSRF_FILTER=true`, redeploy.

The mock server is always-rollback-safe: it only verifies when the env var is set, and the env var is opt-in.

---

## Files touched

### `apps/api`

- New: `src/utils/webhook-signing.util.ts`
- New: `src/utils/url-safety.util.ts`
- New: `src/scripts/migrate-signing-secrets.ts` (one-shot script for the deploy sequence)
- New: `drizzle/0051_add_toolpack_signing_secret.sql` (hand-written, like phase 5)
- Edit: `src/db/schema/organization-toolpacks.table.ts` — add `signingSecret` column.
- Edit: `src/db/schema/type-checks.ts` — add `signingSecret` to skipped opaque-cols list (encrypted text at the table layer, plaintext string at the model layer).
- Edit: `src/db/repositories/organization-toolpacks.repository.ts` — extend encrypt/decrypt helpers to handle `signingSecret`; same eight call sites as phase 5.
- Edit: `src/services/toolpack-registration.service.ts` — sign schema + metadata fetches; route through SSRF-safe agent.
- Edit: `src/services/tools.service.ts` — sign runtime calls; route through SSRF-safe agent; cap response size.
- Edit: `src/routes/toolpacks.router.ts` — return `signingSecret` once on POST; new POST `/:id/rotate-signing-secret` route.
- Edit: `src/scripts/mock-toolpack-server.ts` — `captureRawBody` + `verifySignature` middlewares.
- Edit: `src/environment.ts` — `TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES`, `TOOLPACK_DISABLE_SSRF_FILTER`, `TOOLPACK_DISABLE_SIGNING`.
- Edit: `src/constants/api-codes.constants.ts` — `TOOLPACK_URL_NOT_HTTPS`, `TOOLPACK_URL_PRIVATE_HOST`, `TOOLPACK_RUNTIME_TOO_LARGE`, `TOOLPACK_SIGNING_SECRET_NOT_INITIALIZED`.
- Edit: `package.json` — add `ssrf-req-filter` dependency; add `mock-toolpack` env-var documentation.
- New tests: `__tests__/utils/webhook-signing.util.test.ts`, `__tests__/utils/url-safety.util.test.ts`, `__tests__/scripts/mock-toolpack-server.test.ts`.
- Edit tests: `__tests__/services/toolpack-registration.service.test.ts`, `__tests__/services/tools.service.test.ts`, `__tests__/__integration__/db/repositories/organization-toolpacks.repository.integration.test.ts`, `__tests__/__integration__/routes/toolpacks.router.integration.test.ts`.

### `packages/core`

- New: `src/utils/toolpack-url-safety.util.ts` — sync URL validator used by the contract refinement.
- Edit: `src/contracts/toolpack.contract.ts` — `ToolpackEndpointsSchema` refinement; `ToolpackRotateSigningSecretResponsePayload`; `CustomToolpackRecord.signingSecretStatus`.
- Edit: `src/models/organization-toolpack.model.ts` — add `signingSecret: z.string()` to the model schema (plaintext shape; the storage layer encrypts).
- Edit: `__tests__/contracts/toolpack.contract.test.ts` — case 148.

### `apps/web`

- Edit: `src/components/RegisterToolpackDialog.component.tsx` — display the one-time signing secret on success with a copy-to-clipboard affordance.
- Edit: `src/components/EditToolpackDialog.component.tsx` — "Rotate signing secret" button → opens one-time-display panel.
- Edit: SDK (`api/sdk.ts`, `api/toolpacks.api.ts`) — `rotateSigningSecret` mutation. Cache invalidation on `toolpacks.root`.

### Migrations

- One new migration (`0051_add_toolpack_signing_secret.sql`).
- One new env var (`TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES`); two new emergency-disable env vars (`TOOLPACK_DISABLE_SSRF_FILTER`, `TOOLPACK_DISABLE_SIGNING`).
- One new dev-only env var (`MOCK_TOOLPACK_SIGNING_SECRET`).
