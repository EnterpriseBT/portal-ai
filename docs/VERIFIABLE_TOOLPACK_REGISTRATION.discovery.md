# Verifiable toolpack registration — Discovery

**Issue:** [EnterpriseBT/portal-ai#911](https://github.com/EnterpriseBT/portal-ai/issues/911)

**Why this exists.** Registering a custom toolpack mints a brand-new signing secret and signs the registration-time `GET /schema` and `/metadata` with it. The toolpack server can't know that secret, because the API returns it only in the registration response. So a server that verifies every request can never register, and the reference servers (`packages/demo-toolpack`, the integration doc's snippets) teach builders to leave `/schema` and `/metadata` unverified. The repo's own mock server (`apps/api/src/scripts/mock-toolpack-server.ts`) already verifies every route when given a secret, and that exact configuration is the one that can't register today.

Two smaller defects ride along:
- **The rejection is invisible.** A strict server's 401 on `/schema` comes back as a generic `502 TOOLPACK_SCHEMA_FETCH_FAILED`, with the status buried in the message.
- **A rejected `/metadata` is dropped.** A 401 there is swallowed, so the pack registers without metadata.

PRD gate answers (recorded on the issue):
- every registration path uses the new flow, including the server-side demo seed;
- actors and permissions are unchanged;
- secret rotation keeps today's behaviour;
- a rejected registration fetch shows a specific signature-rejection error in the dialog, and nothing is registered.

This ticket makes the registration fetch signable with a secret the toolpack server already holds, so a builder can verify every call they receive.

## The current shape

### Registration (POST /api/toolpacks)

| Step | Location | Note |
|---|---|---|
| Body contract | `packages/core/src/contracts/toolpack.contract.ts:157` (`RegisterToolpackBodySchema`, `.strict()`) | `{ name, description?, endpoints: {schema, runtime, metadata?}, authHeaders? }` |
| Response contract | `toolpack.contract.ts:182` | `{ toolpack, signingSecret? }` |
| Route | `apps/api/src/routes/toolpacks.router.ts:374` | parse (`:379`) → `resource.write toolpack` (`:395`) → `customToolpacks` entitlement, else `403 TOOLPACK_NOT_ENTITLED` (`:409-420`) → name unique (`:423`) → **`generateSigningSecret()`** (`:440`) → `fetchSchema(…, secret)` (`:443`) → collision check → `fetchMetadata` (`:454`) → insert (`:478`) → 201 with the secret, shown once (`:487-494`) |
| Fetch + sign | `apps/api/src/services/toolpack-registration.service.ts:62` (`fetchWithCap`) | SSRF check (`url-safety.util.ts:102`), `signRequest(secret, "")` on the GET, 30s timeout, 256KB cap |
| Non-OK `/schema` | `toolpack-registration.service.ts:178-184` | any status becomes `502 TOOLPACK_SCHEMA_FETCH_FAILED`; there is no signature-specific code |
| Non-OK `/metadata` | `toolpack-registration.service.ts:224-252` | every failure, 401 included, is swallowed and returns `null` |
| Persistence | `apps/api/src/db/repositories/organization-toolpacks.repository.ts:150-184` | `whsec_…` values are encrypted (AES-256-GCM) on write; nothing is persisted before both fetches pass, and there is no transaction |

### Paths that already work for a strict server

Each of these signs with the **stored** secret, which a configured server already holds:
- **PATCH /:id** (`:535`) re-fetches when `endpoints` change (`:599-623`);
- **POST /:id/refresh** (`:776`, `:804-819`);
- **runtime calls** (`apps/api/src/services/tools.service.ts:411-462`).

Rotation (`:877`) mints a new secret with no outbound call, and stays out of scope.

### Signing scheme (unchanged)

