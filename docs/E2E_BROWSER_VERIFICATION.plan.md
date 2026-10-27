# E2E browser verification — Plan

**TDD-sequenced implementation of the three browser-verification tiers: the shared e2e target/sign-in library, the web QA sign-in, the Anthropic stub + MinIO-backed ephemeral stack, the core-loop and login specs, the `e2e-test.yml` PR workflow, the post-deploy `verify-login` job, per-env MCP servers, and the docs.**

Spec: `docs/E2E_BROWSER_VERIFICATION.spec.md`. Discovery: `docs/E2E_BROWSER_VERIFICATION.discovery.md`. Issue: #489. Builds on **shipped #304**: the `@portalai/e2e` harness, the dev affordance and `.mcp.json`.

Ten slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/489-e2e-browser-verification`**, one feature and one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/cli-env && npm run test:unit
cd packages/devops-cli && npm run test:unit
cd packages/e2e && npm run test:unit      # new in slice 2 (replaces `true`)
cd packages/e2e && npm run test:e2e       # browser specs, slice 5 on
cd apps/web && npm run test:unit -- --testPathPattern '<touched files>'
npm run lint:ci-cache                     # slices 6–8
```

Each slice:
1. Write failing tests.
2. Make the smallest change that greens them.
3. Do a focused run.
4. At the boundary, run `npm run lint && npm run type-check`, and `npm run format:check` for the touched packages.
5. Move on to the next slice.

A slice that changes `packages/cli-env` (a dependency of e2e and devops-cli) also runs the root `npm run build` before its commit (`feedback_core_model_change_run_full_build`).

Sequencing rationale: leaves first, then wiring, then CI, then deployed surfaces, so each step works locally before CI or a tenant depends on it.
- **Slice 1:** `cli-env` `webBaseUrl` + QA catalog entries. These are leaf data the e2e library reads.
- **Slice 2:** the e2e library (`target`, `sign-in`) + `e2e:auth --env`, unit-tested with mocked `getSecret`. Uses slice 1.
- **Slice 3:** the web QA sign-in affordance. Independent of 1–2, but it must exist before any spec can use `via: "qa"`.
- **Slice 4:** the Anthropic stub, pure and unit-tested.
- **Slice 5:** compose MinIO, the Playwright projects, the core-loop + login specs and `test:e2e`, all green locally. Uses 2–4.
- **Slice 6:** `e2e-test.yml`. The first CI run; uses 5.
- **Slice 7 (amendment, spec decision 14):** owner / admin / member. The `roles` spec on the PR stack, the invite-link sign-in, deployed `--identity` and an env-aware `e2e:use`. Uses 2, 5 and 6. It sits before the deployed slices because those consume its library changes, and its CI proof needs only repo secrets.
- **Slice 8:** `verify-login` in both deploy workflows + `VITE_AUTH0_QA_CONNECTION` in their web builds. Uses 3 and 5. **Its first real run needs the runbook's tenant setup.**
- **Slice 9:** per-env MCP servers, plus a guard test on `.mcp.json`. Uses 2 and 7.
- **Slice 10:** runbook, README, `CLAUDE.md` / copilot mirror. Docs land last so they describe what shipped.

No migration, no seed.

---

## Slice 1 — `cli-env` web URL + QA secret catalog

The web base URL becomes known per env. `portalops vars` gains the two QA keys.

**Files**

- Edit: `packages/cli-env/src/registry.ts`: `webBaseUrl: z.url().optional()` on `EnvironmentDefinitionSchema`; built-ins `local` / `app-dev` / `prod` set to the spec's URLs.
- Edit: `packages/cli-env` registry test (alongside the existing registry tests).
- Edit: `packages/devops-cli/src/catalog.ts`: `secret("QA_AUTH0_USERNAME", "qa-auth0-username")`, `secret("QA_AUTH0_PASSWORD", "qa-auth0-password")`.
- Edit: the devops-cli catalog test.

**Steps**

1. **Tests (spec: cli-env ≈ 3, devops-cli ≈ 2).** These fail until the change lands.
   - The built-ins carry `webBaseUrl`.
   - An override JSON without it parses.
   - A malformed URL is rejected.
   - The catalog resolves `QA_AUTH0_PASSWORD` → `portalai/dev/qa-auth0-password` and `portalai/prod/qa-auth0-password`.
