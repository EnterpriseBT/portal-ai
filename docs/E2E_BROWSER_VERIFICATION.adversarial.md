# E2E_BROWSER_VERIFICATION — Adversarial Review

Adversarial probes for [#489](https://github.com/EnterpriseBT/portal-ai/issues/489) — the build-flagged QA sign-in, the `E2E Tests` walk, post-deploy `verify-login`, and deployed Playwright MCP sessions as a QA owner / admin / member. **Branch under test:** `feat/489-e2e-browser-verification` (PR [#880](https://github.com/EnterpriseBT/portal-ai/pull/880)).

The change's attack surface is the **QA sign-in** (a second way into Auth0 in deployed builds), the **QA identities' isolation** (one membership, the QA org), the **harness's input handling** (`--invite`, `--identity`, `--env`), and **public CI artifacts**. §1 is `N/A`; the rest are engaged. Probes against app-dev / prod need the runbook setup and the first deploy after merge; they're tagged `— manual` until then.

## Preflight

### Environment
- [ ] `git checkout feat/489-e2e-browser-verification && git pull --ff-only && npm install`
- [ ] The e2e package's workspace deps are built (`npm run build`)
- [ ] Local probes: `npm run --workspace @portalai/e2e e2e:stack:up` (web :3000 preview build with `VITE_AUTH0_QA_CONNECTION`, api :3001, stub :4010)
- [ ] A **second** local web build *without* `VITE_AUTH0_QA_CONNECTION` for §4's unflagged-build probe (`npm run dev` is one: it sets no QA connection)

### Fixtures
- [ ] `packages/e2e/.env` carries the owner / admin / member `E2E_AUTH0_*` pairs
- [ ] A second org's id on hand (any org the QA identity isn't in: e.g. the `e2e-fixture` org from `e2e:seed`, or a fresh org from another user) for §5
- [ ] For deployed probes: the app-dev QA org provisioned per `docs/E2E_DEPLOYED_QA.runbook.md`

### Reset between runs
- [ ] `e2e:stack:down` then `up` gives a fresh `portal_ai_e2e` database
- [ ] Delete any `packages/e2e/.auth/**` or stray `*.storageState.json` a §2 probe wrote outside `.auth/`

## §1 — Boundary & limit inputs
- N/A — the change adds no size, count or pagination surface; its inputs are flags and a URL, covered as malformed input in §2.

## §2 — Malformed & injection input
- [ ] `e2e:auth -- --env app-dev --identity admin --invite 'https://evil.example/invitations/accept?token=x'` — expected SAFE: refused before any browser starts, `--invite must be a link on https://app-dev… (the app-dev app)`; no password is typed anywhere. — backend
- [ ] Same with an origin look-alike and userinfo: `--invite 'https://app-dev.portalsai.io.evil.example/invitations/accept?token=x'` and `--invite 'https://app-dev.portalsai.io@evil.example/invitations/accept?token=x'` — expected SAFE: both refused (URL origin is `evil.example`). — backend
- [ ] `--invite 'javascript:alert(1)'`, `--invite 'not a url'`, and a right-origin wrong-path `--invite 'https://app-dev.portalsai.io/settings?token=x'` — expected SAFE: refused with "is not a URL" / "must be a link on …" / "must be an invitation link". — backend
- [ ] `--env staging` and `--env PROD` — expected SAFE: a config error naming the known envs; nothing resolves to prod by accident. — backend
- [ ] `--env app-dev --identity '../../owner'` and `--identity root` — expected SAFE: refused, `expected owner | admin | member`; no Secrets Manager read is attempted. — backend
- [ ] **Local identity path escape:** `e2e:use '../../../tmp/x'` (local target) and `e2e:auth -- --identity '../../x'` — expected SAFE: refused, or the state file stays inside `packages/e2e/.auth/`. Record where any file landed. — backend
- [ ] `/login?qa=<script>alert(1)</script>` and `/login?qa=0` on the QA-flagged build — expected SAFE: the query value is never rendered (no script runs); `?qa=0` showing the button is acceptable (the build flag is the gate), and its click still pins the QA connection only.

## §3 — Concurrency & races
- [ ] Push two commits to a throwaway branch seconds apart — expected SAFE: the first `E2E Tests` run is cancelled (`cancel-in-progress`), the second runs to completion on its own runner; no shared state, no artifact carrying the cancelled run's secrets. — backend
- [ ] Two back-to-back app-dev deploys — expected SAFE: each `verify-login` waits on **its own** `invalidation_id` before signing in, so neither verifies the other's build (read both runs' logs for the ids). — manual
- [ ] Run `e2e:auth:app-dev` and `e2e:use member --env app-dev` concurrently — expected SAFE: the active `storageState.json` ends as one complete identity's file (valid JSON, mode `0600`), never a mix. — backend