`apps/api/src/utils/webhook-signing.util.ts:43-64`:
- headers: `X-Portalai-Timestamp`, `X-Portalai-Webhook-Id` (a fresh UUID), `X-Portalai-Signature: v1=<hex HMAC-SHA256 of "<ts>.<id>.<body>">`;
- secret format: `whsec_` + 32 random bytes as base64url;
- receivers enforce a 300s window.

### The demo seed path

- **Same service, own code.** `DemoSeedService.registerCustomToolpack` (`apps/api/src/services/demo-seed.service.ts:391-449`) calls the same `fetchSchema`/`fetchMetadata`, but mints its **own** secret (`:400`) and **re-mints it on every re-seed** (`:422`, `:435`).
- **The toolpack learns secrets elsewhere.** The demo toolpack reads its secrets from the Lambda env `PORTALAI_SIGNING_SECRETS` (`packages/demo-toolpack/src/handler.ts:56-58`). That comes from the SSM secret `DEMO_TOOLPACK_SIGNING_SECRETS` (`packages/devops-cli/src/catalog.ts:65-70`) through CFN (`infra/cloudformation/demo-toolpack.yml:34,67`).
- **Only `/runtime` is verified.** It serves `/schema` and `/metadata` openly (`handler.ts:96-99`).

### Web and docs

- **Dialog:** `apps/web/src/components/RegisterToolpackDialog.component.tsx` is a single-step form.
  - The secret appears only after success, in `SigningSecretRevealDialog` (wired in `apps/web/src/views/Toolpacks.view.tsx:485-496`).
  - The TS/Python/C# verify snippets (`:551`, `:597`, `:634`) deliberately let GETs through unverified (`:563-566`).
- **SDK:** `apps/web/src/api/toolpacks.api.ts:45`.
- **Integration doc:** `docs/CUSTOM_TOOLPACK_INTEGRATION.md`, "Which requests you can verify" (`:45-54`, which links this issue), "The signing secret" (`:430`), and the failure-mode table (`:499`).

### Tests pinning today's behaviour

- **API, router:** `toolpacks.router.integration.test.ts` (`:253`, `:304`, `:654-682`).
- **API, service:** `toolpack-registration.service.test.ts` (`:130`, `:420-453`).
- **API, demo seed:** `demo-seed.toolpacks.integration.test.ts` (`:63`, `:99`).
- **demo-toolpack:** `handler.test.ts:41-87` pins the open catalog.
- **Web:** `RegisterToolpackDialog.test.tsx:345` pins "lets the registration-time catalog fetches through in every snippet".

## The design space

### Decision 1 — How the server holds the secret before the first fetch

**A. A secret supplied at registration.** The registration body gains an optional `signingSecret`. The registrant creates it (the dialog generates one in the browser), configures their server with it, then registers. The API signs the fetches with it and stores it. It is one request with no new state, and a failed fetch persists nothing, as today.

**B. Two-phase register.** `POST /` creates a **pending** row and returns its secret, the builder configures the server, then `POST /:id/confirm` fetches and activates the pack. This needs:
- a `status` column and migration;
- a pending lifecycle: expiry or cleanup, hiding pending packs from stations and the agent, and entitlement and permission on confirm;
- a new route in the authorization map;
- a two-step UI.

**C. Unsigned registration fetches**, marked with a distinct header (`X-Portalai-Registration: 1`). The server can tell they're registration fetches but **can't verify them**, so anyone could send that header. This fails the issue's core criterion.

| | A: supplied secret | B: two-phase | C: unsigned + header |
|---|---|---|---|
| Server verifies every call | Yes | Yes | **No** |
| New DB state | None | status column + pending lifecycle | None |
| New routes | None | `/:id/confirm` | None |
| Failure leaves residue | No (nothing persisted) | Yes (pending rows to expire) | No |
| Secret strength | Validated format; browser-generated by default | Server-generated | n/a |
| Builder flow | Get secret → configure → register | Register → configure → confirm | Unchanged |

