# Verifiable toolpack registration — Spec

**Issue:** [EnterpriseBT/portal-ai#911](https://github.com/EnterpriseBT/portal-ai/issues/911) · **Discovery:** `docs/VERIFIABLE_TOOLPACK_REGISTRATION.discovery.md`

This spec pins:
- the optional `signingSecret` on toolpack registration, and the format that validates it;
- the `TOOLPACK_SIGNATURE_REJECTED` error;
- the register dialog's secret field;
- the demo seed's use of the configured secret;
- reference servers and docs that verify every request.

## Key decisions (flag for review)

1. **A secret supplied at registration (D1).** `POST /api/toolpacks` accepts an optional `signingSecret` and signs the `/schema` and `/metadata` fetches with it. No pending state, no new route, no migration. A failed fetch persists nothing, as today.
2. **Optional, never echoed (D2).** When it's omitted, the API mints one and returns it once, as today. When it's supplied, the response has **no** `signingSecret`.
3. **The format is the generator's format.** `whsec_` + exactly 43 base64url characters (32 bytes), which is what `generateSigningSecret()` emits (verified). Anything else is a 400.
4. **`502 TOOLPACK_SIGNATURE_REJECTED` (D3)** when `/schema` **or** `/metadata` answers 401 or 403. Every other `/metadata` failure stays optional (registers without metadata). PATCH and refresh inherit the mapping, since they share the fetchers.
5. **The demo seed reuses the existing allow-list (D4, refined).** The seed reads `DEMO_TOOLPACK_SIGNING_SECRETS`, the same comma-joined SSM secret the demo Lambda reads, and registers with its **first** entry. That's one value per env instead of two that must match.
   - When it's unset, the seed mints a secret as today (the Lambda then runs in its unverified SKIPPED mode).
   - Re-seeds reuse it, which ends the secret churn.
   - *Discovery proposed a new `DEMO_TOOLPACK_SIGNING_SECRET` key; this is the simpler shape.*
6. **Open questions resolved as their leans:**
   - (1) a secret reused across one org's toolpacks is allowed, and the dialog copy warns against it;
   - (2) PATCH accepts no `signingSecret`;
   - (3) errors never include any part of a secret;
   - (4) the demo README keeps an "open catalog" note as an explicitly weaker option.
7. **Fail closed, audit the source.** Nothing is persisted on any rejection. The logger redacts `*.signingSecret`. The secret's value is never audited or logged.

## Scope

### In scope
- Core: `SigningSecretSchema` and an optional `signingSecret` on `RegisterToolpackBodySchema`.
- API:
  - the register route uses the supplied secret;
  - `TOOLPACK_SIGNATURE_REJECTED` in both fetchers;
  - the redact path;
  - the demo seed registers with the configured secret.
- Web: the dialog's secret field (generate, copy, regenerate, validate), the reveal dialog only for minted secrets, and verify-everything snippets.
- `packages/demo-toolpack` verifies `/schema` and `/metadata` when secrets are configured; README.
- Docs: `docs/CUSTOM_TOOLPACK_INTEGRATION.md`, `apps/api/.env.example`, the `catalog.ts` comment.

### Out of scope
- Rotation overlap windows; a builder-chosen secret on PATCH or rotate.
- Any change to the runtime signature scheme or headers.
- Comparing secrets across toolpacks.

## Surface

### Core — `packages/core/src/contracts/toolpack.contract.ts`

```ts
/** A toolpack signing secret: `whsec_` + 32 random bytes, base64url (43 chars). */
export const SigningSecretSchema = z
  .string()
  .regex(
    /^whsec_[A-Za-z0-9_-]{43}$/,
    "Signing secret must be whsec_ followed by 43 characters. Generate one rather than typing it."
  );

export const RegisterToolpackBodySchema = z
  .object({
    name: toolpackNameField(),
    description: descriptionField().min(1).optional(),
    endpoints: ToolpackEndpointsSchema,
    authHeaders: z.record(z.string(), z.string()).optional(),
    /** #911: the secret the toolpack server already holds; omit to have one minted. */
    signingSecret: SigningSecretSchema.optional(),
  })
  .strict();
```

- `UpdateToolpackBodySchema` is unchanged: it doesn't accept `signingSecret`, and `.strict()` refuses it with a 400.
- The JSDoc on `ToolpackRegisterResponsePayloadSchema.signingSecret` changes to say it's present **only when the API minted the secret**.

### API — `apps/api/src/constants/api-codes.constants.ts`

```ts
/** The toolpack server refused a signed registration/refresh fetch (401/403): its secret doesn't match (#911). 502. */
TOOLPACK_SIGNATURE_REJECTED = "TOOLPACK_SIGNATURE_REJECTED",
```

### API — `apps/api/src/services/toolpack-registration.service.ts`

- **`fetchSchema(url, headers, signingSecret)`** keeps its signature. A non-OK `401` or `403` throws `new ApiError(502, ApiCode.TOOLPACK_SIGNATURE_REJECTED, …, { url, status })` with the message:

  > `The toolpack server at <url> rejected the request's signature (<status>). Its signing secret must match the one registered with Portals AI; see "Verifying requests" in the custom toolpack integration guide.`

  Any other non-OK status stays `TOOLPACK_SCHEMA_FETCH_FAILED`.
- **`fetchMetadata(url, headers, signingSecret)`** keeps its signature and returns `null` on every failure **except** `401`/`403`, which throws the same `TOOLPACK_SIGNATURE_REJECTED` (with the metadata URL).
- The error's `details` carry `{ url, status }` and never secret material.

### API — `apps/api/src/routes/toolpacks.router.ts` (POST /, `:374`)

- `const signingSecret = parsed.data.signingSecret ?? generateSigningSecret();` replaces `:440`. The rest of the flow is unchanged: fetch schema, collision check, fetch metadata, insert.
- The 201 payload is `{ toolpack, ...(parsed.data.signingSecret ? {} : { signingSecret }) }`.
- If the route records a registration audit, it adds `secretSource: "supplied" | "minted"`, never the value.
- The `@openapi` block documents the new optional body field and the new 502 code. The request body stays a `$ref` to the registered component (regenerated from the Zod schema if it's derived, hand-updated otherwise).
- PATCH, refresh, rotate and delete are unchanged. PATCH and refresh surface `TOOLPACK_SIGNATURE_REJECTED` through the shared fetchers.

### API — logger, `apps/api/src/utils/logger.util.ts`

`BASE_REDACT_PATHS` gains `"*.signingSecret"`.

### API — demo seed, `apps/api/src/services/demo-seed.service.ts`

`registerCustomToolpack` uses this secret:

```ts
const configured = (process.env.DEMO_TOOLPACK_SIGNING_SECRETS ?? "")
  .split(",").map((s) => s.trim()).find(Boolean);
const signingSecret =
  configured && SigningSecretSchema.safeParse(configured).success
    ? configured
    : generateSigningSecret();
```

- A configured but malformed value logs one warning (naming the variable, never its value) and falls back to minting.
- Everything else, including the existing caught-failure fallback to built-ins only, is unchanged.
- `apps/api/.env.example` documents `DEMO_TOOLPACK_SIGNING_SECRETS` next to `DEMO_TOOLPACK_URL`.
- The `catalog.ts:65-70` comment changes from "catalog-only key" to "read by the Lambda and by `db:demo:seed`".
- `subprocessor-egress-parity.test.ts` classifies the variable as internal.

### Web — `apps/web/src/utils/signing-secret.util.ts` (new)

```ts
/** A fresh `whsec_` secret: 32 bytes from crypto.getRandomValues, base64url. */
export function generateSigningSecret(): string;
```

### Web — `apps/web/src/components/RegisterToolpackDialog.component.tsx`

- **Form state:** `FormState` gains `signingSecret: string`, initialised with `generateSigningSecret()` when the dialog opens. It's regenerated on each open, never persisted.
- **The field:** a **Signing secret** `TextField` (monospace).
  - It has the `required` attribute and validates against `SigningSecretSchema` through the existing `validateWithSchema` path, with the usual `touched`/`errors`/`aria-invalid` handling.
  - Its end adornment holds two `IconButton`s, `aria-label="Copy signing secret"` and `aria-label="Generate a new signing secret"`.
  - Its helper text reads: "Set this secret on your toolpack server before registering. Portals AI signs every request with it, including the schema fetch. Use a different secret for each toolpack."
- **Submit:** the body always includes `signingSecret`.
- **Snippets:** `VERIFY_TS_EXAMPLE`, `VERIFY_PYTHON_EXAMPLE` and `VERIFY_CSHARP_EXAMPLE` verify **every** request. A GET is verified over the empty body, and the "let GETs through" branch and comment (`:563-566`) are removed.
- **Reveal:** `Toolpacks.view.tsx:489` already reveals only when `data.signingSecret` is present. With a supplied secret the response has none, so no reveal shows. No code change is needed there beyond a test.

### `packages/demo-toolpack`

- `handler.ts`: when `signingSecrets()` is non-empty, `GET /schema` and `GET /metadata` are verified exactly like `POST /runtime`, over the empty body, and a failure gets the same 401 response. With no secrets configured, every endpoint is open, as today (SKIPPED mode).
- The README replaces the open-catalog rationale (`:15`) with "verifies every request when `PORTALAI_SIGNING_SECRETS` is set". It keeps a short note that an open catalog is an option but a weaker one.

### Docs — `docs/CUSTOM_TOOLPACK_INTEGRATION.md`

- **"Which requests you can verify" (`:45-54`):** all of them. Remove the #911 caveat.
- **"The signing secret" (`:430`):** generate the secret (the dialog does it), set it on your server, then register. An omitted secret is minted and returned once (for API callers).
- **"Testing your verification" (`:464`):** verify GETs too.
- **The failure-mode table (`:499`):** add `TOOLPACK_SIGNATURE_REJECTED`.

## Migration
## Seed

None: no schema change, and no seed change beyond the demo-seed behaviour above.

## TDD test plan

Run from each package with `npm run test:unit` or `npm run test:integration` (api). Locally, use `-- --testPathPattern <file>`.

### Core — `packages/core/src/__tests__/contracts/toolpack.contract.test.ts` (+6)
- `SigningSecretSchema` accepts a generator-shaped secret.
- It rejects:
  - no prefix;
  - 42 and 44 characters;
  - a `+` or `/` character;
  - an empty string.
- The register body accepts a valid `signingSecret`, rejects a malformed one with a field error, and still accepts its absence.
- The update body refuses `signingSecret` (strict).

### API, unit — `apps/api/src/__tests__/services/toolpack-registration.service.test.ts` (+5)
- `fetchSchema`: 401 and 403 throw `TOOLPACK_SIGNATURE_REJECTED` (502, `details.status`); a 500 is still `TOOLPACK_SCHEMA_FETCH_FAILED`.
- `fetchMetadata`: 401/403 throw `TOOLPACK_SIGNATURE_REJECTED`; a 404 and a 500 still return `null`.
- The error's message and `details` never contain the secret.

### API, integration — `toolpacks.router.integration.test.ts` (+7)
- A supplied secret is used: the mock server, configured with that secret and verifying every route, accepts the schema and metadata fetches. The pack registers, and the response has **no** `signingSecret`.
- The stored secret equals the supplied one: a refresh against the strict mock succeeds.
- An omitted secret is minted and returned once, as today.
- A strict server holding a *different* secret gives `502 TOOLPACK_SIGNATURE_REJECTED`, with nothing persisted (list count unchanged).
- A 401 on metadata only gives the same 502 with nothing persisted; a 404 on metadata registers without metadata.
- A malformed secret is a `400 TOOLPACK_INVALID_PAYLOAD` naming `signingSecret`.
- PATCH with `signingSecret` is a 400 (strict).

### API, integration — `demo-seed.toolpacks.integration.test.ts` (+3)
- With `DEMO_TOOLPACK_SIGNING_SECRETS="<a>,<b>"`, the stored secret is `<a>`.
- A re-seed keeps `<a>`, so there's no churn.
- With the variable unset, a secret is minted (today's behaviour).

### API — logger and parity
- `apps/api/src/__tests__/utils/logger.util.test.ts` (or the redact test that exists): `{ signingSecret }` logs as `[REDACTED]` (+1).
- `subprocessor-egress-parity.test.ts` and `env-example-parity.test.ts` stay green once the variable is classified and documented.

### Web
- **`apps/web/src/__tests__/signing-secret.util.test.ts`** (+2): the format matches `SigningSecretSchema`, and two calls differ.
- **`apps/web/src/__tests__/RegisterToolpackDialog.test.tsx`** (+6, 1 changed):
  - the field is prefilled and valid;
  - Regenerate changes it, and Copy writes it to the clipboard (mocked);
  - a hand-edited malformed value shows a field error with `aria-invalid` and blocks submit;
  - submit sends `signingSecret`;
  - the required attribute is present;
  - **changed:** the snippet test at `:345` now asserts every snippet verifies GETs (no passthrough branch).
- **`apps/web/src/__tests__/Toolpacks.view.test.tsx`** (or the existing view test) (+1): a register response without `signingSecret` shows no reveal dialog.

### `packages/demo-toolpack` — `src/__tests__/handler.test.ts` (+4, 2 changed)
- With secrets set, an unsigned `GET /schema` and `GET /metadata` each give 401 (**changed** from 200).
- Signed GETs give 200.
- With no secrets, every endpoint stays open.

**Totals ≈ 35 cases** (core 6, API 16, web 9, demo-toolpack 4), plus 3 changed.

## Acceptance criteria

- [ ] A toolpack server that rejects every unsigned or badly signed request on every endpoint (the mock server with `MOCK_TOOLPACK_SIGNING_SECRET` set) registers through the dialog with the secret the dialog generated. Its refresh and runtime calls then verify.
- [ ] Toolpacks registered before this change keep running, refreshing and rotating without re-registration.
- [ ] An API caller that omits `signingSecret` registers exactly as before, and the response carries the minted secret once.
- [ ] When the server holds a different secret, the dialog stays open with "rejected the request's signature (401)" and the code `TOOLPACK_SIGNATURE_REJECTED`, and nothing is registered.
- [ ] `portalai demo seed` registers the demo toolpack with the first `DEMO_TOOLPACK_SIGNING_SECRETS` entry, re-seeds keep it, and the deployed demo Lambda verifies `/schema`, `/metadata` and `/runtime`.
- [ ] The integration doc and all three dialog snippets verify every request.

## Risks & rollback

- **Demo Lambda and seed order.** Once the Lambda verifies GETs, a seed that registers with a secret the Lambda doesn't hold fails, and that env's demo falls back to built-ins only. **Release step:** confirm `DEMO_TOOLPACK_SIGNING_SECRETS` is set in each env before deploying the Lambda change, the #854 class of vendor-side step. It goes in the PR body and in the runbook note in the demo-toolpack README.
- **Lenient servers registered today are unaffected.** They ignore signatures, and an omitted secret behaves as before.
- **A secret in transit:** it's in the request body over TLS, as it already is in the response. It's redacted in logs and never in errors. Fail mode: **closed**, so a rejection persists nothing.
- **Rollback:** revert the PR. Registered rows are unchanged in shape: a stored supplied secret is just a secret.

## Files touched

- **Core:** `packages/core/src/contracts/toolpack.contract.ts`, plus its test.
- **API:**
  - `constants/api-codes.constants.ts`;
  - `services/toolpack-registration.service.ts`;
  - `routes/toolpacks.router.ts` (handler and `@openapi`);
  - `utils/logger.util.ts`;
  - `services/demo-seed.service.ts`;
  - `.env.example`;
  - the swagger component (if hand-written);
  - tests: service, router integration, demo-seed integration, logger, egress parity.
- **Web:**
  - `utils/signing-secret.util.ts` (new);
  - `components/RegisterToolpackDialog.component.tsx`;
  - tests: util (new), dialog, view.
- **demo-toolpack:** `src/handler.ts`, `README.md`, `src/__tests__/handler.test.ts`.
- **devops-cli:** the `src/catalog.ts` comment.
- **Docs:** `docs/CUSTOM_TOOLPACK_INTEGRATION.md`.

## Next step

`docs/VERIFIABLE_TOOLPACK_REGISTRATION.plan.md` will sequence about 6 TDD slices on this branch:

1. the core contract;
2. the fetchers' `TOOLPACK_SIGNATURE_REJECTED` and the redact path;
3. the register route using the supplied secret;
4. the demo seed and its config/doc plumbing;
5. the web dialog and snippets;
6. demo-toolpack verifying everything, plus the integration doc.