2. **Implement** the schema field + entries until green. `deploy-parity.test.ts` stays green, since the new keys aren't in `backend.yml`.
3. Root `npm run build`, lint and type-check.

**Done when:** both packages' `test:unit` pass, `portalops vars describe --env app-dev` lists the QA keys, and the root build is clean.

**Risk:** an optional field is the only safe shape. A required one would break every operator's `~/.portalai/environments.json`.

---

## Slice 2 — e2e target + sign-in library, `e2e:auth --env`

`auth.setup.ts`'s Universal Login driver moves into `src/lib/sign-in.ts`. The new `src/lib/target.ts` resolves env, credentials and state path. `e2e:auth` gains `--env`. Local behaviour is byte-identical.

**Files**

- New: `packages/e2e/jest.config.js` (modelled on `packages/cli-env/jest.config.js`) and `test:unit` = `NODE_OPTIONS=--experimental-vm-modules jest`, replacing `true`.
- New: `packages/e2e/src/lib/target.ts`, which holds `resolveTarget`, `resolveCredentials`, `storageStatePath`, the `E2E_SIGN_IN_VIA` override and the deployed-refuses-identity rule.
- New: `packages/e2e/src/lib/sign-in.ts`, which holds `signIn(page, opts)` with `via: "dev" | "qa"` and `E2eSignInError`.
- Edit: `packages/e2e/src/setup/auth.setup.ts`, which becomes a thin wrapper. It handles `--env`, writes state with `mode: 0o600`, and creates `.auth/<env>/`.
- Edit: `packages/e2e/package.json`: add the `@portalai/cli-env` dep and the `e2e:auth:app-dev` / `e2e:auth:prod` scripts.
- New: `packages/e2e/src/__tests__/target.test.ts`, `sign-in.test.ts`.

**Steps**

1. **Tests (spec: e2e `target.test.ts` cases, `resolveCredentials` cases, the `E2eSignInError` no-password case).**
   - Mock `@portalai/cli-env`'s `getSecret` with `jest.unstable_mockModule`.
   - `sign-in.test.ts` checks only the error path: a fake `Page` whose `waitForFunction` rejects must produce a message without the password.
   - Run; the tests fail.
2. **Implement** `target.ts`, then extract `signIn` verbatim from `auth.setup.ts:101-144`, adding the `qa` branch (`/login?qa=1` → `e2e-qa-login`). Then rewire the CLI. Green.
3. **Local regression check (manual, one run):** `npm run --workspace @portalai/e2e e2e:auth` against the dev stack still writes `.auth/storageState.json`.
4. Lint + type-check.

**Done when:** e2e `test:unit` passes (≈ 11 cases) and the local `e2e:auth` / `e2e:auth:admin` behave as before.

**Risk:** the `qa` branch can't be exercised against a real affordance until slice 3. It's unit-covered here only through the URL it navigates to.

---

## Slice 3 — Web QA sign-in affordance

`VITE_AUTH0_QA_CONNECTION` + `?qa` renders **QA sign-in**, pinned to that connection. Residency and unset builds are unchanged.

**Files**

- Edit: `apps/web/src/utils/runtime-config.util.ts`:
  - `qaConnection` on `Auth0Settings` / `readAuth0Settings`;
  - a new pure `shouldShowQaLogin({ isOidc, qaConnection, search })`.
- Edit: `apps/web/src/providers/Auth.provider.tsx`: `withQaConnection` on `AuthLogin`, Auth0 + OIDC bridges.
- Edit: `apps/web/src/components/LoginForm.component.tsx`: the `onClickQaLogin` prop + `data-testid="e2e-qa-login"` button; the container wires `shouldShowQaLogin`.
- Edit: `apps/web/src/stories/Authorized.layout.stories.tsx`: stub field.
- Edit: `apps/web/src/__tests__/runtime-config.util.test.ts`, `LoginForm.test.tsx`, and the Auth provider test (or a new `Auth.provider.qa.test.tsx` if none exists).
- Edit: web `subprocessor-browser-egress.guard.test.ts`'s classification, marking the var internal.
- Edit: `apps/web/.env.example`, documenting the var (blank).

**Steps**

1. **Tests (spec: apps/web ≈ 10).**
   - Settings mapping, with trim and absent cases.
   - The `shouldShowQaLogin` truth table.
   - `LoginFormUI` renders and clicks QA sign-in, and it's absent when unset.
   - `withQaConnection` passes `connection` through to a mocked `loginWithRedirect`.
   - Run; the tests fail. The egress guard fails too, until the var is classified.