**Lean: A.** It meets "verify every call" with no new state, route or lifecycle, and keeps today's all-or-nothing registration. B's pending rows are exactly the stranded-state class this codebase works hard to avoid. The dialog generates the secret with `crypto.getRandomValues`, so its strength matches the server's, and the API enforces the `whsec_` + 43-char base64url format, so a weak hand-typed secret is refused.

### Decision 2 — Is the supplied secret required?

- **A. Optional:** when omitted, the API mints one as today and returns it once. API clients and lenient servers keep working unchanged.
- **B. Required:** this breaks every existing API or script caller of `POST /api/toolpacks`.

**Lean: A.** Existing callers must keep working (an acceptance criterion). The dialog always sends one, so the UI path is verifiable by default. The response returns `signingSecret` **only when the API minted it**: echoing a secret the caller just sent adds exposure for nothing.

### Decision 3 — How a rejected registration fetch surfaces

- **A.** Keep `502 TOOLPACK_SCHEMA_FETCH_FAILED`, with the status in the message.
- **B.** A new code, `TOOLPACK_SIGNATURE_REJECTED`, when `/schema` **or** `/metadata` answers 401 or 403. Its message names the signature rejection and the status, and it carries `details: { url, status }`. `/metadata` keeps swallowing every other failure, as an optional endpoint.

**Lean: B.** The PRD requires a specific error. A 401/403 on `/metadata` is a secret mismatch, not an absent optional endpoint, so dropping it silently registered a pack whose server will refuse every runtime call too. Status is **502**: an upstream refused us, not the caller's input. It belongs to the same family as the existing fetch codes.

### Decision 4 — The demo seed

- **A.** The seed reads a configured secret, `DEMO_TOOLPACK_SIGNING_SECRET`, the same value as one entry of the Lambda's allow-list, and registers with it through the shared path. A re-seed reuses it, which ends the per-seed secret churn.
- **B.** The seed generates a secret and pushes it to the Lambda through SSM/CFN. That's infrastructure writes from an app seed, and the wrong layer.

**Lean: A.** The secret already lives in SSM as `DEMO_TOOLPACK_SIGNING_SECRETS`. The API gets the one it should use from the env/config catalog like any other secret. Unset means the seed skips the custom pack, as it does today for an unset `DEMO_TOOLPACK_URL`, and still enables the built-ins. The demo toolpack then verifies `/schema` and `/metadata` too, and its README stops teaching the open-catalog exception.

## Tradeoff comparison

|  | D1: supplied secret | D2: optional | D3: `TOOLPACK_SIGNATURE_REJECTED` | D4: configured demo secret |
|---|---|---|---|---|
| Packages | core, api, web | core, api | api (+ web copy) | api, devops-cli catalog, demo-toolpack, infra docs |
| Contract change | additive body field | none for existing callers | new ApiCode | new env/config key |
| Migration | No | No | No | No |
| Spread to spec | Yes | Yes | Yes | Yes |

## Recommendation

1. `RegisterToolpackBodySchema` gains `signingSecret?: SigningSecret`. Core exports a `SigningSecretSchema`, `/^whsec_[A-Za-z0-9_-]{43}$/`, matching `generateSigningSecret`'s output.
2. `POST /api/toolpacks` signs the `/schema` and `/metadata` fetches with the supplied secret when present, otherwise with a freshly minted one. It stores whichever it used, and returns `signingSecret` only when it minted it.
3. `ToolpackRegistrationService` maps a 401/403 from `/schema` or `/metadata` to `502 TOOLPACK_SIGNATURE_REJECTED` (`details: { url, status }`). `/metadata`'s other failures stay optional. PATCH and refresh inherit the mapping, since they share the fetchers.
4. The register dialog adds a **Signing secret** field prefilled with a browser-generated `whsec_` secret. It has Copy and Regenerate buttons and the copy "Set this on your toolpack server before registering", and always sends the secret. `SigningSecretRevealDialog` is shown only when the API minted the secret.
5. The TS/Python/C# snippets, `docs/CUSTOM_TOOLPACK_INTEGRATION.md` ("Which requests you can verify", "The signing secret", "Testing your verification", the failure table) and `packages/demo-toolpack` verify **every** request, GETs signed over the empty body. The mock toolpack server already does, and becomes registrable.
6. `DemoSeedService.registerCustomToolpack` registers through the same supplied-secret path, using `DEMO_TOOLPACK_SIGNING_SECRET`, which is added to the env schema and the `portalops` catalog. It is reused across re-seeds, and an unset value skips the custom pack.
7. The logger's `BASE_REDACT_PATHS` gains `*.signingSecret` as defense in depth: request bodies aren't serialized into logs today, but the field is now inbound.
8. The register audit, if the route records one, notes `secretSource: "supplied" | "minted"`, never the value.

