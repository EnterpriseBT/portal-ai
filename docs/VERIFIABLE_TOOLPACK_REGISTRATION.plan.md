# Verifiable toolpack registration — Plan

**A TDD-sequenced implementation of a secret supplied at registration. It starts with the contract and the fetchers' signature-rejection error, then wires the register route and the demo seed, then the dialog, and ends with the reference servers and docs that verify every request.**

Spec: `docs/VERIFIABLE_TOOLPACK_REGISTRATION.spec.md`. Discovery: `docs/VERIFIABLE_TOOLPACK_REGISTRATION.discovery.md`. Issue: #911. Builds on the shipped signing scheme (`apps/api/src/utils/webhook-signing.util.ts`), which this ticket doesn't change.

Six slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/911-verifiable-toolpack-registration`**, giving one feature and one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly; `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit -- --testPathPattern toolpack
cd apps/api && npm run test:unit -- --testPathPattern <file>
cd apps/api && npm run test:integration -- --testPathPattern <file>
cd apps/web && npm run test:unit -- --testPathPattern <file>
cd packages/demo-toolpack && npm run test:unit
```

Each slice: (1) write failing tests; (2) make the smallest change that turns them green; (3) run the focused tests; (4) run `npm run lint && npm run type-check` in each touched package; (5) move to the next slice.

Sequencing rationale: leaf contract first, then API behaviour inside out, then the consumers that rely on it.

- **Slice 1:** `SigningSecretSchema` and the optional body field. Every later slice imports the schema.
- **Slice 2:** the fetchers' `TOOLPACK_SIGNATURE_REJECTED` and the log redaction. This is pure service behaviour. The route, PATCH, refresh and the seed all go through these fetchers, so they inherit it.
- **Slice 3:** the register route uses the supplied secret, and stops echoing it back. This is the issue's core acceptance criterion.
- **Slice 4:** the demo seed registers with `DEMO_TOOLPACK_SIGNING_SECRETS`. It needs slice 1's schema and slice 2's errors.
- **Slice 5:** the web dialog's secret field and verify-everything snippets. It sends the field slice 3 now honours.
- **Slice 6:** demo-toolpack verifies GETs, plus the integration doc and READMEs. These describe the shipped behaviour, so they go last, and the Lambda change is the one with a release-order step.

No migration.

---

## Slice 1 — Signing-secret contract

Core exports `SigningSecretSchema`, and the register body accepts an optional `signingSecret`.

**Files**

- Edit: `packages/core/src/contracts/toolpack.contract.ts`:
  - add `SigningSecretSchema` and the `signingSecret` field on `RegisterToolpackBodySchema`;
  - update the JSDoc on `ToolpackRegisterResponsePayloadSchema.signingSecret` ("present only when the API minted it").
- Edit: `packages/core/src/__tests__/contracts/toolpack.contract.test.ts` (+6).

**Steps**

1. **Tests (spec § TDD Core ×6).**
   - The schema accepts a generator-shaped value.
   - It rejects:
     - no prefix;
     - 42 and 44 characters;
     - a `+` or `/` character;
     - an empty string.
   - The body accepts a valid `signingSecret`, rejects a malformed one with a field error, and still accepts its absence.
   - `UpdateToolpackBodySchema` refuses `signingSecret`.
   - Build the fixture with the same expression as `generateSigningSecret`: `whsec_` + `randomBytes(32).toString("base64url")`.
   - Run them and confirm they fail.
2. **Implement.** Turn the tests green.
3. Lint + type-check `packages/core`. Then run `npm run build --workspace=packages/core`, because api and web consume the built output.

**Done when:** the 6 cases pass, and `strict-request-bodies.test.ts` (core) is still green.

**Risk:** the API now accepts the field and ignores it until slice 3, so a caller sending one would get a minted secret. This only exists between commits on this branch and never ships, so it's acceptable.

---

## Slice 2 — Signature rejection in the fetchers, plus log redaction

A 401 or 403 from `/schema` or `/metadata` becomes `502 TOOLPACK_SIGNATURE_REJECTED`, and `signingSecret` is redacted in logs.

**Files**

- Edit: `apps/api/src/constants/api-codes.constants.ts`: add `TOOLPACK_SIGNATURE_REJECTED`, with its JSDoc.
- Edit: `apps/api/src/services/toolpack-registration.service.ts`:
  - in `fetchSchema`, add a 401/403 branch before the generic non-OK branch;
  - in `fetchMetadata`, throw on 401/403 inside the `try` without the `catch` swallowing it: rethrow `ApiError`s with that code and keep returning `null` for everything else.
- Edit: `apps/api/src/utils/logger.util.ts`: add `"*.signingSecret"` to `BASE_REDACT_PATHS`.
- Edit: `apps/api/src/__tests__/services/toolpack-registration.service.test.ts` (+5).
- Edit: the logger redact test that exists (find it with `grep -rln BASE_REDACT_PATHS apps/api/src/__tests__`) (+1).

**Steps**

1. **Tests (spec § TDD API unit ×5, logger ×1).**
   - `fetchSchema`: 401 and 403 give `TOOLPACK_SIGNATURE_REJECTED` with status 502 and `details.status`; a 500 still gives `TOOLPACK_SCHEMA_FETCH_FAILED`.
   - `fetchMetadata`: 401/403 throw; a 404 and a 500 return `null`.
   - Neither the message nor `details` contains the secret passed in.
   - Logging `{ signingSecret: "whsec_…" }` gives `[REDACTED]`.
   - Run them and confirm they fail.
2. **Implement.** Turn the tests green.
3. Lint + type-check `apps/api`. Run the existing router integration suite too: the metadata test at `:304` asserts today's "swallow" on a non-OK status, so check whether it uses 401/403. If it does, change its status to 500, since swallowing still holds there, and say so in the commit.

**Done when:** the 6 cases pass, and the existing service and router suites are green.

**Risk:** this changes `fetchMetadata`'s documented "never throws" behaviour. Update its JSDoc in the same commit.

---

## Slice 3 — The register route uses the supplied secret

`POST /api/toolpacks` signs with `body.signingSecret` when present, stores it, and doesn't echo it back.

**Files**

- Edit: `apps/api/src/routes/toolpacks.router.ts` (POST `/`, `:440` and `:487-494`):
  - `signingSecret = parsed.data.signingSecret ?? generateSigningSecret()`;
  - the response includes `signingSecret` only when minted;
  - the audit gains `secretSource`, if the route records a registration audit;
  - the `@openapi` block documents the new field and 502 code.
- Edit, if hand-written: the swagger component for the register body (`src/config/swagger.config.ts`).
- Edit: `apps/api/src/__tests__/__integration__/routes/toolpacks.router.integration.test.ts` (+7).

**Steps**

1. **Tests (spec § TDD API integration ×7).**
   - First add a **strict fetch mock** helper to the file. It recomputes `v1=` HMAC-SHA256 over `<ts>.<id>.` (an empty body for GETs) using an expected secret, through the existing signing util (or its verify counterpart, if the util exports one). It returns `fetchOk(...)` on a match and `{ ok: false, status: 401 }` otherwise.
   - The cases:
     - a supplied secret registers against the strict mock, with no `signingSecret` in the response;
     - a refresh against the strict mock succeeds, proving the stored secret is the supplied one;
     - an omitted secret is minted and returned once;
     - a mismatched secret gives `502 TOOLPACK_SIGNATURE_REJECTED`, and the toolpack list count is unchanged;
     - a 401 on metadata only gives the same 502, and nothing is persisted;
     - a 404 on metadata registers without metadata;
     - a malformed secret gives `400 TOOLPACK_INVALID_PAYLOAD` naming `signingSecret`;
     - PATCH with `signingSecret` is a 400.
   - Run them and confirm they fail.
2. **Implement** the route change. Turn the tests green.
3. Lint + type-check `apps/api`, then run the whole toolpacks router integration file, including the existing one-time-reveal test at `:654`, which must still pass because it omits the secret.

**Done when:** the 7 new cases and every existing router case pass.

**Risk:** the swagger component may be generated from the Zod schema. If so, there's nothing to edit. Check before hand-editing.

---

## Slice 4 — Demo seed uses the configured secret

`DemoSeedService.registerCustomToolpack` registers with the first `DEMO_TOOLPACK_SIGNING_SECRETS` entry, reused across re-seeds.

**Files**

- Edit: `apps/api/src/services/demo-seed.service.ts` (`:391-449`): the secret-resolution block from the spec, with one warning for a malformed value that names the variable, never the value.
- Edit: `apps/api/.env.example`: document `DEMO_TOOLPACK_SIGNING_SECRETS` next to `DEMO_TOOLPACK_URL` (`:386-388`).
- Edit: `apps/api/src/__tests__/subprocessor-egress-parity.test.ts`: classify the variable as internal.
- Edit: `packages/devops-cli/src/catalog.ts` (`:65-70`): change the comment to "read by the demo Lambda and by `db:demo:seed`".
- Edit: `apps/api/src/__tests__/__integration__/services/demo-seed.toolpacks.integration.test.ts` (+3).

**Steps**

1. **Tests (spec § TDD demo seed ×3).**
   - With `"<a>,<b>"` set, the stored secret is `<a>`.
   - A re-seed keeps `<a>`.
   - With the variable unset, a secret is minted.
   - Save and restore `process.env` per test.
   - Run them and confirm they fail.
2. **Implement.** Turn the tests green.
3. Lint + type-check `apps/api` and `packages/devops-cli`. Run `env-example-parity.test.ts` and `subprocessor-egress-parity.test.ts`. Rebuild devops-cli, since `npx portalops` runs its `dist/`.

**Done when:** the 3 cases pass, and both parity tests are green.

**Risk:** none in code. The release-order risk sits with slice 6.

---

## Slice 5 — Register dialog: secret field and verify-everything snippets

The dialog generates, shows and sends a signing secret, and its snippets verify GETs.

**Files**

- New: `apps/web/src/utils/signing-secret.util.ts` (`generateSigningSecret` via `crypto.getRandomValues`, base64url).
- New: `apps/web/src/__tests__/signing-secret.util.test.ts` (+2).
- Edit: `apps/web/src/components/RegisterToolpackDialog.component.tsx`:
  - `FormState.signingSecret`, generated each time the dialog opens;
  - the field, with Copy and Regenerate icon buttons (with `aria-label`s), the helper copy and the `required` attribute;
  - the body includes it;
  - the three verify snippets drop the GET passthrough (`:563-566`).
- Edit: `apps/web/src/__tests__/RegisterToolpackDialog.test.tsx` (+6, the `:345` case changed).
- Edit: `apps/web/src/__tests__/Toolpacks.view.test.tsx` (or the existing view test) (+1): no reveal when the response has no `signingSecret`.

**Steps**

1. **Tests (spec § TDD Web ×9).**
   - util: the format matches `SigningSecretSchema`, and two calls differ;
   - dialog: the field is prefilled and valid; Regenerate changes it; Copy calls a mocked `navigator.clipboard.writeText`;
   - a malformed value shows an error with `aria-invalid` and blocks submit;
   - submit sends `signingSecret`;
   - the `required` attribute is present;
   - the snippets verify GETs;
   - the view shows no reveal when the response has no secret.
   - Run them and confirm they fail.
2. **Implement.** Generate in an effect keyed on `open`, or in the `INITIAL_FORM` reset path the dialog already uses. Don't call `crypto` during render, since `react-hooks/purity` fails on an impure render. Turn the tests green.
3. Lint + type-check `apps/web`. Run the dialog-contract, name-length and permission-copy guards; the helper copy names no role.

**Done when:** the 9 cases pass, and the web guards are green.

**Risk:** the field is user-editable, so an operator can paste their server's existing secret. That's intended, and validation covers malformed input.

---

## Slice 6 — Reference servers and documentation

The demo toolpack verifies every request when secrets are configured, and every doc teaches verify-everything.

**Files**

- Edit: `packages/demo-toolpack/src/handler.ts`: verify `GET /schema` and `GET /metadata` over the empty body when `signingSecrets()` is non-empty, with the same 401 as `/runtime`; update the SKIPPED-mode comment.
- Edit: `packages/demo-toolpack/src/__tests__/handler.test.ts` (+4, 2 changed).
- Edit: `packages/demo-toolpack/README.md`:
  - `:15` becomes "verifies every request when `PORTALAI_SIGNING_SECRETS` is set", with the open-catalog note as a weaker option;
  - the ops steps (`:36-39`) gain the **release order**: set `DEMO_TOOLPACK_SIGNING_SECRETS` before deploying this version.
- Edit: `docs/CUSTOM_TOOLPACK_INTEGRATION.md`:
  - "Which requests you can verify" (`:45-54`) becomes all of them, with the #911 caveat removed;
  - "The signing secret" (`:430`) becomes generate, set it, then register (an omitted secret is minted and returned once);
  - "Testing your verification" (`:464`) adds GETs;
  - the failure table (`:499`) gains `TOOLPACK_SIGNATURE_REJECTED`.
- Check: `apps/api/src/scripts/mock-toolpack-server.ts` already verifies every route. No code change; update its header comment only if it mentions the registration exception.

**Steps**

1. **Tests (spec § TDD demo-toolpack ×4).**
   - With secrets set, unsigned `GET /schema` and `GET /metadata` give 401. These two cases change from today's 200.
   - Signed GETs give 200.
   - With no secrets, everything is open.
   - Run them and confirm they fail.
2. **Implement** the handler change, then edit the docs. Turn the tests green.
3. Lint + type-check `packages/demo-toolpack`. Run `npm run lint:doc-pointers` and the permission-copy guards (api and web), because they scan the durable `docs/`.

**Done when:** the demo-toolpack suite and the doc guards are green, and `grep -n "911\|unverified" docs/CUSTOM_TOOLPACK_INTEGRATION.md packages/demo-toolpack/README.md` finds no stale exception text.

**Risk:** this slice carries the **release-order** risk. Once deployed, a demo env whose seed registers with a secret the Lambda doesn't hold falls back to built-ins only. Record this in the PR body as a pre-release step (#854 class).

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | `SigningSecretSchema` + optional body field | core ×6; core rebuilt |
| 2 | `TOOLPACK_SIGNATURE_REJECTED` in both fetchers + `*.signingSecret` redaction | api unit ×6; existing suites green |
| 3 | Register route uses the supplied secret, no echo | api integration ×7 (strict fetch mock) |
| 4 | Demo seed uses `DEMO_TOOLPACK_SIGNING_SECRETS`[0] | api integration ×3; parity tests |
| 5 | Dialog secret field + verify-everything snippets | web ×9 (1 changed); web guards |
| 6 | demo-toolpack verifies GETs; integration doc + READMEs | demo-toolpack ×4 (2 changed); doc guards |

Total ≈ 35 new cases plus 3 changed, matching the spec.

## Cross-slice notes

- **The core change ripples outward.** After slice 1, rebuild core before running the api and web suites. Before pushing, run the full root `npm run build && npm run type-check && npm run lint`, since a new core field can break typed fixtures elsewhere (memory: core model change → full build).
- **`fetchMetadata` changes contract** in slice 2: it can now throw. Every caller (the route, PATCH, refresh, the demo seed) already sits inside error handling that maps `ApiError`s. The demo seed's catch-all keeps built-ins on any failure, which is the intended behaviour.
- **Strict-mock testing.** The router integration tests mock `fetch`, so the strict server is a fetch mock that verifies the signature. The real `mock-toolpack-server.ts` with `MOCK_TOOLPACK_SIGNING_SECRET` set is exercised in the smoke walk, not in jest.
- **Docs in the same PR.** `CUSTOM_TOOLPACK_INTEGRATION.md`, the dialog snippets, the demo README and `.env.example` change together (CLAUDE.md "Keeping Documentation in Sync": the custom-tool wire contract). The glossary and FAQ don't mention signing (check with `grep -n "sign" packages/core/src/content/*.ts` during slice 6).
- **Release step.** Put the `DEMO_TOOLPACK_SIGNING_SECRETS` pre-deploy check in the PR body's summary, so it travels with the merge.

## Next step

Implementation begins on this branch with slice 1, tests first, one commit per slice, once discovery, spec and plan are confirmed.