## §4 — Auth & permission boundaries
- [ ] **Unflagged build:** on a build without `VITE_AUTH0_QA_CONNECTION` (`npm run dev`), open `/login?qa=1` — expected SAFE: only "Sign in with Google"; no `e2e-qa-login` test id in the DOM.
- [ ] **Sign-ups disabled:** on the app-dev Auth0 Universal Login reached via QA sign-in, try "Sign up" / hand-craft `/authorize?…&connection=<qa connection>&screen_hint=signup` with a new email — expected SAFE: no sign-up option, or Auth0 refuses (`signup disabled`); no user is created on the QA connection. — manual
- [ ] **Connection not on other apps:** call `/authorize` for any other Auth0 application in the tenant with `connection=<qa connection>` — expected SAFE: Auth0 refuses (connection not enabled for the client). — manual
- [ ] **QA member past its UI:** signed in as the CI/QA member, `POST /api/organization/invitations` with a valid body — expected SAFE: `403 PERMISSION_DENIED`, no invitation row. — backend
- [ ] **QA admin past its UI:** as admin, `DELETE /api/organization/<qa org id>` with the **correct** `confirmationName` — expected SAFE: `403 PERMISSION_DENIED`, org untouched. (The spec probes a wrong name; this probes the real one.) — backend
- [ ] **Member self-escalation:** as member, change its own role to admin (`PATCH` the membership's roles) — expected SAFE: `403`; the member's roles unchanged. — backend
- [ ] **Brute force:** ten wrong passwords for the app-dev QA member through the QA sign-in — expected SAFE: Auth0's brute-force protection blocks the account and notifies; the correct password then fails until unblocked. — manual

## §5 — Multi-tenant isolation
- [ ] As the QA owner (local CI user or app-dev), with its bearer token, `GET /api/organization/<other org id>` and `GET /api/connector-instances?organizationId=<other org id>` — expected SAFE: `404` / only the QA org's rows; nothing from the other org. — backend
- [ ] In a `playwright-app-dev` session as the QA owner, open the org switcher — expected SAFE: exactly one org listed ("QA (app-dev)"). — manual
- [ ] Accept an invitation **to another org** (issued by any non-QA owner) while signed in as the QA member — expected SAFE (process): this is the incident the runbook names; the next `login` project run for `member` fails `memberships … toHaveLength(1)`. Confirm it does, then remove the membership. — manual

## §6 — State & lifecycle abuse
- [ ] **Reused invite:** run `e2e:auth -- --identity admin --invite '<link already accepted>'` — expected SAFE: the accept POST is refused (already used / not found); the admin does **not** land in a fresh personal org; the command fails with a clear error. — backend
- [ ] **Owner removed from the QA org:** remove the QA owner's membership (local stack: SQL soft-delete of the membership), then run `--project=login` as owner — expected SAFE: the check goes red. Record what actually happens: if first-login self-provisioning gives the owner a **new** org, `memberships` is again 1 and the check passes against the wrong org. That is a mismatch to file (the invariant should pin the QA org's id, not only the count). — backend
- [ ] **Rotated password:** rotate a QA password in Auth0 without `vars set` — expected SAFE: the next `verify-login` goes red at Auth0 ("Wrong email or password"), with the password absent from logs and artifact; existing captured `storageState`s stop refreshing. — manual
- [ ] **Stale active state after a role change:** `e2e:use member --env app-dev`, demote nothing, then delete `member.storageState.json` and run `e2e:use member` again — expected SAFE: refused with the `no member session … run e2e:auth -- --env app-dev --identity member` hint; the previous active state isn't silently kept as "member". — backend
- [ ] **Unbaked connection:** deploy app-dev with `DEV_VITE_AUTH0_QA_CONNECTION` unset — expected SAFE: `verify-login` goes red at "QA sign-in" not found (runbook's first symptom row); the deploy stays live, nothing rolls back. — manual

## §7 — Misuse sequences
- [ ] **Fork PR secrets:** confirm no workflow added here runs on `pull_request` or `pull_request_target`, and `verify-login` runs only inside `deploy-*` (push to `main` / release) — expected SAFE: a fork PR can't get the `E2E_CI_*` secrets or AWS credentials. — backend
- [ ] **A red run on a branch that prints secrets:** on a throwaway branch, add `console.log(process.env.E2E_AUTH0_PASSWORD)` to a spec — expected SAFE: GitHub masks it as `***` in the log; the uploaded artifact (png/webm/stack logs) doesn't contain it (`grep -rlaF`). Delete the branch and artifact afterwards. — backend
- [ ] **Billing from the QA org:** in a `playwright-app-dev` session, Settings → Billing → upgrade — expected SAFE: the navigation to `checkout.stripe.com` is blocked by `--allowed-origins`; no checkout session completes. — manual
- [ ] **Leaving the allowed origins by redirect:** in a deployed MCP session, navigate to an app URL that redirects off-origin (e.g. the Google OAuth start from "Sign in with Google") — expected: documented as a guardrail gap, not a boundary; confirm the QA identity still reaches only the QA org's data wherever it lands. — manual
- [ ] **Prod destructive op from a prod MCP session:** as the prod QA owner, try Settings → Organization → Delete on the QA org — expected SAFE (conduct + recovery): the runbook's re-provision steps restore the invariant; `verify-login` on the next release would fail loudly, not silently provision. Don't walk this on prod; walk it on app-dev and record the recovery. — manual

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | | |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/job/entity ids):
