# e2e-browser-verification — Smoke Suite

Manual smoke test for [#489](https://github.com/EnterpriseBT/portal-ai/issues/489). It covers browser verification in three tiers:
- **PR walk:** the `E2E Tests` walk of a freshly provisioned org (login, core loop, owner / admin / member split) on an ephemeral stack;
- **Post-deploy check:** `verify-login`, at the end of each app-dev / prod deploy;
- **Agent sessions:** against app-dev and prod as a QA owner, admin or member.

**Branch under test:** `feat/489-e2e-browser-verification` (PR [#880](https://github.com/EnterpriseBT/portal-ai/pull/880)).

Run **§Preflight** once. After that, each section stands alone. Each step is tagged by who can verify it:
- **untagged:** agent-walkable with `/smoke-walk` (Playwright MCP);
- **`— backend`:** a command or `gh` check the agent can run and report;
- **`— manual`:** needs a human, because it involves a vendor dashboard, judgment, or a deploy only you trigger.

§1–§3 run on the PR as it stands. §4–§7 need the app-dev Auth0 setup and the first app-dev deploy after merge, so they are walked **after merge**; the PR's hold note covers that. §8 waits for the next prod release.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, type `Bug`, and link this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/489-e2e-browser-verification && git pull --ff-only` — backend
- [ ] `npm install && npm run build -- --filter=@portalai/e2e^...` (the e2e package imports `@portalai/cli-env`'s built output). No migration on this branch. — backend
- [ ] **Stop `npm run dev`** before §1: the ephemeral stack uses :3000, :3001 and :4010. — backend
- [ ] `packages/e2e/.env` has the dev-tenant owner, admin and member (`E2E_AUTH0_USERNAME[_ADMIN|_MEMBER]` / `E2E_AUTH0_PASSWORD[_ADMIN|_MEMBER]`). Check with `grep -c '^E2E_AUTH0_' packages/e2e/.env` → `6`. — backend

### For §4–§8 (deployed)

- [ ] App-dev Auth0 setup done per `docs/E2E_DEPLOYED_QA.runbook.md` → "Auth0 tenant" and "secrets" (the #854 app-dev #489 items). — manual
- [ ] AWS credentials live in the container (`aws sts get-caller-identity` succeeds). — backend

### Reset between runs

- [ ] §1: `npm run --workspace @portalai/e2e e2e:stack:down`, then `up`. `roles` can't run twice on one stack, because an accepted invite can't be replayed. — backend
- [ ] Afterwards: `rm -rf packages/e2e/test-results/* packages/e2e/playwright-report`. — backend

---

## §1 — The specs on the ephemeral stack (plan slices 4–5, 7)

- [ ] `E2E_QA_CONNECTION=Username-Password-Authentication npm run --workspace @portalai/e2e e2e:stack:up` → ends with `[e2e-stack] up: web :3000 · api :3001 · stub :4010 · db portal_ai_e2e`. — backend
- [ ] `E2E_SIGN_IN_VIA=qa npm run --workspace @portalai/e2e test:e2e -- --project=setup --project=core-loop --project=login --project=roles` → `4 passed`. — backend
- [ ] With the stack still up, open `http://localhost:3000/login` in a fresh, signed-out browser: only **Sign in with Google** shows, with no "QA sign-in".
- [ ] `http://localhost:3000/login?qa=1` → a **QA sign-in** button (`data-testid="e2e-qa-login"`) appears below the Google button. Clicking it leaves for Auth0 Universal Login on the dev tenant.
- [ ] `ls -l packages/e2e/.auth/ci.storageState.json` → `-rw-------` (0600). — backend
- [ ] **Regression check, roles.** On a fresh stack, run `--project=login` once, so the org and its roles exist. Then grant `member` admin access:
  ```sql
  -- psql -h postgres-test -U postgres -d portal_ai_e2e
  INSERT INTO policy_attachments (id, created, created_by, organization_id, policy_id, principal_type, principal_id)
  SELECT gen_random_uuid()::text, (extract(epoch from now())*1000)::bigint, 'e2e-regression',
         p.organization_id, p.id, 'role', r.id
  FROM permission_policies p JOIN roles r ON r.organization_id = p.organization_id AND r.slug = 'member'
  WHERE p.name = 'AdminAccess';   -- INSERT 0 1
  ```
  `--project=setup --project=roles` → it fails at the member's Members-tab probe (`Expected: 0, Received: 1`) with a screenshot. Reset the stack afterwards. — backend
- [ ] **Regression check, core loop.** Stop the stub (`kill -- -$(cat packages/e2e/test-results/stack/stub.pid)`), then run `--project=setup --project=core-loop` → it fails at **Interpret**. Reset the stack afterwards. — backend
- [ ] **Failed `up` cleans up.** With :4010 free, make `up` fail after the stub starts. For example, stop `postgres-test` right after `up` begins migrating, or run a copy of the script with `false` before `db:migrate`. `up` prints `up failed; stopping what it started`, no `*.pid` is left in `test-results/stack/`, and `curl -s localhost:4010/health` gets no answer. — backend

## §2 — `E2E Tests` on the PR (slice 6)

- [ ] `gh pr checks 880 --repo EnterpriseBT/portal-ai` lists **E2E Tests** as `pass` on the head commit. — backend
- [ ] Its log shows `4 passed`, run as setup, login, core-loop and roles, **not** the `E2E skipped` notice. — backend
- [ ] It's **not required**: `gh api repos/EnterpriseBT/portal-ai/branches/main/protection/required_status_checks --jq .contexts` → `["Unit Tests","Integration Tests","Static Checks"]` (no `E2E Tests`). — backend
- [ ] Its log shows the stack booting its own Postgres, Redis, s3mock, stub, API and web (`Boot the ephemeral stack`), and **Tear down** ran. — backend
- [ ] It runs on `push` only: `grep -A3 '^on:' .github/workflows/e2e-test.yml` shows `push` with `branches-ignore: main`, and no `pull_request`. — backend

## §3 — Red-run artifacts carry no credential (slice 6, decision 15)

- [ ] On a scratch branch off this one, break the walk on purpose. For example, make `core-loop.spec.ts` expect a heading `"Nope"`. Push it, and the `E2E Tests` run goes red. — backend
- [ ] Download its artifact (`gh run download <run-id> -n e2e-<run-id>`). It holds `test-results/stack/*.log` plus `*.png` / `*.webm` only: no `trace.zip`, no `playwright-report/`, no `error-context.md`, no `.auth/`. — backend
- [ ] `grep -rl -e "$E2E_AUTH0_PASSWORD" -e "$E2E_AUTH0_PASSWORD_ADMIN" -e "$E2E_AUTH0_PASSWORD_MEMBER" <download dir>` → no match. Run it with the values from `packages/e2e/.env`, and don't paste them anywhere. — backend
- [ ] Open the screenshot: any password field shows masked dots. — manual
- [ ] Delete the scratch branch and its run's artifact. — backend

## §4 — QA sign-in in deployed builds (slices 3, 8)

After the first app-dev deploy that carries #880:

- [ ] Signed out, `https://app-dev.portalsai.io/login` → **Sign in with Google** only. A normal user's login is unchanged.
- [ ] `https://app-dev.portalsai.io/login?qa=1` → **QA sign-in** shows, and clicking it lands on `portalsai-staging.us.auth0.com` with the QA connection's username/password form (no Google button).
- [ ] The chart image never gets the var: `grep -n VITE_AUTH0_QA_CONNECTION .github/workflows/deploy-*.yml` shows it only under the two **Build frontend** steps, never in **Build and push web image**. — backend

## §5 — The QA connection refuses sign-ups (runbook)

- [ ] Auth0 dashboard → `portalsai-staging` → Authentication → Database → the QA connection: **Disable Sign Ups** is on, and Applications lists only the web SPA. — manual
- [ ] From `/login?qa=1` → QA sign-in, the Universal Login page offers no "Sign up" link. Opening `https://portalsai-staging.us.auth0.com/authorize?…&screen_hint=signup` with the QA connection refuses a new account. — manual
- [ ] Security → Attack Protection → Brute-force protection is on. — manual

## §6 — `verify-login` after an app-dev deploy (slice 8)

- [ ] The first **Deploy Dev** run after merge: `verify-login` is green. Its log shows the invalidation wait completing, then `1 passed` for `[login]`. The QA username and password appear only as `***`. — backend
- [ ] `tag-deploy` doesn't wait on it: in the run graph, `tag-deploy` needs only `deploy-frontend` and `deploy-backend`. — backend
- [ ] **A broken login goes red, with no rollback.** Set `DEV_VITE_AUTH0_QA_CONNECTION` to a wrong name and run **Deploy Dev** with `workflow_dispatch`. `verify-login` goes red, and its artifact holds only `*.png` / `*.webm`. The app stays deployed, and nothing reverts it. Restore the secret and redeploy. — manual

## §7 — Agent sessions on app-dev (slices 7, 9)

- [ ] `npm run --workspace @portalai/e2e e2e:auth:app-dev` → `storage state written to …/.auth/app-dev/owner.storageState.json` and `active app-dev session: …/.auth/app-dev/storageState.json`. `ls -l` shows both at `-rw-------`. — backend
- [ ] It read Secrets Manager, not `.env`: the step above ran with `packages/e2e/.env` filled in and no `E2E_QA_AUTH0_*` exported, yet signed in as `qa+app-dev@portalsai.io`. The dev-tenant pair would have failed on this tenant. — backend
- [ ] Provision the QA org per the runbook (rename, `set-tier`, invite the admin and member, `e2e:auth -- --env app-dev --identity <id> --invite '<link>'`). Each invite sign-in prints `<id> joined QA (app-dev)`. — manual
- [ ] `--invite` refuses a link on another origin: `npm run --workspace @portalai/e2e e2e:auth -- --env app-dev --invite 'https://app.portalsai.io/invitations/accept?token=x'` → `--invite must be a link on https://app-dev.portalsai.io`. — backend
- [ ] One membership each: `for id in owner admin member; do E2E_TARGET=app-dev E2E_IDENTITY=$id npm run --workspace @portalai/e2e test:e2e -- --project=login; done` → `1 passed` three times. — backend
- [ ] A deployed target runs only `login`: `E2E_TARGET=app-dev npx --workspace @portalai/e2e playwright test --list` lists only `[login]`. — backend
- [ ] Restart the MCP session. `mcp__playwright-app-dev__browser_navigate` to `https://app-dev.portalsai.io/` lands signed in on the Dashboard of **QA (app-dev)**.
- [ ] In that session, `browser_navigate` to `https://example.com/` is blocked: the page doesn't load, because `--allowed-origins` refuses the request.
- [ ] `npm run --workspace @portalai/e2e e2e:use -- member --env app-dev`, then restart the MCP session → `/settings` has no **Members** tab.
- [ ] `e2e:use -- admin --env app-dev`, then restart → **Members** with **Invite member** shows, and no **Delete organization**.
- [ ] `e2e:use -- owner --env app-dev`, then restart → back as the owner, with **Delete organization** under Settings → Organization.
- [ ] Screenshots from these walks land under `packages/e2e/test-results/app-dev/`, and `git status` shows nothing new outside it. — backend

## §8 — Prod (next release window)

- [ ] Prod Auth0 setup and secrets per the runbook, **before** the first release that carries #880 (the #854 prod item). — manual
- [ ] The release's **Deploy Prod** run: `verify-login` is green. — backend
- [ ] `e2e:auth:prod` writes `.auth/prod/owner.storageState.json` at 0600, the prod QA org is provisioned, and the one-membership loop passes for all three on `E2E_TARGET=prod`. — backend
- [ ] `mcp__playwright-prod__*` walks **QA (prod)** read-only, and `https://app-dev.portalsai.io/` is blocked from that session.

## §9 — Docs

- [ ] `packages/e2e/README.md` covers the three tiers, the specs table, deployed environments and the conduct rules, and has no "deferred" note. — manual
- [ ] `docs/E2E_DEPLOYED_QA.runbook.md` matches what you just did in §5–§7: commands, names and order. — manual
- [ ] `CLAUDE.md` → "Agent-guided browser sessions" and the copilot mirror describe the tiers and the boundary (one membership, not `--allowed-origins`). — manual

## §10 — Error & edge cases

- [ ] Root turbo keeps the target: `E2E_TARGET=app-dev npx turbo run test:e2e --dry=json | grep -c '"E2E_\*"'` ≥ 1. The task lists `E2E_*` in `passThroughEnv` and depends on `@portalai/cli-env#build`. — backend
- [ ] A missing CI secret skips with a name. On a fork (or with one `E2E_CI_*` secret removed temporarily), `E2E Tests` prints `E2E skipped: not available to this run: <NAME>` and goes green without booting the stack. — manual
- [ ] An unknown deployed identity is refused: `npm run --workspace @portalai/e2e e2e:use -- viewer --env app-dev` → `app-dev has no QA identity "viewer" (expected owner | admin | member)`, exit 1. — backend
- [ ] A role with no session yet: `e2e:use -- member --env prod` before any prod sign-in → names `e2e:auth -- --env prod --identity member`. — backend

## Sign-off

- [ ] §1–§3 verified on the PR
- [ ] §4–§7 verified after the first app-dev deploy
- [ ] §8 verified after the first prod release carrying #880
- [ ] §9–§10 verified
- [ ] <date + name> — confirmed against my own running stack and app-dev

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (run id / org id / QA identity / env):
