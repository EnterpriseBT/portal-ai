# Portal App-admin CLI — Plan

**TDD-sequenced implementation of `portalai`: the data layer + parity pin and reads, then guarded/audited mutations with the session requirement, then the apps/api provisioning refactor + spawn commands, then bin/docs/smoke.**

Spec: `docs/PORTAL_ADMIN_CLI.spec.md`. Discovery: `docs/PORTAL_ADMIN_CLI.discovery.md`. Issue: #190 (epic #191 — the last child). Builds on shipped #194 (`@portalai/cli-env`) and #192 (`portalops` conventions/scaffold).

Four slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/portal-admin-cli` / PR #193** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/admin-cli && npm run test:unit    # test:integration is "true"; live paths = manual smoke
cd apps/api && npm run test:unit              # provisioning refactor + scripts
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale:
- **Slice 1** — scaffold + the data foundation: tables with the parity pin (the drift guard must exist before any query ships) and read-only store methods. Nothing mutates yet.
- **Slice 2** — all store mutations + the org/user/member command layer with guards, the **session requirement**, audit, and `login`/`logout`. The CLI's own domain logic completes here.
- **Slice 3** — the `apps/api` side (the `provisionOrganizationFor` refactor + `db:create-org`/`db:seed:org` scripts) and the CLI spawn commands (`org create`, `org reset`, `seed org`). Cross-package, so it lands after the CLI's internals are stable.
- **Slice 4** — bin wiring + docs + smoke + doc-sync; deletions/retire don't exist here (nothing is retired), so slice 4 is pure assembly and the epic-closing smoke.

---

## Slice 1 — Scaffold + tables/parity pin + store reads

**Files**

- New: `packages/admin-cli/` scaffold cloned from `devops-cli` (package.json — `bin: portalai`, deps: cli-env/core workspace, commander, drizzle-orm, postgres; tsconfigs, jest, eslint).
- New: `src/errors.ts` (`AdminCliError` + `AdminNotFoundError`/`AdminConflictError`), `src/output.ts` (exit map incl. 8/9, banner, envelope — cloned pattern), `src/tables.ts` (organizations/users/organizationUsers/tiers minimal defs), `src/store.ts` (reads only: `listOrgs`, `getOrg`, `listUsers`, `getUserByEmail`), `src/index.ts`.
- New: `src/__tests__/tables-parity.test.ts`, `src/__tests__/store.test.ts` (read cases), `src/__tests__/helpers/` (cli-env mock cloned from devops-cli; a drizzle-mock helper for store tests).

**Steps**

1. **Tests (spec Layer 1 ≈4 + store reads ≈4).** Parity: each CLI table subset-matches the API's via `getTableConfig` (deliberate-mismatch red first); reads: deleted-filtering, search/pagination, `getOrg` → `ADMIN_NOT_FOUND`, `getUserByEmail` live-only. Run; fail.
2. **Implement.** Green.
3. Lint + type-check; turbo picks up the package.

**Done when:** ≈8 cases pass; no mutation paths exist; the parity pin fails loudly on a doctored column.

**Risk:** the parity test's relative import of `apps/api` schema — pure modules, but verify jest transforms files outside the package rootDir (they do; ts-jest transforms per-file).

---

## Slice 2 — Store mutations + org/user/member commands (session + guards + audit) + login/logout

**Files**

- Edit: `src/store.ts` — `updateOrg`, `setTier` (tier-existence check, returns `previousTier`), `softDeleteOrg`, `addMember` (conflict/revive), `removeMember`, `switchMember` (lastLogin bump).
- New: `src/session.ts` — `requireSession(def)` (staging/prod mutations: cli-env `getToken` or `ENV_NOT_AUTHORIZED` naming `portalai login`; local exempt) + `operatorFor(def)` (session `sub` decoded, local fallback `os.userInfo().username`).
- New: `src/commands/org.ts` (list/get/update/set-tier/delete), `src/commands/user.ts` (list/get), `src/commands/member.ts` (add/remove/switch — email-resolved), `src/commands/auth.ts` (login/logout wrapping cli-env).
- Edit: `src/__tests__/store.test.ts` (+6 mutation cases); New: `src/__tests__/commands.test.ts`.

**Steps**

1. **Tests (spec Layer 2 remainder ≈6 + Layer 3 command cases ≈8 of 11).** Store: update stamps updated/updatedBy; setTier validates + previousTier; delete stamps deleted; member conflict/revive/remove/switch. Commands: guard classes; **staging mutation without session → 4 naming login; local exempt**; audit operator = session `sub`, ids-not-rows; email resolution (8 on unknown); `dispose()` always. Run; fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** the CLI's own domain surface is complete and guarded; only spawn-backed commands (create/reset/seed) remain.

**Risk:** decoding the cached token's `sub` without verification — attribution only; pin the base64url decode against a fixture token.

---

## Slice 3 — apps/api provisioning refactor + scripts + spawn commands

**Files**

- Edit: `apps/api/src/services/application.service.ts` — extract `provisionOrganizationFor(userId, opts?, tx?)` (org + membership + `seedSystemColumnDefinitions` + sandbox instance + default station/toolpack/link + `defaultStationId`); `setupOrganization` keeps its signature (creates the user, then delegates).
- New: `apps/api/src/db/create-org.ts` (`--owner-email --name`; owner must exist), `apps/api/src/db/seed-org.ts` (`--name` required, `--member-email` optional, idempotent by live name, synthetic owner `seed|<uuid>`); Edit: `apps/api/package.json` (+`db:create-org`, `db:seed:org`).
- New: `packages/admin-cli/src/commands/provision.ts` — `orgCreate`, `orgReset`, `seedOrg` (guard → session → spawn `npm run --workspace @portalai/api <script>` with `DATABASE_URL` from the env connection; injectable spawner).
- New: `apps/api/src/__tests__/services/application.provision.test.ts`; Edit: `packages/admin-cli/src/__tests__/commands.test.ts` (+3 spawn cases).

**Steps**

1. **Tests (spec Layer 5 ≈7 + spawn cases ≈3).** `provisionOrganizationFor` creates the full set for an existing user (mocked repos assert each artifact); `setupOrganization` webhook parity; create-org rejects unknown owner; seed-org idempotent + member-email; CLI spawn contracts (argv, `DATABASE_URL` injection, guard-before-spawn, destructive classes). Run; fail.
2. **Implement.** Green.
3. Lint + type-check both packages; `apps/api` full unit suite (the refactor touches the webhook path — its existing tests must stay green).

**Done when:** a CLI-created/seeded org is provisioned by the exact code the webhook uses; all ≈33 spec cases green.

**Risk:** the `setupOrganization` refactor regressing the webhook flow — gated by the existing `application.service`/webhook tests plus the new parity case.

---

## Slice 4 — bin + docs + smoke + doc-sync

**Files**

- New: `src/bin.ts` (`portalai` commander wiring — groups `login/logout`, `org`, `user`, `member`, `seed`; extended exit map; `runCli`); Edit: package.json build chmod.
- New: `packages/admin-cli/README.md` (running it, command guide, guard + session rules, quickstarts incl. the `npm run db:reset` habit + the seed→switch flow), `packages/admin-cli/COMMANDS.md` (agent reference, exit codes 2–9).
- New: `docs/PORTAL_ADMIN_CLI.smoke.md` — the epic-closing checklist: full org lifecycle against local + app-dev (create → verify full provisioning by logging in → update/set-tier → member add/switch/remove → delete), seed org + member switch landing your Google login inside it, org reset round-trip, session-requirement (mutation without login → 4), exit codes.
- Edit (doc-sync): root `README.md` (tree + quickstart mention), `CLAUDE.md` monorepo row (+ copilot mirror).
- New: `src/__tests__/bin.test.ts`.

**Steps**

1. **Tests (spec Layer 4 ≈3).** Required `--env`; exit 8 with the JSON envelope; banner/stdout separation. Run; fail.
2. **Implement bin + write the docs; execute the smoke together (app-dev session + your Auth0 login needed); sign off.**
3. Lint + type-check; full `turbo run test:unit`; `npx portalai --help` live.

**Done when:** smoke signed off; docs shipped; PR #193 ready — the epic's last child complete.

**Risk:** none structural — assembly + the joint smoke.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | scaffold + tables/parity pin + store reads | ≈8 cases; doctored-column red verified |
| 2 | store mutations + commands + session/guards/audit + login/logout | domain surface complete (≈14 more cases) |
| 3 | provisioning refactor + create-org/seed-org scripts + spawn commands | ≈33 total green; webhook tests unaffected |
| 4 | bin + README/COMMANDS + smoke + doc-sync | smoke signed off; `portalai --help` live |

## Cross-slice notes

- **The parity pin lands before any query ships** (slice 1) — every later slice inherits the drift guard.
- **`requireSession` applies only to mutation/destructive classes on staging/prod** — reads and local stay frictionless; pinned once in slice 2 and inherited by slice 3's spawn commands.
- **Slice 3 touches the webhook path** — run `apps/api`'s full unit suite at that boundary, not just the new tests.
- **`db:reset` (npm script) is NOT retired** — it's the app's own entrypoint that `portalai org reset` spawns; README documents the relationship (doc-sync, slice 4).
- **Smoke needs live prerequisites** (fresh `aws login`, your Auth0 device-flow login for app-dev, disposable local DB) — scheduled together like the #194/#192 walkthroughs.

## Next step

Implementation begins on `feat/portal-admin-cli` — slice 1 first, tests-red-then-green, one commit per slice; the slice-4 smoke is walked together, and its sign-off closes the Portal CLIs epic.
