# Deploy-mode config seam (saas vs residency) — Plan

**Implements the `DEPLOY_MODE` seam TDD-sequenced: the pure module + boot guard first, then the auth/webhook wiring, then the lazy Anthropic client.**

Spec: `docs/DEPLOY_MODE_SEAM.spec.md`. Discovery: `docs/DEPLOY_MODE_SEAM.discovery.md`. Issue: #579 (epic #569). Builds on the #565 `TierGrantSource` seam (already merged) — no code dependency, just the entitlement handoff it documents.

3 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/deploy-mode-seam`** — one feature, one PR.

Run tests from `apps/api` (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

**Sequencing rationale** — Slice 1 is the pure/leaf module (`deployMode`, `isSaas`/`isResidency`, the guard) that slices 2–3's wiring reads; it also carries the env + `.env.example` additions together so `env-example-parity.test.ts` never goes red. Slice 2 wires auth-config selection + Stripe-webhook gating onto slice 1's accessors. Slice 3 (lazy Anthropic) is orthogonal — it depends on nothing here — and lands last as self-contained "no vendor client at boot" cleanup.

---

## Slice 1 — `deploy-mode` module + env + boot guard

The foundation: the mode type, accessors, and the pure fail-fast guard, plus the boot-time call site. Default `saas` leaves behavior identical.

**Files**
- New: `apps/api/src/config/deploy-mode.ts` — `DeployMode`, `DEPLOY_MODES`, `parseDeployMode`, `deployMode`, `isSaas`/`isResidency`, `assertDeployModeConsistency(env?)`, `DeployModeConfigError`.
- New: `apps/api/src/__tests__/config/deploy-mode.test.ts`.
- Edit: `apps/api/src/environment.ts` — add `DEPLOY_MODE`, `OIDC_ISSUER`, `OIDC_AUDIENCE` reads.
- Edit: `apps/api/.env.example` — document all three (parity test requires it **this slice**, since the env reads land here).
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `DEPLOY_MODE_CONFIG_INVALID`.
- Edit: `apps/api/src/index.ts` — call `assertDeployModeConsistency()` first in `start()`; `logger.fatal` + `process.exit(1)` on throw; log resolved mode.

**Steps**
1. **Tests (spec: `deploy-mode.test.ts` cases).** `parseDeployMode` accepts `saas`/`residency`, throws on unknown; `assertDeployModeConsistency` (injected env): saas default passes, residency+`STRIPE_SECRET_KEY` throws, residency+`STRIPE_WEBHOOK_SECRET` throws, residency missing `OIDC_ISSUER`/`OIDC_AUDIENCE` throws, residency valid passes, multi-contradiction error lists all; `isSaas`/`isResidency` reflect the mode. Also assert `env-example-parity` still green after the env additions. Run; fail.
2. **Implement** `deploy-mode.ts` + the `environment.ts`/`.env.example`/`api-codes` additions + the `index.ts` guard call. Green.
3. Lint + type-check.

**Done when:** the guard/parse/accessor cases pass; default-saas app still boots (guard inert on a today-valid config); `env-example-parity.test.ts` green. Nothing else references the module yet.

**Risk:** the `index.ts` `process.exit(1)` path can't be unit-tested in-process (it kills the runner) — the guard **logic** is fully unit-tested via `assertDeployModeConsistency`; the exit wiring is covered by smoke. Keep the guard first in `start()` so a contradiction fails before any DB/vendor touch.

---

## Slice 2 — mode-selected auth config + Stripe-webhook gating

Wire slice 1's accessors into the two branch points: `jwtCheck`'s verification config and the Stripe entitlement webhook.

**Files**
- New: `apps/api/src/__tests__/middleware/auth.middleware.test.ts`.
- New: `apps/api/src/__tests__/__integration__/routes/deploy-mode.integration.test.ts`.
- Edit: `apps/api/src/middleware/auth.middleware.ts` — `resolveAuthConfig()`; `jwtCheck = auth({ ...resolveAuthConfig(), tokenSigningAlg: "RS256" })`.
- Edit: `apps/api/src/routes/webhook.router.ts` — wrap `webhookRouter.post("/stripe", …)` in `if (isSaas())`.

**Steps**
1. **Tests (spec: `auth.middleware.test.ts` + `deploy-mode.integration.test.ts`).** Unit: `resolveAuthConfig` (injected mode/env) → saas yields today's exact Auth0 shape (`audience: AUTH0_AUDIENCE`, `issuerBaseURL: https://<AUTH0_DOMAIN>`), residency yields `{ audience: OIDC_AUDIENCE, issuerBaseURL: OIDC_ISSUER }`. Integration: with `DEPLOY_MODE=residency` + OIDC vars + no Stripe key, app boots, `POST /api/webhooks/stripe` → 404, `GET /api/health` → 200; default saas app → `POST /api/webhooks/stripe` is **not** 404 (routes to the signature check). Run; fail.
2. **Implement** `resolveAuthConfig` + the `if (isSaas())` webhook gate. Green.
3. Lint + type-check.