2. **Implement.** Green.
3. Lint (zero-warning) + type-check + `format:check`.

**Done when:** the touched web tests and the egress guard pass. A `vite dev` build with `VITE_AUTH0_QA_CONNECTION` set shows the button only with `?qa`.

**Risk:** none at runtime. No build sets the var until slice 6/8.

---

## Slice 4 — Anthropic stub

A deterministic stand-in for `POST /v1/messages`, so interpret runs without a live model.

**Files**

- New: `packages/e2e/src/stubs/anthropic-stub.ts`. It exports `createAnthropicStub(): http.Server` (testable) plus a `main` guarded by `import.meta.url`, which listens on `E2E_ANTHROPIC_STUB_PORT ?? 4010`.
- New: `packages/e2e/src/__tests__/anthropic-stub.test.ts`.
- Edit: `packages/e2e/package.json`: the `e2e:stub:anthropic` script, plus a `@portalai/core` dev dep for the schemas the test validates against.

**Steps**

1. **Tests (spec: anthropic-stub cases).**
   - A request shaped like the AI SDK's `generateObject` tool call with the classifier's JSON schema → a `tool_use` input that `LlmBridge.ClassifierResponseSchema` accepts.
   - The same for `AxisNameRecommenderResponseSchema`.
   - An unknown schema → 400.
   - `/health` → 200.
   - To build the request fixtures, capture one real request body. Run the API once with `ANTHROPIC_BASE_URL` at a logging listener; this happens in the dev container, not committed. Then trim it to the fields the stub reads.
   - Run; the tests fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** the stub test passes, and a dev API pointed at the running stub completes an interpret of `supported_layouts.csv` with every column bound to `text`.

**Risk:** the AI SDK's request/response shape for Anthropic tool-mode `generateObject`. Step 1's captured fixture pins it, and the "done when" check proves it against the real SDK.

---

## Slice 5 — Ephemeral stack, Playwright projects, core-loop + login specs

`npm run test:e2e` walks a fresh org through the core loop and verifies login, locally, against the e2e compose profile.

**Files**

- Edit: `docker-compose.yml`: `minio` + `minio-init` under `profiles: ["e2e"]`. Image tags are pinned, which invalidates the turbo cache (`globalDependencies`); that's expected.
- Edit: `packages/e2e/playwright.config.ts`: the `setup` / `core-loop` / `login` projects, with deployed-aware `trace` / `reporter` / `outputDir`, built from a pure `buildConfig(target)` exported for the test.
- New: `packages/e2e/src/setup/session.setup.ts`, `src/specs/core-loop.spec.ts`, `src/specs/login.spec.ts`.
- New: `packages/e2e/src/__tests__/playwright-config.test.ts`.
- Edit: `packages/e2e/package.json` (`test:e2e`, `test:e2e:ui`), `turbo.json` (`test:e2e`, `cache: false`), root `package.json` (`test:e2e`).
- Edit (only where no accessible name exists): `data-testid`s in the CSV upload / region / commit steps. Each is listed in the commit message.
- Edit: `packages/e2e/.env.example`: `E2E_TARGET`, `E2E_SIGN_IN_VIA`, `E2E_ANTHROPIC_STUB_PORT`.

**Steps**

1. **Unit tests (spec: playwright-config cases).** A deployed target ⇒ `trace: "off"`, list-only reporter and `outputDir` `test-results/<target>/`. Local ⇒ html + `on-first-retry`. Run; they fail. Implement `buildConfig`; green.
2. **Browser specs, written red-first.**
   - Write `login.spec.ts`. Run it against the dev stack with `E2E_SIGN_IN_VIA=dev`. It goes green, and asserting a wrong org count makes it red; that's the "fails loudly" check.
   - Write `core-loop.spec.ts`. Run it against the e2e stack, which is booted as CI will boot it (spec → Workflow steps 4–7): API on the test DB + MinIO + stub, web via `vite preview` with the QA connection set to the local tenant's CI connection.
   - Iterate selectors until green twice in a row from a dropped DB.
3. **Deliberate-regression check:** make the stub 400 the classifier. `core-loop` must fail at interpret with a trace. Revert.
4. Lint + type-check + `format:check`.

**Done when:**
- e2e `test:unit` passes (≈ 14 cases);
- `test:e2e` runs `setup → core-loop → login` green twice from a fresh stack;
- both deliberate regressions fail loudly.

