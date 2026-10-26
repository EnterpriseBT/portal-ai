# E2E browser verification — Spec

**Issue:** [EnterpriseBT/portal-ai#489](https://github.com/EnterpriseBT/portal-ai/issues/489) · **Discovery:** `docs/E2E_BROWSER_VERIFICATION.discovery.md`

This spec pins the contract for three browser-verification tiers that share one sign-in library:
- **PR walk:** a fresh org walked through the core loop on an ephemeral CI stack (`e2e-test.yml`).
- **Post-deploy login check:** a `verify-login` job at the end of `deploy-dev.yml` / `deploy-prod.yml`.
- **Agent sessions:** per-env Playwright MCP servers for app-dev and prod, signed in as a QA identity confined to its own QA org.

## Key decisions (flag for review)

Discovery decisions D1–D5 and open questions Q1–Q6 are ratified here, taking each discovery lean as the answer.

1. **D1 — build-flagged QA sign-in.** `VITE_AUTH0_QA_CONNECTION` (an Auth0 connection name) makes `/login?qa=1` render **QA sign-in**, pinned to that connection. When unset, nothing renders. The #304 `DEV` + `?e2e` affordance is unchanged. The security boundary is Auth0-side: sign-ups disabled, one user, brute-force protection.
2. **D2 — PR-stack auth** is a dedicated CI user in the **local/dev** Auth0 tenant. **Refinement of discovery:** the CI web is a production build (`vite preview`), which strips the `DEV`-only affordance, so CI signs in through the **QA sign-in path** (D1) with `VITE_AUTH0_QA_CONNECTION` set to the CI user's connection. The PR run therefore exercises the same sign-in code the deployed check uses. The fresh DB's first login self-provisions the org (`ApplicationService.ensureProvisioned`, personal-org fallback), so no `db:seed:org` runs.
3. **D3 — an Anthropic stub** behind `ANTHROPIC_BASE_URL` answers interpret's two `generateObject` calls with schema-valid "no confident match" objects. The classifier's names every candidate from the prompt with `columnDefinitionId: null`, so the parser binds each column to the seeded `text` definition. An empty list would leave them unbound, and the commit's drift check refuses that. Columns fall back to `text`.
4. **D4 — one MCP server per env** (`playwright`, `playwright-app-dev`, `playwright-prod`). Each deployed server is fenced by `--allowed-origins`.
5. **D5 — no browser service.** CI installs Chromium on the runner and caches it by Playwright version.
6. **Q1 MFA:** if a tenant enforces MFA, the QA user is exempted **by connection** in the tenant's MFA Action (runbook step), not by switching MFA off tenant-wide.
7. **Q2 deploy role:** it is not narrowed. It already reads `portalai/<env>/*`.
8. **Q3 login assertion:** `GET /api/organization/current` → 200 **and** `GET /api/organization/memberships` lists exactly one org, both within 30s. A sign-in loop or a broken API fails it.
9. **Q4 CloudFront:** `verify-login` waits on the deploy's invalidation id before running.
10. **Q5 fork PRs:** `e2e-test.yml` skips with a notice when `E2E_CI_AUTH0_PASSWORD` is empty.
11. **Q6 metrics skew:** recorded in the runbook only.
12. **Secrets hygiene:**
    - deployed targets run with `trace: "off"`, no HTML report and no `storageState` written to the artifact dir;
    - per-env state files are mode `0600` under the git-ignored `.auth/`;
    - QA password rotation invalidates every captured state.
13. **Fail modes:**
    - `login` has `retries: 0`, so a flake must surface;
    - `core-loop` has `retries: 1`, with the trace kept on the retry;
    - `verify-login` fails the deploy run red and never rolls back.

## Scope

### In scope

1. A shared sign-in library and the env-aware `e2e:auth --env` in `packages/e2e`.
2. Playwright projects `setup`, `core-loop` and `login`; scripts `test:e2e` / `test:e2e:ui`; the Turbo task.
3. The core-loop spec and the login spec.
4. An Anthropic stub server, plus `s3mock` in `docker-compose.yml` under an `e2e` profile, and `scripts/e2e-stack.sh up|down`, which boots the stack for CI and local runs alike.
5. The `e2e-test.yml` PR workflow (non-required).
6. The web QA sign-in affordance (`VITE_AUTH0_QA_CONNECTION`).
7. A `webBaseUrl` field and QA-secret catalog entries in `cli-env` / `devops-cli`.
8. A `verify-login` job in both deploy workflows.
9. Per-env MCP servers in `.mcp.json`.
10. A runbook (`docs/E2E_DEPLOYED_QA.runbook.md`), README and `CLAUDE.md` updates.

### Out of scope

- Customer-org access or impersonation.
- Automatic rollback.
- Live LLM calls in CI.
- Making `E2E Tests` a required check.
- `/smoke-walk` against deployed envs.
- Specs beyond the core loop.
- Visual regression.
- Excluding the QA org from analytics.

## Surface

### Web — QA sign-in (`apps/web`)

**`apps/web/src/utils/runtime-config.util.ts`**: extend the build-time Auth0 settings. No runtime-config key is added; the value is baked, like the other `VITE_AUTH0_*`.

```ts
interface ViteAuthEnv { /* …existing… */ VITE_AUTH0_QA_CONNECTION?: string; }
export interface Auth0Settings { domain: string; clientId: string; audience: string;
  /** #489: Auth0 connection for the deployed QA identity; "" ⇒ no QA sign-in. */
  qaConnection: string; }
// readAuth0Settings: qaConnection: env?.VITE_AUTH0_QA_CONNECTION?.trim() ?? ""
```

**`apps/web/src/providers/Auth.provider.tsx`**: `AuthLogin` gains a new method.

```ts
/** #489: Auth0 login pinned to the QA connection. No-op when unset or under OIDC. */
withQaConnection: () => void;
```

- The Auth0 bridge calls `loginWithRedirect({ openUrl, appState: auth0ReturnToAppState(), authorizationParams: { connection: resolveAuth0Settings().qaConnection, redirect_uri: window.location.origin } })`.
- The OIDC bridge's version is `() => {}`, since residency never offers it.
- The story stub in `Authorized.layout.stories.tsx` gains the field.

**`apps/web/src/components/LoginForm.component.tsx`**:
- `LoginFormUIProps` gains `onClickQaLogin?: () => void`. When it's set, a text button `data-testid="e2e-qa-login"` labelled **QA sign-in** renders below the dev button.
- `LoginForm` computes `showQaLogin = !isOidc && resolveAuth0Settings().qaConnection !== "" && new URLSearchParams(window.location.search).has("qa")`.
- `?qa` survives the `/login` redirect, because `Authorized.component.tsx:61-63` already preserves search.

**Egress guard:** `VITE_AUTH0_QA_CONNECTION` is classified as **internal** (a connection name; no new host) in `subprocessor-browser-egress.guard.test.ts`.

### `cli-env` — web URL

**`packages/cli-env/src/registry.ts`**: `EnvironmentDefinitionSchema` gains `webBaseUrl: z.url().optional()`. It's optional so existing `~/.portalai/environments.json` overrides still parse. The built-ins become:
- `local`: `http://localhost:3000`
- `app-dev`: `https://app-dev.portalsai.io`
- `prod`: `https://app.portalsai.io`

### `devops-cli` — catalog

**`packages/devops-cli/src/catalog.ts`**: add `secret("QA_AUTH0_USERNAME", "qa-auth0-username")` and `secret("QA_AUTH0_PASSWORD", "qa-auth0-password")`. They resolve to `portalai/<dev|prod>/qa-auth0-{username,password}`. They are not in `backend.yml` (the API never reads them), and the deploy-parity test only checks that direction.

### `packages/e2e` — library and projects

New **`src/lib/sign-in.ts`**: the Universal Login driver, moved out of `auth.setup.ts:101-144` unchanged in behaviour.

```ts
export type SignInVia = "dev" | "qa"; // dev: /?e2e=1 → e2e-dev-login; qa: /login?qa=1 → e2e-qa-login
export interface SignInOptions { baseUrl: string; username: string; password: string; via: SignInVia; timeoutMs?: number /* 60_000 */ }
/** Drives the affordance → Universal Login; resolves once `@@auth0spajs@@` is in localStorage. Throws E2eSignInError. */
export async function signIn(page: Page, opts: SignInOptions): Promise<void>;
export class E2eSignInError extends Error {}  // never includes the password in its message
```

New **`src/lib/target.ts`**: resolves where a run points, and with which credentials.

```ts
export type E2eTargetName = "local" | "app-dev" | "prod";
export interface E2eTarget { name: E2eTargetName; baseUrl: string; apiBaseUrl: string; via: SignInVia; deployed: boolean }
/** E2E_TARGET (default "local") → cli-env BUILTIN_ENVIRONMENTS; E2E_BASE_URL still overrides baseUrl. */
export function resolveTarget(env?: NodeJS.ProcessEnv): E2eTarget;
/** local: E2E_AUTH0_USERNAME/PASSWORD[_<ID>]; deployed: env vars if both set (CI), else cli-env getSecret(def, "qa-auth0-*"). */
export async function resolveCredentials(target: E2eTarget, identity?: string): Promise<{ username: string; password: string }>;
/** .auth/storageState.json | .auth/<id>.storageState.json (local, unchanged) · .auth/<env>/owner.storageState.json (deployed) */
export function storageStatePath(target: E2eTarget, identity?: string): string;
```

`via` is `"dev"` for `local` and `"qa"` for deployed targets. `E2E_SIGN_IN_VIA=dev|qa` overrides it; the PR workflow sets `qa`, because its preview build has no dev affordance. A deployed target refuses `identity`: it has only the QA owner.

**`src/setup/auth.setup.ts`** (the `e2e:auth` CLI) becomes a thin wrapper over `resolveTarget`, `resolveCredentials`, `signIn` and `storageStatePath`:
- it accepts `--env <local|app-dev|prod>`, which sets `E2E_TARGET`, alongside `--identity`;
- it writes the state with `mode: 0o600`;
- existing local invocations behave exactly as today.

**`playwright.config.ts`**: `testDir: ./src/specs`. Projects:

| Project | testMatch | storageState | retries | Notes |
|---|---|---|---|---|
| `setup` | `setup/session.setup.ts` | — | 0 | `signIn` as the CI user → `.auth/ci.storageState.json` (local target only) |
| `core-loop` | `core-loop.spec.ts` | `.auth/ci.storageState.json` | 1 | `dependencies: ["setup"]` |
| `login` | `login.spec.ts` | none (fresh context) | 0 | the only spec that signs in itself; runs against any target |

Settings that switch on `resolveTarget().deployed`:
- `trace` is `"on-first-retry"` locally and `"off"` when deployed;
- `screenshot` is `"only-on-failure"` and `video` is `"retain-on-failure"` in both cases;
- the `reporter` is `[["list"], ["html", { open: "never" }]]` locally and `[["list"]]` when deployed;
- `outputDir` is `test-results/<target>/`.

**`src/specs/core-loop.spec.ts`**: one serial `describe` against a freshly provisioned org.
1. `/` renders Dashboard.
2. `/connectors` → Catalog → File Upload's **Connect** → upload `src/fixtures/core-loop.csv` (a plain 3-column table). The steps after that:
   - drag a region over A1:C4 (a real mouse drag; the canvas reads pointer geometry);
   - **+ Add row axis**;
   - **Create new entity** with label `E2E People <run>`;
   - **Interpret** (via the stub) → **Commit plan** → the new connector's page lists `e2e_people_<run>`.
3. `/entities` → that entity → its records show the fixture's values.
4. `/stations` → **New Station** `E2E Station <run>` → its detail page.
5. **Open Portal** → `/portals/$portalId` renders the composer and names the station.
6. A `page.on("console")` collector fails the test on any `error`-level message not in an explicit `ALLOWED_CONSOLE` list (empty to start).

Selectors are role- or label-based. Test ids are added only where no accessible name exists, and each one gets listed in the plan.

**`src/specs/login.spec.ts`**:
- `resolveTarget()` → `signIn(page, { via: target.via, ... })`.
- `page.waitForResponse` asserts `${apiBaseUrl}/api/organization/current` returns 200.
- `GET /api/organization/memberships` must return exactly 1 membership. This holds the "QA identity has one org" invariant on every run.
- The Dashboard heading renders. A single-org user sees no org name anywhere to assert on.
- All three checks fit a 30s budget.

**Scripts (`packages/e2e/package.json`)**: `test:e2e` = `playwright test`, and `test:e2e:ui` = `playwright test --ui`. `e2e:auth` gains the `--env` pass-through. New scripts `e2e:auth:app-dev` (`--env app-dev`) and `e2e:auth:prod` (`--env prod`). New `e2e:stub:anthropic` = `tsx src/stubs/anthropic-stub.ts`. `@portalai/cli-env` is added as a dependency.

**Turbo:** `turbo.json` gains `"test:e2e": { "cache": false }`, and root `package.json` gains `"test:e2e": "turbo run test:e2e"`.

### Anthropic stub — `packages/e2e/src/stubs/anthropic-stub.ts`

- An HTTP server on `E2E_ANTHROPIC_STUB_PORT` (default `4010`).
- `POST /v1/messages` reads the JSON schema the request asks for. The AI SDK's native structured output (`output_config.format.schema`) is answered with a `text` block and `end_turn`; tool mode (one tool's `input_schema`) is answered with `tool_use`.
  - `classifications` in the schema → one `{ sourceHeader, columnDefinitionId: null, confidence: 0 }` per `- sourceHeader: "…"` line in the prompt (`buildClassifierPrompt`'s format);
  - `name` + `confidence` in the schema → `{ name: "value", confidence: 0 }`;
  - anything else → `400 { error: "e2e stub: unrecognized schema" }`, so a new LLM call site fails loudly rather than silently.
- `usage` is zeroed. `GET /health` → 200. The test fixtures are real request bodies captured from the API's `ai` / `@ai-sdk/anthropic` versions.
- The API under test runs with `ANTHROPIC_BASE_URL=http://localhost:4010/v1` and `ANTHROPIC_API_KEY=e2e-stub`.

### Compose — `docker-compose.yml`

One service, `profiles: ["e2e"]`, so a plain `up` ignores it:
- `s3mock`: `adobe/s3mock:4.7.0` on port `9090`, with `COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS=portalai-uploads-e2e` (the bucket exists at boot). Its healthcheck is busybox `netstat`, since the image has no curl or wget.
  - Not MinIO: MinIO's public images are gone from Docker Hub, and the quay mirror needs auth.
  - s3mock accepts presigned requests and answers CORS for any origin. A real SigV4 presigned PUT plus preflight was verified.

`scripts/e2e-stack.sh up` runs the API with:
- `UPLOAD_S3_ENDPOINT` = `http://s3mock:9090` on the devcontainer's compose network, else `http://localhost:9090`;
- `UPLOAD_S3_FORCE_PATH_STYLE=true` and `UPLOAD_S3_BUCKET=portalai-uploads-e2e`;
- dummy `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`;
- a fresh `portal_ai_e2e` database on `postgres-test`, Redis db 5, and a throwaway `ENCRYPTION_KEY`.

The web is a production build served by `vite preview` on `:3000`, same-origin through its `/api` proxy.

### Workflow — `.github/workflows/e2e-test.yml` (new)

- **Triggers:** `pull_request`, plus `push` to non-`main` branches, matching the other suites. Concurrency group `"e2e-test-${{ github.ref }}"` with `cancel-in-progress: true` (the literal leads, per `lint:ci-cache` rule 4).
- **Job:** `E2E Tests`, not required. Steps:
  1. Checkout, then `./.github/actions/setup`. Turbo env is carried, per rule 1.
  2. If `secrets.E2E_CI_AUTH0_PASSWORD` is empty → emit a `::notice::` and exit 0.
  3. Restore `~/.cache/ms-playwright`, keyed on `@playwright/test` version and OS, then `npx playwright install --with-deps chromium`. The install is a no-op on a cache hit except for deps.
  4–7. `packages/e2e/scripts/e2e-stack.sh up`, with `E2E_QA_CONNECTION` and the dev-tenant `AUTH0_*` / `VITE_AUTH0_*` from secrets. It boots compose (`postgres-test`, `redis`, `s3mock`), migrates and seeds a fresh database, starts the stub, builds and starts the API, then builds and previews the web, waiting on each.
     The dev affordance requires `import.meta.env.DEV`, which a preview build strips, so this run signs in via the **QA path**: the build sets `VITE_AUTH0_QA_CONNECTION` (from `E2E_QA_CONNECTION`) to the CI user's connection, and the `setup` project uses `via: "qa"`. That also exercises the same code the deployed check uses.
  8. `npm run --workspace @portalai/e2e test:e2e -- --project=setup --project=core-loop --project=login` with `E2E_TARGET=local`, `E2E_SIGN_IN_VIA=qa`, CI creds in `E2E_AUTH0_USERNAME` / `E2E_AUTH0_PASSWORD`, and `CI=1`.
  9. `if: failure()`: upload `packages/e2e/test-results/` and `playwright-report/` (14-day retention).
  10. `if: always()`: `docker compose --profile e2e down -v`.

### Deploy workflows — `verify-login`

Added to `deploy-dev.yml` and `deploy-prod.yml`. Prod's copy runs under `environment: prod` with `PROD_AWS_ROLE_ARN`.

```yaml
verify-login:
  needs: [deploy-frontend, deploy-backend]
  if: ${{ !cancelled() && needs.deploy-frontend.result == 'success' && needs.deploy-backend.result == 'success' }}
```

- `deploy-frontend` exposes `outputs.invalidation_id` from its `create-invalidation` step (`--query Invalidation.Id`).
- The job's steps:
  1. checkout + setup + Chromium (same cache);
  2. configure AWS (the deploy role);
  3. `aws cloudfront wait invalidation-completed --distribution-id … --id ${{ needs.deploy-frontend.outputs.invalidation_id }}`;
  4. read `portalai/<env>/qa-auth0-{username,password}` with `aws secretsmanager get-secret-value`, `::add-mask::` both, and export them as `E2E_AUTH0_USERNAME` / `E2E_AUTH0_PASSWORD`;
  5. `test:e2e -- --project=login` with `E2E_TARGET=app-dev|prod`;
  6. `if: failure()`: upload `packages/e2e/test-results/<target>/` (screenshots + video only).
- `tag-deploy` (dev) is unchanged and doesn't need `verify-login`. A deploy is tagged as soon as it's live, and the check reports on it.
- The web builds in both deploy workflows add `VITE_AUTH0_QA_CONNECTION: ${{ secrets.<DEV|PROD>_VITE_AUTH0_QA_CONNECTION }}`. The chart/ECS web image build (`deploy-dev.yml:472-495`) does **not** set it.

### MCP — `.mcp.json`

`playwright` is unchanged. Two new servers, each `@playwright/mcp@0.0.80 --headless --isolated` with:

| Server | `--storage-state` | `--allowed-origins` | `--output-dir` |
|---|---|---|---|
| `playwright-app-dev` | `packages/e2e/.auth/app-dev/owner.storageState.json` | `https://app-dev.portalsai.io;https://api-dev.portalsai.io;https://<dev auth0 domain>` | `packages/e2e/test-results/app-dev` |
| `playwright-prod` | `packages/e2e/.auth/prod/owner.storageState.json` | `https://app.portalsai.io;https://api.portalsai.io;https://<prod auth0 domain>` | `packages/e2e/test-results/prod` |

The Auth0 domains are public values. The plan reads them from the `*_VITE_AUTH0_DOMAIN` secrets' current values and writes them in. If a state file is missing, the server still starts but lands on `/login`; the README says to run `e2e:auth:<env>`.

### Docs

- **`docs/E2E_DEPLOYED_QA.runbook.md`** (new, durable). Per tenant:
  1. create the Database connection with sign-ups disabled, enabled on the SPA application;
  2. create the QA user `qa+<env>@portalsai.io`;
  3. add the MFA exemption by connection;
  4. check brute-force protection is on.
  Then, per env:
  - `portalops vars set QA_AUTH0_{USERNAME,PASSWORD}`;
  - set the `<ENV>_VITE_AUTH0_QA_CONNECTION` repo secret;
  - first `e2e:auth:<env>`, which provisions the personal org;
  - `portalai org` rename to `QA (<env>)` and `org set-tier <id> <top-tier>`;
  - check the QA user has exactly one membership;
  - password rotation;
  - QA-org analytics note.
  It's linked from the release / post-deploy checklist (#854).
- **`packages/e2e/README.md`**: covers the specs, `test:e2e`, deployed targets and per-env MCP servers. Agent conduct in deployed envs:
  - QA org only;
  - reproduce customer bugs by recreating their conditions;
  - no billing checkout;
  - created data is prefixed `qa-<yyyymmdd>-`, and cleaned up.
- **`CLAUDE.md` + `.github/copilot-instructions.md`**: the "Agent-guided browser sessions" paragraph gets rewritten. The automated tier exists, `e2e-test.yml` is non-required, `verify-login` runs on deploy, and deployed sessions follow the conduct rules.

## Migration / Seed

None. No schema change. The deployed QA org is created by the existing first-login provisioning, and the tier grant goes through `portalai org set-tier`.

## TDD test plan

### `apps/web`, run with `npm run test:unit` (≈ 10)
- `src/__tests__/runtime-config.util.test.ts`: `readAuth0Settings` maps `VITE_AUTH0_QA_CONNECTION` (trimmed); absent → `""`.
- `src/__tests__/LoginForm.test.tsx` (renders `LoginFormUI`):
  - `onClickQaLogin` set → **QA sign-in** renders and the click calls it;
  - unset → absent;
  - both dev and QA buttons can render together.
- `LoginForm` gate (a pure helper `shouldShowQaLogin({ isOidc, qaConnection, search })`, exported from the same util file and tested directly):
  - true only with all three conditions;
  - false under OIDC, with an empty connection, or without `?qa`.
- The Auth provider's `withQaConnection` calls `loginWithRedirect` with `connection` = the configured name (mocked `useAuth0`).
- `subprocessor-browser-egress.guard.test.ts` stays green, with the new var classified.

### `packages/cli-env`, run with `npm run test:unit` (≈ 3)
- Built-ins carry the `webBaseUrl` values above.
- An override without `webBaseUrl` still parses.
- A malformed `webBaseUrl` is rejected.

### `packages/devops-cli`, run with `npm run test:unit` (≈ 2)
- The catalog resolves `QA_AUTH0_PASSWORD` → `portalai/dev/qa-auth0-password` / `portalai/prod/…`.
- `deploy-parity.test.ts` stays green.

### `packages/e2e`, run with `npm run test:unit`, which replaces today's `true` (≈ 14)
- `src/__tests__/target.test.ts`:
  - default `local`;
  - `E2E_TARGET=prod` → prod URLs and `via: "qa"`, `deployed: true`;
  - `E2E_BASE_URL` overrides;
  - `E2E_SIGN_IN_VIA` overrides;
  - an unknown target throws;
  - a deployed target with `identity` throws;
  - `storageStatePath` for local default, local identity and deployed.
- `resolveCredentials`:
  - env vars win;
  - deployed with no env vars calls the mocked `getSecret` with `qa-auth0-username` / `-password`;
  - local with missing vars throws an error that names the vars, not the values.
- `src/__tests__/anthropic-stub.test.ts`:
  - a classifier schema → one null-bound classification per prompt candidate, validating `LlmBridge.ClassifierResponseSchema` (and `[]` with no candidates);
  - an axis schema validates `AxisNameRecommenderResponseSchema`;
  - an unknown schema → 400;
  - `/health` → 200.
- `src/__tests__/playwright-config.test.ts`: a deployed target ⇒ `trace: "off"` and no html reporter; local ⇒ html + on-first-retry.
- `E2eSignInError` messages never contain the password (unit, against a fabricated failure).

### `packages/e2e`, run with `npm run test:e2e` (browser suites, not in `test:unit`)
- `core-loop.spec.ts`: one end-to-end test (6 assertions).
- `login.spec.ts`: one test (3 assertions).

### Repo guards
- `npm run lint:ci-cache` stays green with the new workflow: rule 1 Turbo env and a rule 4 concurrency literal.
- No new required check, so rule 3 doesn't apply.

**Totals ≈ 29 unit cases + 2 browser specs.**

The **deliberate-regression** acceptance is shown once in the PR, not as a committed test. On a scratch commit:
- break the QA connection name, and `login` fails;
- make the stub return 400 for the classifier, and `core-loop` fails at interpret.
Each red run's artifact is linked from the PR.

## Acceptance criteria

- [ ] `npm run test:e2e` (from a clean checkout, after `docker compose --profile e2e up`, the stub, and the API + web started per the README) passes `setup`, `core-loop` and `login` locally.
- [ ] `E2E Tests` runs on a PR, boots its own Postgres, Redis, s3mock, stub, API and web, walks the core loop on a freshly provisioned org, tears down, and is not required.
- [ ] A red `E2E Tests` run uploads trace, screenshots, video and HTML report. A red `verify-login` uploads screenshots + video only.
- [ ] After `deploy-dev` / `deploy-prod`, `verify-login` signs in as that env's QA user and asserts `organization/current` 200 plus exactly one membership. A broken login turns the run red, and nothing rolls back.
- [ ] `npm run --workspace @portalai/e2e e2e:auth:prod` (with AWS credentials) writes `.auth/prod/owner.storageState.json` (mode 0600). After an MCP restart, `mcp__playwright-prod__*` can walk the QA org. Navigating to any non-allowed origin is refused.
- [ ] A normal user's `/login` on app-dev or prod is unchanged: Google button only. `?qa` is shown only where the build sets the connection, and never in the chart/ECS image or residency builds.
- [ ] Auth0 sign-up on the QA connection is disabled. That's verified in the runbook walk.
- [ ] No deployed credential, trace or `storageState` appears in any CI artifact or commit.
- [ ] `CLAUDE.md`, the e2e README and the runbook describe the three tiers and the deployed-session conduct rules.

## Risks & rollback

- **A QA password-login surface in prod (fails closed).** The only new credential path is one Auth0 DB user with sign-ups disabled. Rollback: disable the connection on the SPA app in the Auth0 dashboard. QA sign-in and `verify-login` then fail red, and users are unaffected.
- **`verify-login` flakes, giving a red deploy run that doesn't block anything.** It's diagnosed from the screenshot and video. If it proves flaky, retries stay 0 and the cause is fixed. The job can be removed in one commit without touching the deploy.
- **The stub drifts from the AI SDK request shape.** The stub's 400-on-unknown and the core-loop run surface it immediately, and the unit test pins the two known schemas.
- **A `storageState` leaks from a developer machine.** Damage is limited to the QA org (one membership). Recovery is to rotate the QA password per the runbook, which revokes refresh tokens.
- **Agent misuse in prod.** Isolation is server-enforced by membership, not by prompt. `--allowed-origins` blocks wandering to other hosts.

## Files touched

**New**
- `packages/e2e/src/lib/sign-in.ts`
- `packages/e2e/src/lib/target.ts`
- `packages/e2e/src/stubs/anthropic-stub.ts`
- `packages/e2e/src/setup/session.setup.ts`
- `packages/e2e/src/specs/core-loop.spec.ts`
- `packages/e2e/src/specs/login.spec.ts`
- `packages/e2e/src/__tests__/{target,anthropic-stub,playwright-config,sign-in}.test.ts` and the jest config for the package
- `.github/workflows/e2e-test.yml`
- `docs/E2E_DEPLOYED_QA.runbook.md`

**Edit**
- `packages/e2e/{playwright.config.ts,package.json,README.md,.env.example}`
- `packages/e2e/src/setup/auth.setup.ts`
- `apps/web/src/utils/runtime-config.util.ts`
- `apps/web/src/providers/Auth.provider.tsx`
- `apps/web/src/components/LoginForm.component.tsx`
- `apps/web/src/stories/Authorized.layout.stories.tsx`
- `apps/web/src/__tests__/{runtime-config.util,LoginForm}.test.ts(x)`
- web `subprocessor-browser-egress.guard.test.ts`
- `packages/cli-env/src/registry.ts` (+ test)
- `packages/devops-cli/src/catalog.ts` (+ test)
- `docker-compose.yml`
- `turbo.json`, root `package.json`
- `.github/workflows/deploy-dev.yml`, `.github/workflows/deploy-prod.yml`
- `.mcp.json`
- `CLAUDE.md`, `.github/copilot-instructions.md`

## Next step

`docs/E2E_BROWSER_VERIFICATION.plan.md` sequences this as about 8 slices on this branch:
1. the e2e library (`target`, `sign-in`) + `e2e:auth --env` + unit tests;
2. web QA sign-in;
3. the `cli-env` `webBaseUrl` + catalog entries;
4. the Anthropic stub + s3mock compose + `e2e-stack.sh` + Playwright projects + core-loop/login specs green locally;
5. `e2e-test.yml`;
6. `verify-login` in both deploy workflows;
7. `.mcp.json` per-env servers;
8. runbook + README + `CLAUDE.md`.
Slices 1–5 need no vendor-side change. Slice 5's CI run needs the `E2E_CI_*` repo secrets. Slices 6–7 need the runbook's Auth0 setup done on each tenant.