## Open questions

1. **Should the API reject a supplied secret that's already used by another toolpack in the org?** Reuse makes one server's secret valid for another pack's calls. **Lean: allow it, but warn in the dialog copy.** Rejecting needs a decrypt-and-compare across rows on every registration, and one server hosting several packs with one secret is a legitimate setup.
2. **Should PATCH accept a new `signingSecret`, as a way to rotate onto a builder-chosen secret?** **Lean: no.** Rotation is out of scope per the PRD, and PATCH stays as it is.
3. **When the dialog's generated secret is ignored and the server holds a different one, the user sees `TOOLPACK_SIGNATURE_REJECTED`. Should the error also name the secret's last four characters** to help them spot the mismatch? **Lean: no.** Any fragment of a secret in an error message is a precedent we don't want, and the message points at the doc's verification section instead.
4. **Should the demo toolpack's README keep a note for builders who prefer an open catalog?** **Lean: yes, as an explicitly weaker option.** The integration doc says why verifying everything is now the default.

## Enterprise-scale considerations

- **Concurrency & correctness:** Lean: no new race. Registration stays fetch-then-single-insert, and the existing name-uniqueness check is unchanged. There is no pending state to reconcile.
- **Accuracy & auditability:** Lean: audit the secret's **source**, never its value. Rotation already audits `toolpack.secret.rotate`.
- **Failure modes:** Lean: fail closed, so nothing is persisted on any fetch failure, a signature rejection included. The demo seed fails soft, as it already does: an unset or wrong secret skips the custom pack and keeps the built-ins.
- **Scale & unbounded growth:** N/A, because there is no new fan-out, storage or loop.
- **Multi-tenancy:** Lean: the secret stays per toolpack and org-scoped, encrypted at rest by the existing repository path. A supplied secret is never compared across orgs.
- **Contract stability:** Lean: an additive optional field and one new error code. Existing API callers and registered toolpacks are untouched. Runtime signing is unchanged.
- **Data lifecycle:** N/A, because no new data is retained. The secret replaces what was minted before.

## What this doesn't decide

- **Secret rotation overlap** (a dual-secret window): out of scope per the PRD, to be its own ticket if wanted.
- **Changing the signature scheme** (headers, canonical string, window): out of scope per the issue.
- **Server-generated secrets on request** (a `POST /signing-secrets` endpoint): unnecessary, since the browser generates equivalent ones and the API validates the format.
- **Per-endpoint secrets:** no caller needs them.

## Next step

`docs/VERIFIABLE_TOOLPACK_REGISTRATION.spec.md` pins `SigningSecretSchema`, the body and response contracts, `TOOLPACK_SIGNATURE_REJECTED`, the demo-seed config key and the dialog's field. `.plan.md` then slices it roughly as:

1. the core contract;
2. the API route and service, with the error mapping;
3. the demo seed and config;
4. the web dialog and snippets;
5. demo-toolpack verifying every request;
6. the integration doc.

Each slice is tests first.