**Risk:**
- **This is the biggest slice.** If selector work balloons, split the commit: config + login spec, then core loop.
- **Local setup prerequisite.** A local run needs the **local tenant's CI user + its connection enabled on the dev SPA app**. That's operator setup, listed in slice 10's runbook and needed here already. Ask the user for it at the start of the slice.
- **Containers.** DooD in the devcontainer means compose services publish on the host. Reach MinIO at the address the browser uses (`project_dood_no_workspace_bind_mounts`), and check before writing the spec that the presigned URL host resolves from Chromium.

---

## Slice 6 — `e2e-test.yml` PR workflow

The core loop runs on every PR as a non-required **E2E Tests** check.

**Files**

- New: `.github/workflows/e2e-test.yml`, per the spec's Workflow steps 1–10, with these specifics:
  - the Turbo env block;
  - a concurrency group led by the `"e2e-test-"` literal;
  - a fork/no-secret skip with `::notice::`;
  - the `~/.cache/ms-playwright` cache keyed on the `@playwright/test` version;
  - artifacts uploaded on failure;
  - `down -v` under `always()`.
- Repo secrets (user action, requested at the start of the slice): `E2E_CI_AUTH0_USERNAME`, `E2E_CI_AUTH0_PASSWORD`, `E2E_CI_VITE_AUTH0_{DOMAIN,CLIENT_ID,AUDIENCE,QA_CONNECTION}`, plus the API's dev-tenant `AUTH0_*` for JWT verification.

**Steps**

1. **Test:** `npm run lint:ci-cache` must pass with the new workflow. Rules 1 and 4 apply; rule 3 doesn't, since the check isn't required. If the guard fails on the new file, fix the file, never the guard.
2. **Implement**, push, and watch the PR run go green.
3. **Deliberate regression in CI:** push a scratch commit that breaks the stub. The run goes red with a downloadable trace and report, and the PR still shows as mergeable. Revert the commit and link the red run in the PR body.

**Done when:** **E2E Tests** is green on the PR, a red run's artifact is diagnosable, and branch protection is unchanged.

**Risk:** CI runtime. Budget it against the ~8s setup + build. If it exceeds ~10 min, note it on the PR and consider building web/API once and caching.

---

## Slice 7 — Owner, admin and member

The PR walk proves each system role's split, and the e2e library can sign in any of the three QA identities in a deployed env (spec decision 14).

**Files**

- New: `packages/e2e/src/lib/invite.ts`: `createInvitation` and `acceptInvitation`.
- New: `packages/e2e/src/specs/roles.spec.ts`: the invites, the two accepts with the one-membership check, and the probe table.
- New: `packages/e2e/src/setup/use-identity.ts`: the env-aware `e2e:use`.
- Edit: `packages/e2e/src/lib/target.ts`:
  - deployed `admin` / `member` instead of refusing every identity;
  - `-<id>` secret names;
  - `activeStorageStatePath`.
- Edit: `packages/e2e/src/lib/sign-in.ts`: `entryPath`.
- Edit: `packages/e2e/src/setup/auth.setup.ts`:
  - `--invite`, with the same-origin check in an exported pure parser;
  - the copy to the active path for deployed targets;
  - local owner also writes `.auth/owner.storageState.json`.
- Edit: `packages/e2e/src/lib/playwright-config.ts`: the `roles` project.
- Edit: `packages/e2e/package.json`: `e2e:use`, `e2e:auth:<env>:admin|member`.
- Edit: `packages/devops-cli/src/catalog.ts` (+ test): the four `QA_AUTH0_*_{ADMIN,MEMBER}` secrets.
- Edit: `.github/workflows/e2e-test.yml`:
  - the role secrets in the job env;
  - the skip check covering them;
  - `--project=roles`.
- Edit: the scratchpad secret script, extended with the `E2E_CI_AUTH0_*_{ADMIN,MEMBER}` pairs from `packages/e2e/.env`. The user runs it.

**Steps**

1. **Tests (spec "Decision 14 additions").** `target.test.ts`, `use-identity.test.ts`, `auth-setup.test.ts`, `sign-in.test.ts` and the devops-cli catalog cases. Run; fail.
2. **Implement** the library, CLI and catalog changes. Green.
3. **Browser:** write `roles.spec.ts` and run it on the local stack (`e2e:stack:up`) until it's green twice. Then a deliberate regression: give `member` the `member.invite` grant on a scratch DB, and `roles` must fail at the member's probe.
4. **CI:** the user runs the extended secret script. Then push; `E2E Tests` runs all four projects green.
5. `npm run lint:ci-cache`, lint, type-check, format:check. Root `npm run build`, since devops-cli changed.