**Done when:** saas auth config equals today's literal (regression pinned); residency omits the Stripe route; `/api/health` unaffected in both.

**Risk:** the integration test imports the real app under `DEPLOY_MODE=residency`, so `resolveAuthConfig(residency)` runs at import — set `OIDC_ISSUER`/`OIDC_AUDIENCE` in the test's env first, or `auth()` may reject an empty `issuerBaseURL` at construction. Mirror the existing integration setup's env handling.

---

## Slice 3 — lazy Anthropic client

Remove the one unconditional vendor client so an agent-less residency install constructs nothing outbound at boot. Mode-independent — pure "no client at import" cleanup.

**Files**
- New/extend: `apps/api/src/__tests__/services/ai.service.test.ts`.
- Edit: `apps/api/src/services/ai.service.ts` — replace the module-load `const anthropic = createAnthropic(…)` with a memoized `getAnthropic()`; update every call site.

**Steps**
1. **Tests (spec: `ai.service.test.ts`).** `getAnthropic()` returns a client and memoizes (same instance twice); importing `ai.service.js` with `ANTHROPIC_API_KEY` absent does not throw. Run; fail.
2. **Implement** the lazy getter; repoint call sites. Green.
3. Lint + type-check.

**Done when:** no Anthropic client is built at module load; agent behavior unchanged (every former `anthropic` reference now `getAnthropic()`).

**Risk:** a missed call site keeps the old binding — grep `anthropic` in `ai.service.ts` to confirm all references route through `getAnthropic()`.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | `deploy-mode.ts` + env + `.env.example` + `DEPLOY_MODE_CONFIG_INVALID` + boot guard | `deploy-mode.test.ts` + `env-example-parity.test.ts` green |
| 2 | `resolveAuthConfig` + Stripe-webhook gating | `auth.middleware.test.ts` + `deploy-mode.integration.test.ts` green |
| 3 | lazy `getAnthropic()` | `ai.service.test.ts` green |

## Cross-slice notes

- **Injectable env is the testability lever** — `assertDeployModeConsistency` and `resolveAuthConfig` take an env/mode argument (defaulting to `environment`/`deployMode`), so the bulk is unit-tested without module-reload tricks. Only the route-gating (module-load registration) needs the one integration test.
- **`.env.example` parity is slice-1-local**, not deferred: the env reads and their docs must land together or `env-example-parity.test.ts` fails at the slice-1 boundary.
- **Doc-sync:** `DEPLOY_MODE` is a new convention, but the seam is **inert until residency siblings land** (#566/#568/#577). Recommend *not* documenting it in `CLAUDE.md`/READMEs yet — the discovery/spec docs carry it — and adding the durable convention note when residency is actually runnable. Flag for the user; if they want a CLAUDE.md line now, it's a one-paragraph add in this PR.
- **Smoke** (`/smoke 579`) refreshes the acceptance walk: default-saas unchanged, residency boots + `/stripe` 404 + no boot-time vendor client, and a contradictory config fails the boot — the last is the manual-only step (needs a real process start).

## Next step

Implementation begins on `feat/deploy-mode-seam`, slice 1 first (tests-first, one commit per slice), only now that discovery + spec + plan are reviewed and confirmed.
