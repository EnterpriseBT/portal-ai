# Integrate the security epic onto main — Plan

**TDD-sequenced landing of the security epic (#578) on `main`: the reconciled merge (auth model + drizzle renumber) as one green commit, then the boot-time issuer fail-fast, then the landing + verification.**

Spec: `docs/INTEGRATE_SECURITY_EPIC.spec.md`. Discovery: `docs/INTEGRATE_SECURITY_EPIC.discovery.md`. Issue: #616. Builds on **shipped #569** (deployment epic, on `main`, live on app-dev) and the **#578 security epic** (13 commits on `epic/security-readiness`).

**A note on shape.** This is a *merge*, not a greenfield feature — a git merge can't be committed with conflict markers, so the reconciliation of all 16 conflicts (+ the drizzle renumber + the `stripe_events` sweep) is necessarily **one commit** that must leave the tree compiling and green. Slice 1 is that commit; its internal work is ordered + verified step-by-step before committing. Slices 2–3 are clean additive commits on top.

Three slices on `chore/616-integrate-security-epic` (PR #617 → `main`). Run tests via npm scripts (`feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
npm run type-check   # root
```

Sequencing rationale — the merge must land whole and green (slice 1); the boot fail-fast is a clean additive that would only muddy the merge diff (slice 2); the landing + the deployment-migrated-DB check happen against `main`/app-dev (slice 3).

---

## Slice 1 — The reconciled merge + drizzle renumber (one commit, green)

`git merge origin/main` with all 16 conflicts resolved to the spec's reconciled design, the five security migrations renumbered, and the `stripe_events`→`commercial_events` sweep — committed once, compiling, lint/type-check clean, existing + reconciled suites green.

**Files** (all from the spec's *Files touched*)

- **Combine-conflicts:** `apps/api/src/{environment.ts, constants/api-codes.constants.ts, services/sync-lock.service.ts, routes/protected.router.ts, .env.example}`, `apps/web/src/api/keys.ts` — union both sides' additions (Surface §§ environment/api-codes/sync-lock/protected.router/keys).
- **Auth API reconciliation:** `apps/api/src/config/sso.config.ts` (import `deploy-mode.ts`; mode-gated `issuers()`; `provisioningFallback` via `isResidency()`), `apps/api/src/middleware/auth.middleware.ts` (lazy multi-issuer `getValidators()`), `apps/api/src/routes/webhook.router.ts` (no Auth0 login-sync + marketplace kept). `config/deploy-mode.ts` kept as-is.
- **Frontend reconciliation:** resolve to main's seam — `apps/web/src/providers/{Auth,Application}.provider.tsx`, `api/auth.api.ts`, `components/LoginForm.component.tsx` (re-add #585 `onRedirectCallback` returnTo).
- **Drizzle renumber:** `git mv` `apps/api/drizzle/0094_add-audit-log-table→0096`, `0095_add_organization_user_role→0097`, `0096_add_users_auth0_id_unique_index→0098`, `0097_add_org_seats→0099`, `0098_add-user-last-login-session→0100` (SQL untouched); keep deployment's `0094/0095`; rebuild `meta/_journal.json` (0–100) + snapshots (latest = full merged schema).
- **Sweep:** any `stripe_events`/`stripe-events`/`StripeEvent*` in security-epic code/tests → `commercial_events` equivalents.
- **Tests reconciled:** `apps/api/src/__tests__/{config/sso.config.test.ts, middleware/auth.middleware.test.ts}`, `apps/web/src/__tests__/LoginForm.test.tsx`.

**Steps** (ordered; verify each before committing the single merge)

1. `git merge origin/main` (expect the 16 conflicts). Resolve the **combine-conflicts** first (mechanical unions).
2. **Drizzle renumber** + rebuild journal/snapshots. Verify in isolation: `db:generate` **no-op** (spec case 14) and a fresh `db:migrate` applies 0–100 (case 12). If `db:generate` emits a diff, the latest snapshot is wrong — fix and re-run.
3. **Auth API reconciliation** (`SsoConfig` mode-gated, lazy multi-issuer validator, webhook). Reconcile the api test suites; run `apps/api` unit + integration (cases 1–9, 11).
4. **Frontend reconciliation** to main's seam; reconcile `LoginForm.test`; run `apps/web` unit (cases 15–16).
5. **Sweep** `stripe_events`→`commercial_events`; `npm run type-check` at root surfaces any missed reference (case 17) — the table/repository are deleted on main, so a stale ref is a compile error.
6. `npm run lint && npm run type-check` clean; full `apps/api` + `apps/web` suites green. **Commit the merge.**

**Done when:** the merge is one commit; type-check/lint clean; `db:generate` no-op; fresh `db:migrate` clean; all reconciled suites pass (cases 1–9, 11, 12, 14, 15, 16, 17). Boot fail-fast (case 10) and the deployment-migrated-DB check (case 13) are slices 2–3.

**Risk:** the snapshot rebuild (step 2) is the delicate part — `db:generate` no-op is the gate. The auth reconciliation is auth-critical — cases 6–9 (multi-issuer routing) are the proof. If the merge can't reach green, **stop and report** rather than committing a broken tree.

---

## Slice 2 — Boot-time issuer fail-fast

A clean additive: restore #577's fail-fast on malformed `SSO_ISSUERS` (which the lazy validator would otherwise defer to the first request) without eager validator construction.

**Files**

- Edit: `apps/api/src/index.ts` — after `assertDeployModeConsistency(...)` in `start()`, call `SsoConfig.issuers()` once (discard result) inside the same fatal-exit path.
- Edit/extend: `apps/api/src/__tests__/middleware/auth.middleware.test.ts` (or an `index`/boot test) for case 10.

**Steps**

1. **Tests (spec case 10).** validators are not constructed at import (spy proves first-request construction); a malformed `SSO_ISSUERS` throws from the boot check, not deferred. Run; fail.
2. **Implement** the boot-check call in `index.ts start()`. Green.
3. Lint + type-check.

**Done when:** case 10 passes — lazy validator + boot fail-fast both hold.

**Risk:** none beyond ordering (the check must run *after* the deploy-mode guard so residency reports its own errors first).

---

## Slice 3 — Land on main + verify (deployment-migrated DB + app-dev)

Mark PR #617 ready, land it, and verify the two things only checkable against real state.

**Steps**

1. **Deployment-migrated-DB check (spec case 13).** Against a DB holding deployment's `0094/0095` (a reset local dev DB re-migrated to main's state, or a seeded fixture): run the merged `db:migrate` and assert `0094/0095` skip by hash and `0096–0100` apply. Record as evidence.
2. Full suites green on the branch; CI green on PR #617.
3. Merge PR #617 → `main` (squash — the merge resolution makes rebase unclean; linear history preserved). `Closes #616` + the 11 merged children (#578 stays open).
4. Watch the app-dev **Deploy Dev** run to success; curl `/api/health` + `/api/health/ready` (200) — the live gate.
5. Retire `epic/security-readiness` (delete local + remote); update #578's status table (11 children → landed on main).

**Done when:** both epics are on `main`; app-dev green + serving; #616 + children closed; #578 carries only #397/#598/#599/#613.

**Risk:** app-dev auth breakage is the live risk — the boot guard + multi-issuer suite are the pre-merge proof; a failed app-dev deploy is recoverable via revert (the merge is one squash commit).

---

## Sequence summary

| Slice | Lands | Spec cases | Gate |
|---|---|---|---|
| 1 | reconciled merge + drizzle renumber + sweep (one commit) | 1–9, 11, 12, 14, 15, 16, 17 | type-check/lint, `db:generate` no-op, fresh migrate, full suites |
| 2 | boot-time issuer fail-fast (`index.ts`) | 10 | api tests |
| 3 | land on main + verify | 13 | deployment-migrated migrate, CI, app-dev deploy + health |

Total ≈ **17 cases**. Commits on `chore/616-integrate-security-epic`; PR #617 grows commit-by-commit, then squash-merges to `main`.

## Cross-slice notes

- **The merge is monolithic by necessity** — slice 1 is large because a git merge can't be committed partially resolved. The internal ordering (combines → drizzle → auth API → frontend → sweep) is a work sequence with a checkpoint per step, not separate commits.
- **Drizzle: no regenerate.** Renumber + hand-rebuild snapshots; deployment's `0094/0095` SQL is byte-preserved (hashes match app-dev). `db:generate` no-op is the correctness gate; the rename is never turned into drop/create.
- **Auth is fail-closed.** The reconciled validator must accept every path (Auth0, `SSO_ISSUERS`, residency `OIDC_ISSUER`); cases 6–9 + the boot guard are the proof before app-dev (slice 3) is the live gate.
- **Doc-sync.** The auth reconciliation changes a documented convention (DEPLOY_MODE values). Re-check `apps/api/README.md` / `CLAUDE.md` mentions of `self_hosted` and update to `residency` in the same PR (per CLAUDE.md → "Keeping Documentation in Sync"). The `docs/DEPLOY_MODE_SEAM.discovery.md` is a swept phase doc — not updated.
- **`#578` stays open.** This lands the merged children only; #397/#598/#599/#613 proceed off `main` afterward.

## Next step

Implement slice 1 on `chore/616-integrate-security-epic` — the reconciled merge, tests-first per the ordered checkpoints — only after discovery + spec + plan are confirmed. Before starting, re-read the spec's *Surface* (the exact `SsoConfig`/validator/drizzle shapes) — this is auth-critical, live-code reconciliation; lift the reconciled contract exactly, don't improvise.