**Done when:** `E2E Tests` is green with `roles` on the PR, and the unit cases pass.

**Risk:**
- **Invite flow quirks in a production build.** The return-to (#884) has only been proven against the dev server. If `roles` finds a bug there, it's filed and fixed through the bug template, not worked around in the spec.
- **Token extraction.** The probes read the role's bearer token from the context's `@@auth0spajs@@` cache entry. If that shape is unstable, intercept an app request's `Authorization` header instead.

---

## Slice 8 — Post-deploy `verify-login`

After every deploy, CI signs in to that env as its QA user and goes red on failure. It does not roll back.

**Files**

- Edit: `.github/workflows/deploy-dev.yml`:
  - `deploy-frontend` outputs `invalidation_id`, adds `VITE_AUTH0_QA_CONNECTION: ${{ secrets.DEV_VITE_AUTH0_QA_CONNECTION }}` to the S3 build, and leaves the chart/ECS image build untouched;
  - a new `verify-login` job per the spec: wait on the invalidation → masked secret read → `test:e2e -- --project=login` → upload on failure.
- Edit: `.github/workflows/deploy-prod.yml`: the same, under `environment: prod` / `PROD_AWS_ROLE_ARN` / `PROD_VITE_AUTH0_QA_CONNECTION`.

**Steps**

1. **Test:** `npm run lint:ci-cache` passes. In a review read, the `!cancelled() && …success` guard on `verify-login` must match `tag-deploy`'s. `tag-deploy` must not need `verify-login`.
2. **Implement.**
3. **Prerequisite gate:** the app-dev tenant setup from the runbook (slice 10's content; the user does it in the Auth0 dashboard) plus `portalops vars set QA_AUTH0_*` + the `DEV_VITE_AUTH0_QA_CONNECTION` secret. Without them, the first merge to `main` turns `verify-login` red. That's correct behaviour, but noisy.
4. **Proof:** the first app-dev deploy that includes this slice shows `verify-login` green. On a deliberate break (a wrong `DEV_VITE_AUTH0_QA_CONNECTION` on a dispatched run) it goes red with screenshots. Prod is proven on the next release.

**Done when:** lint is green. The live proof is deferred to the first post-merge deploy and recorded in the smoke doc.

**Risk:**
- **Prod setup.** The prod tenant setup must be on the release checklist (#854) **before** the release that carries this, or the prod deploy goes red (`project_prod_release_vendor_teardown`).
- **No masked trace.** `trace: "off"` comes from slice 5's `buildConfig`. Confirm it on the first red run's artifact list.

---

## Slice 9 — Per-env MCP servers

Agent sessions can target app-dev or prod explicitly, fenced by origin.

**Files**

- Edit: `.mcp.json`: add `playwright-app-dev` and `playwright-prod` per the spec table. The Auth0 domains are copied from the current `DEV_/PROD_VITE_AUTH0_DOMAIN` values; the user supplies them at the start of the slice.
- New: `packages/e2e/src/__tests__/mcp-config.test.ts`. It's a guard that parses `.mcp.json` and checks every `playwright-*` server except `playwright`:
  - has `--isolated` and `--headless`;
  - has a `--storage-state` under `packages/e2e/.auth/<env>/`;
  - has an `--allowed-origins` that contains only `https://` origins, including the env's `webBaseUrl` from `cli-env`;
  - has an `--output-dir` under `packages/e2e/test-results/<env>`.
- Edit: `packages/e2e/.gitignore`. Confirm that `.auth/` covers the nested `<env>/` dirs; add an explicit entry if it doesn't.

**Steps**

1. **Test** the guard, which fails while the servers are missing. **Implement.** Green.
2. **Manual proof:** `e2e:auth:app-dev` → restart the session → `mcp__playwright-app-dev__browser_navigate` to the app lands authenticated in the QA org, and navigating to an outside origin is refused. Then `e2e:use member --env app-dev` → restart → the same session is the QA member (no Members tab). This needs slice 8's app-dev tenant setup.

**Done when:** the guard passes and the manual proof is recorded in the smoke doc.

**Risk:** `--allowed-origins` syntax and semantics in `@playwright/mcp@0.0.80`. Confirm them against that version's `--help` before writing the guard.

---

## Slice 10 — Runbook + docs sync

Docs describe what shipped.

**Files**

- New: `docs/E2E_DEPLOYED_QA.runbook.md` (durable), per the spec's Docs section:
  - the tenant steps;
  - the MFA exemption by connection;
  - QA org provisioning, which is the first login, then rename + `org set-tier`;
  - the admin and member QA users: invite each from the QA owner's Settings → Members, then `e2e:auth --env <env> --identity <id> --invite '<link>'`;
  - the one-membership check;
  - rotation;
  - the analytics note;
  - the local-tenant CI user setup for slices 5–6.
- Edit: `packages/e2e/README.md`. Drop the "deferred" scope note and add the specs / `test:e2e` / deployed targets / per-env MCP / conduct rules.
- Edit: `CLAUDE.md` "Agent-guided browser sessions" + `.github/copilot-instructions.md` (mirror).
- Edit: the #854 release checklist issue. Add the runbook's per-tenant steps as a pre-release item (via `gh`, writing the full body to a file first: `feedback_issue_body_edit_guard`).

**Steps**

1. **Test:** `npm run lint:doc-pointers` passes, and every cited path exists. `CLAUDE.md` and its mirror stay in sync.
2. **Write.**

**Done when:** the doc-pointer lint is green, and the README no longer calls the automated tier deferred.

**Risk:** none.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | `webBaseUrl` + QA catalog keys | cli-env + devops-cli `test:unit`, root build |
| 2 | e2e `target` / `sign-in` / `e2e:auth --env` | e2e `test:unit` (new) |
| 3 | Web QA sign-in | web `test:unit` (touched) + egress guard |
| 4 | Anthropic stub | stub test + a real interpret against it |
| 5 | MinIO, Playwright projects, core-loop + login specs | `test:e2e` green ×2, regressions red |
| 6 | `e2e-test.yml` | `lint:ci-cache` + a green PR run + a red-run artifact |
| 7 | Owner / admin / member: `roles` spec, invite sign-in, deployed `--identity`, `e2e:use --env` | e2e + devops-cli `test:unit`; `E2E Tests` green with `roles`; a member-grant regression red |
| 8 | `verify-login` in deploys | `lint:ci-cache`; live proof on the first deploy |
| 9 | Per-env MCP servers | `mcp-config` guard + a manual app-dev session, switched to the member |
| 10 | Runbook + README + `CLAUDE.md` | `lint:doc-pointers` |

## Cross-slice notes

**User-side prerequisites.** These are vendor or dashboard steps the agent can't do; the Auth0 CLI isn't logged in here. Ask for each at the start of its slice:
- **Slice 5:** the local-tenant CI user + its connection on the dev SPA.
- **Slice 6:** the repo secrets.
- **Slice 7:** the `E2E_CI_AUTH0_*_{ADMIN,MEMBER}` repo secrets, from the local e2e admin/member identities.
- **Slices 8–9:** the app-dev tenant setup (three QA users) + `QA_AUTH0_*` vars, including the `_ADMIN` / `_MEMBER` pairs.
- **Before the next prod release:** the prod tenant setup.

**Other notes:**
- **Version lockstep.** `@playwright/test` 1.62.1, `@playwright/mcp@0.0.80` and the devcontainer Dockerfile stay pinned together (`playwright.config.ts:10-20`). CI's browser cache key reads the `@playwright/test` version, so a bump re-installs automatically.
- **Secrets never land in artifacts.** Slice 5's `buildConfig` (`trace: "off"` when deployed) is what slice 8 relies on. Don't add a `trace` override in the workflow.
- **`docker-compose.yml` edits invalidate every cached turbo task** (`globalDependencies`). That's a one-time performance event in slice 5, not a correctness issue.
- **Tidy screenshots.** Keep all screenshots under `packages/e2e/test-results/` (`feedback_clear_e2e_test_results_after_merge`).
- **Docs in the same PR.** Slice 10 is mandatory, not a follow-up. `.env.example` edits ride with slices 3 and 5.
- **Review chain.** This is a full feature, so code-review, security (auth + secrets + prod access: required), smoke and adversarial all apply. The smoke doc records the deferred live proofs from slices 8–9.

## Next step

Implementation begins on this branch at slice 1, tests first, one commit per slice, once discovery, spec and plan are confirmed.
