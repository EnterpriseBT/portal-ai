# Deploy-mode config seam (saas vs residency) — Spec

Pins the contract for the `DEPLOY_MODE` boot seam: the `deploy-mode` accessor + fail-fast guard, the mode-selected auth config, the central-infra gating, and the lazy Anthropic client. Builds on [`DEPLOY_MODE_SEAM.discovery.md`](DEPLOY_MODE_SEAM.discovery.md) · [#579](https://github.com/EnterpriseBT/portal-ai/issues/579).

## Key decisions (flag for review)

1. **`DEPLOY_MODE` (`saas` default | `residency`)** parsed in `environment.ts`; a `config/deploy-mode.ts` module owns the type, accessors, and the guard. Default `saas` = today's behavior, byte-for-byte.
2. **Fail-closed on a contradictory config** (guard throws → `index.ts` `process.exit(1)`), the one place the codebase's "absent key ⇒ degrade" gives way to "wrong mode ⇒ refuse to boot" — a residency install silently phoning home is a compliance breach, not a degraded feature.
3. **#579 ships the seam + guardrails + the trivial residency arms** (gate the Stripe webhook; lazy Anthropic; mode-selected auth config). Marketplace entitlement source (#568), OIDC provisioning + bundled issuer (#577), single-org seeding (#566/#583) are documented handoffs.
4. Guard/parse logic is **pure and injectable** (takes an env object) so the bulk is unit-tested without module-reload gymnastics.

## Scope

### In scope
- `DEPLOY_MODE` env + `config/deploy-mode.ts` (type, `deployMode`, `isSaas`/`isResidency`, `assertDeployModeConsistency`).
- Boot guard in `index.ts start()`; `ApiCode.DEPLOY_MODE_CONFIG_INVALID`.
- `resolveAuthConfig()` indirection for `jwtCheck` (Auth0 in saas, generic OIDC in residency).
- Gate `POST /api/webhooks/stripe` registration on `isSaas()`.
- Make the Anthropic client lazy (`getAnthropic()`), so residency constructs no vendor client at boot.
- `.env.example` + parity: `DEPLOY_MODE`, `OIDC_ISSUER`, `OIDC_AUDIENCE`.

### Out of scope
- `AwsMarketplaceGrantSource` / any entitlement writer (#568) — residency `organizations.tier` stays at its seeded value; #579 only guards that residency doesn't use the Stripe source.
- OIDC JIT provisioning, bundled issuer, web-side login (#577).
- Single-org install seeding (#566/#583) — #579 exposes `isResidency()`; the seed action consumes it later.
- Portability seams (`ANTHROPIC_BASE_URL`, S3 endpoint) — #567.
- `apps/web` mode awareness.

## Surface

### `apps/api/src/environment.ts` (edit)
Add, following the existing flag-parse style:
- `DEPLOY_MODE: process.env.DEPLOY_MODE ?? "saas"` — raw string; `deploy-mode.ts` validates it (keeps `environment` a plain reader).
- `OIDC_ISSUER: process.env.OIDC_ISSUER ?? ""` — residency IdP issuer URL (full `https://…`, used as `issuerBaseURL`).
- `OIDC_AUDIENCE: process.env.OIDC_AUDIENCE ?? ""` — residency token audience.

### `apps/api/src/config/deploy-mode.ts` (new)
```ts
export type DeployMode = "saas" | "residency";
export const DEPLOY_MODES: readonly DeployMode[]; // ["saas","residency"]

/** Validate a raw value; throws DeployModeConfigError on an unknown mode. */
export function parseDeployMode(raw: string): DeployMode;

/** The resolved mode for this process (parseDeployMode(environment.DEPLOY_MODE)). */
export const deployMode: DeployMode;
export function isSaas(): boolean;       // deployMode === "saas"
export function isResidency(): boolean;  // deployMode === "residency"

/** Config shape the guard reads — injectable for tests (defaults to `environment`). */
interface DeployModeEnv {
  DEPLOY_MODE: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  OIDC_ISSUER: string;
  OIDC_AUDIENCE: string;
}

/** Throws DeployModeConfigError listing every contradiction. Pure. */
export function assertDeployModeConsistency(env?: DeployModeEnv): void;

export class DeployModeConfigError extends Error {}
```
**Guard assertions** (each a distinct message in the thrown error):
- `residency` + `STRIPE_SECRET_KEY` **or** `STRIPE_WEBHOOK_SECRET` present → contradiction ("residency must not carry central Stripe credentials; entitlement comes from the marketplace").
- `residency` + missing `OIDC_ISSUER` or `OIDC_AUDIENCE` → contradiction ("residency requires OIDC_ISSUER + OIDC_AUDIENCE for the customer IdP").
- unknown `DEPLOY_MODE` value → `parseDeployMode` throws (covers the enum).
- **`saas` is asserted unchanged**: no new required-var check for saas (missing `AUTH0_*` stays today's per-request 401, not a boot failure) — preserves "default saas exactly as today". The only saas assertion: `DEPLOY_MODE` is a known value.

### `apps/api/src/index.ts` (edit)
First statement in `start()`, before `connectDatabase()`:
```ts
try {
  assertDeployModeConsistency();
  logger.info({ deployMode }, "Deploy mode resolved");
} catch (err) {
  logger.fatal({ err, code: ApiCode.DEPLOY_MODE_CONFIG_INVALID },
    "Deploy-mode config is inconsistent — refusing to start");
  process.exit(1);
}
```
(Mirrors the wide-table drift check's `logger.fatal` + `process.exit(1)`.)

### `apps/api/src/constants/api-codes.constants.ts` (edit)
`DEPLOY_MODE_CONFIG_INVALID = "DEPLOY_MODE_CONFIG_INVALID"` (boot-guard log code; no HTTP surface).

### `apps/api/src/middleware/auth.middleware.ts` (edit)
```ts
/** JWT verification config for the active deploy mode:
 *  saas → Auth0 (issuerBaseURL from AUTH0_DOMAIN); residency → OIDC_* verbatim. */
export function resolveAuthConfig(): { audience: string; issuerBaseURL: string };
export const jwtCheck = auth({ ...resolveAuthConfig(), tokenSigningAlg: "RS256" });
```
- saas: `{ audience: AUTH0_AUDIENCE, issuerBaseURL: \`https://${AUTH0_DOMAIN}\` }` (unchanged from today).
- residency: `{ audience: OIDC_AUDIENCE, issuerBaseURL: OIDC_ISSUER }`.
- `resolveAuthConfig` reads `deployMode`; injectable env for tests.

### `apps/api/src/routes/webhook.router.ts` (edit)
Wrap the `webhookRouter.post("/stripe", …)` registration (line ~245) in `if (isSaas())`, so residency does not expose the Stripe entitlement webhook. The GitHub site-rebuild dispatch fires **only** from this path (`billing.service.ts:157`), so it is off in residency by construction — no separate gate. `/auth0/sync` is untouched (identity provisioning is #577).

### `apps/api/src/services/ai.service.ts` (edit)
Replace the module-load `const anthropic = createAnthropic({ apiKey: … })` with:
```ts
let _anthropic: ReturnType<typeof createAnthropic> | undefined;
function getAnthropic() { return (_anthropic ??= createAnthropic({ apiKey: environment.ANTHROPIC_API_KEY })); }
```
Call sites use `getAnthropic()`. No vendor client is constructed at import — an agent-less residency install instantiates nothing outbound at boot. Behavior when the agent *is* used is identical.

### `apps/api/.env.example` (edit)
`DEPLOY_MODE` (TUNABLE, default `saas`), `OIDC_ISSUER`, `OIDC_AUDIENCE` (residency CAPABILITY block) — required by `env-example-parity.test.ts`.

## Migration
None — no schema change (the `tier`/auth columns already exist). Stated explicitly.

## Seed
None.

## TDD test plan

### `apps/api/src/__tests__/config/deploy-mode.test.ts` (unit, new)
- `parseDeployMode`: `"saas"`/`"residency"` pass; `undefined`/`""` → default is applied upstream; unknown (`"prod"`) → throws.
- `assertDeployModeConsistency` (injected env): saas default (no OIDC, Stripe present) passes; residency + `STRIPE_SECRET_KEY` → throws; residency + `STRIPE_WEBHOOK_SECRET` → throws; residency missing `OIDC_ISSUER` → throws; residency missing `OIDC_AUDIENCE` → throws; residency with OIDC set + no Stripe → passes; the error lists **all** contradictions when several hold.
- `isSaas`/`isResidency` reflect the parsed mode.

### `apps/api/src/__tests__/middleware/auth.middleware.test.ts` (unit, new)
- `resolveAuthConfig` (injected mode/env): saas → Auth0 audience + `https://<domain>` issuer; residency → `OIDC_AUDIENCE` + `OIDC_ISSUER` verbatim.

### `apps/api/src/__tests__/services/ai.service.test.ts` (unit, extend/new)
- `getAnthropic()` returns a client and **memoizes** (same instance on repeated calls); importing the module does not throw when `ANTHROPIC_API_KEY` is absent (lazy).

### `apps/api/src/__tests__/__integration__/routes/deploy-mode.integration.test.ts` (integration, new)
- With `DEPLOY_MODE=residency` (+ OIDC vars, no Stripe key) the app imports and boots; `POST /api/webhooks/stripe` → **404** (route unregistered); `GET /api/health` → 200.
- Default (`saas`) app: `POST /api/webhooks/stripe` still routes (400/401 from signature check, **not** 404) — the saas-unchanged regression.

**Totals ≈ 18 cases** (`npm run test:unit` for the three unit suites; `npm run test:integration` for the one integration suite — never raw jest).

## Acceptance criteria
- `DEPLOY_MODE=saas` (default, unset): app behaves exactly as today (Stripe webhook routes, Auth0 auth, agent works).
- `DEPLOY_MODE=residency` with OIDC vars + no Stripe key: boots; `jwtCheck` verifies against the OIDC issuer/audience; the Stripe webhook handler is gone — `POST /api/webhooks/stripe` is no longer serviced by it (unregistered on the webhook router, so it falls through to `/api` → `jwtCheck` → **401**, vs the **400** saas returns from the signature check); no vendor client constructed at boot.
- A contradictory config (residency + Stripe key, or residency missing OIDC) **fails the boot** with `DEPLOY_MODE_CONFIG_INVALID` and a non-zero exit.
- `env-example-parity.test.ts` green (new vars documented).

## Risks & rollback
- **Fail-closed guard** is the deliberate risk: a mode/config mismatch stops the process. Cost/safety: refusing to boot a misconfigured residency install is correct (a silent phone-home is worse). Detection: `logger.fatal` + non-zero exit at start. Rollback: `DEPLOY_MODE` unset ⇒ `saas` ⇒ no guard can trip on a today-valid saas config (saas assertions are enum-only), so the seam is inert for existing deploys.
- **Lazy Anthropic** could regress the agent if a call site kept the old `anthropic` binding — mitigated by replacing every reference with `getAnthropic()` and the memoization test.
- **`resolveAuthConfig`** must return the exact Auth0 shape in saas or every authenticated request breaks — pinned by the unit test asserting saas output equals today's literal.

## Files touched
- `apps/api/src/config/deploy-mode.ts` (new)
- `apps/api/src/environment.ts` (edit)
- `apps/api/src/index.ts` (edit)
- `apps/api/src/constants/api-codes.constants.ts` (edit)
- `apps/api/src/middleware/auth.middleware.ts` (edit)
- `apps/api/src/routes/webhook.router.ts` (edit)
- `apps/api/src/services/ai.service.ts` (edit)
- `apps/api/.env.example` (edit)
- 3 new unit test files + 1 new integration test file

## Next step
`docs/DEPLOY_MODE_SEAM.plan.md` slices this into ~3 TDD commits: (1) `deploy-mode.ts` + env + `DEPLOY_MODE_CONFIG_INVALID` + boot guard + unit tests; (2) `resolveAuthConfig` + Stripe-webhook gating + integration test; (3) lazy `getAnthropic()` + `.env.example` + parity. Each is a testable commit on this branch, with the default-saas regression gating every one.
