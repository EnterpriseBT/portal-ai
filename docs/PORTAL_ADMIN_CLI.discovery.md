# Portal App-admin CLI — Discovery

**Issue:** [EnterpriseBT/portal-ai#190](https://github.com/EnterpriseBT/portal-ai/issues/190) · epic **Portal CLIs** (#191) · foundations **#194 (`@portalai/cli-env`) and #192 (`portalops`), both shipped**

*Reconciled 2026-07-10: rebased on the shipped foundations, v1-deferral framing removed (scope = the full production capability; sequencing lives in the plan), agent-operability formalized.*

**Why this exists.** The app owner has no first-class, safe way to inspect or fix a customer organization's **application data** in a running environment — orgs, tier assignment, membership — nor a guarded way to seed/mock/reset app data for dev and QA. The infrastructure half of the epic is done (`portalops`); this is the **customer-app-data control plane**: `portalai`, a TypeScript CLI over the same foundations, deliberately **infra-free** so its domain core stays extractable by a future customer-facing developer CLI. Like its siblings, it must be drivable by an AI agent end to end.

## The current shape

### The shipped foundations (consume, don't build)

- **`@portalai/cli-env`** — `resolveEnvConnection(env)` (lazy `{ apiBaseUrl, kind, db(), token(), dispose() }`; DB path = `.env` locally, SSM tunnel on AWS envs — smoke-verified against app-dev), `getEnvironment`/`kind` classification, `assertOperationAllowed` guards, `recordAudit`, typed `CliEnvError` codes, **Auth0 device-flow sessions** (`login`/`getToken` — provisioned + live in both tenants, verified with a 200 from `api-dev.portalsai.io`).
- **`@portalai/devops-cli`** — the architectural template this CLI clones: library-first commands with **guards + audit inside the functions**, commander-thin `bin`, stderr banner / stdout payload, `--json` everywhere, the published exit-code contract (2/3/4/5/6/7), README + `COMMANDS.md` agent docs, package scaffold/toolchain.

### The domain surface to manage

- **Organizations** — `organizations.table.ts:9-24`: `name`, `timezone`, `ownerUserId`→users, `tier`→`tiers.slug` (default `standard`), `defaultStationId`. Repository: `organizations.repository.ts:13-34` (`findByName` + base CRUD with soft-delete + `DbClient` transactions).
- **Users & membership** — `users.table.ts:10-17` (`auth0Id`, `email`, …) + the `organization-users` join.
- **Tier assignment** — `org.tier` FK; `tier.service.ts` resolves policy (60s cache — a CLI tier change takes ≤1min to bite).
- **Org-scoped reset** — `apps/api/src/db/reset.ts` → `ResetService.resetOrganization(id)` / `resetFirst()`; the `db:reset` npm script **remains and is this CLI's to absorb** (per #192's retire map — it's app-data, not infra).
- **Seeding** — `SeedService` (`seed.service.ts`) seeds system definitions only; **no customer-org fixtures exist** — the mock/demo-org capability is net-new here.
- **The HTTP API has no admin surface**: `organization.router.ts` exposes only `current`/`usage`/`PATCH {id}` — no list/create/delete, no admin RBAC.

### Data access — what the repository layer requires

The API's repository/service layer (`DbService.repository.*`) encodes the invariants (soft-delete, FKs, tier default). It lives in `apps/api` and binds to `apps/api`'s drizzle client, which reads `DATABASE_URL` at module load (`environment.ts` pattern) — consuming it from another package means either importing app internals across the workspace or giving the CLI its own thin data layer over the same schema. This is the central technical decision below.

## The design space

### Decision 1 — Data path: DB access vs the HTTP API

The earlier lean ("API-target, DB-fallback for v1") predates the foundations shipping. Reality now: the **DB path is fully solved** (`resolveEnvConnection().db()` works for local + app-dev today, IAM-gated, guarded, audited), while the **API path requires building a whole admin surface** (list/create/delete endpoints + admin RBAC + Auth0 role wiring) that nothing else needs yet.

| | A. DB path (drizzle over the env connection) | B. Admin HTTP API |
|---|---|---|
| Works today, all envs | **Yes** (tunnel smoke-verified) | No — endpoints + RBAC don't exist |
| Respects invariants | Yes, if it mirrors the shared semantics (see D2 + the parity pin) | Yes |
| Trust model | Owner-privileged, IAM-gated — identical to `portalops db psql` (which can already write anything) | App-token-gated |
| Required by | — | the **future public/customer CLI** (customers never get DB creds) |

**Lean: A — the DB path is THIS CLI's data path, permanently, not "for v1".** The admin CLI is owner tooling with the same trust model as `portalops`; an HTTP admin surface adds no safety for the owner today. The admin API + RBAC is the **public customer CLI's structural requirement** and gets filed with that ticket — a scope boundary, not a deferral. CRUD sits behind a small internal `AdminStore` seam, so an API-backed implementation can slot in for the public CLI without touching commands.

### Decision 2 — How the CLI talks to the schema (the sharing problem)

**A. Import `apps/api` internals** (repositories/services) from the CLI. **B. A purpose-built data layer in the CLI** (own drizzle client over the resolved connection string). **C. Extract the schema/repository layer into a shared package.**

**Lean: B.** Importing app internals (A) inverts the package graph (`packages/*` depending on `apps/api`) and drags in the API's env-validation load-time side effects; extracting the repository layer (C) is a big refactor with one new consumer (`feedback_no_speculative_infra`). The CLI's queries are few (org/user/membership CRUD + tier update); it enforces the same invariants explicitly (soft-delete filters, audit-column stamping) and a **parity pin** guards drift (OQ3). **Exception:** org-reset and seeding *are* app business logic — see D4.

### Decision 3 — Command surface

```
portalai org list|get|create|update|delete     --env <env>   # delete = soft-delete
portalai org set-tier <orgId> <tierSlug>       --env <env>   # tier assignment (cache ≤60s to bite)
portalai org reset <orgId>                     --env <env>   # org-scoped app-data reset (absorbs npm run db:reset)
portalai user list|get [--org <orgId>]         --env <env>
portalai member add|remove <orgId> <userId>    --env <env>
portalai seed demo-org [--name …]              --env <env>   # net-new customer-org fixture (never prod)
```

**Lean: inherit every `portalops` convention** — required `--env`, `--json`, `--yes`, `--confirm-prod`, stderr banner, exit codes, `COMMANDS.md`. Guard classes: reads free; `create/update/set-tier/member add|remove` = mutation; **`org delete`, `org reset`, `seed demo-org` = destructive** (staging `--yes`; prod hard-blocked — prod org deletion is deliberately impossible from the CLI).

### Decision 4 — Reset & seeding: reuse app logic without importing the app

`ResetService.resetOrganization` and `SeedService` encode real business semantics; duplicating them in the CLI would drift.

**Lean: spawn the `apps/api` workspace scripts with `DATABASE_URL` injected from the env connection** — `portalai org reset <id>` runs `npm run db:reset -- <id>` (workspace `@portalai/api`) with the tunneled/local connection string in the child env; `seed demo-org` gets a small **new `db:seed:demo-org` script in `apps/api`** (the fixture logic lives beside `SeedService`, where it belongs). The CLI contributes env resolution, guards, audit, UX; the app owns its data semantics. No cross-package runtime import, no duplication.

### Decision 5 — Agent & programmatic operability (hard requirement, inherited)

Same contract as the siblings (non-interactive flags, `--json`, typed errors → exit codes, library-first, `COMMANDS.md`). Additionally: **audit attribution prefers the Auth0 device-flow `sub`** for the env when a session exists (cli-env `getToken` is live), falling back to the AWS identity — agent-driven org mutations attribute to the human who authorized.

## Tradeoff comparison

|  | D1 DB path | D2 own data layer | D3 surface | D4 spawn app scripts | D5 agent contract |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes (largely by reference to portalops) |
| New API/auth work | none | none | none | one new apps/api script | none |
| Public-CLI readiness | admin API filed with that ticket | `AdminStore` seam ready | verbs already public-shaped | — | same contract |

## Recommendation

1. **`@portalai/admin-cli`** package, bin **`portalai`** (the flagship name — the future public customer CLI extends this domain core), cloned from the `devops-cli` scaffold/conventions; infra-free (no AWS SDK deps — everything env-shaped comes from `cli-env`).
2. **DB data path** via `resolveEnvConnection` + a purpose-built drizzle layer behind an `AdminStore` seam; invariant/schema parity guarded by a pinning test.
3. **Command surface per D3** (org/user/member/tier/reset/seed) with guards + audit in the functions.
4. **Reset/seed reuse app services by spawning workspace scripts**; add `db:seed:demo-org` to `apps/api`.
5. **Docs as deliverables**: README (human, quickstarts incl. the absorbed `db:reset` habit) + `COMMANDS.md` (agent).
6. **The admin HTTP API + RBAC is out of scope for this ticket by design** — it's the future public customer CLI's requirement and is filed with it.

## Open questions

1. **`org delete` semantics** — **Lean: soft-delete only** (matching the repository layer); hard deletion remains a manual SQL act, deliberately outside the CLI.
2. **`org create` and the `ownerUserId` FK** — users originate in Auth0 (webhook sync); the CLI shouldn't mint users. **Lean: `org create` requires `--owner-email` resolving an existing user**; user creation is out of scope.
3. **Schema-drift protection for the CLI's own table defs** — **Lean: a test-only devDependency on `apps/api`'s schema files**, with a pinning test asserting the CLI's minimal table definitions match (runtime imports stay forbidden; test-only is the pragmatic exception). Confirm this exception.
4. **`seed demo-org` fixture content** — **Lean: minimal now** (org + owner membership + tier), extended when QA patterns emerge.

## Enterprise-scale considerations

- **Multi-tenancy / blast radius** — *engaged, the crux.* Every mutation takes an **explicit org id** (no "all orgs" default anywhere); cross-org listing is read-only + paginated; `org delete`/`org reset` are destructive-class (prod hard-blocked). Wrong-env is covered by the inherited required-`--env` + banner + `kind` guards.
- **Accuracy & auditability** — *engaged.* Every mutation audited with Auth0-`sub` attribution when a session exists; tier changes log old→new (never secrets).
- **Concurrency & correctness** — *engaged.* CLI writes race live app writes: mutations are single-row, id-scoped updates with soft-delete semantics pinned to the repository layer's; reset/seed run the app's own services (D4), inheriting their transactional behavior.
- **Contract stability** — *engaged.* The `AdminStore` seam is where an API-backed implementation lands for the public CLI; the command verbs are already the public-CLI shape.
- **Failure modes** — fail-closed inherited wholesale (typed errors, guards, required env, no defaults).
- **Scale / Data lifecycle** — *Lean:* `org list`/`user list` paginate (`--limit/--offset`, repository convention); no retention surface.

## What this doesn't decide

- **The admin HTTP API + RBAC** — the future public customer CLI's ticket (structurally required there; redundant for owner tooling).
- **Vendor coordination** (Auth0 directory ops, Stripe sync, Tavily) — follow-up tickets; Stripe needs #176 first.
- **User provisioning** — users originate in Auth0; the CLI reads/links, never creates.
- **Richer demo fixtures** — extend `db:seed:demo-org` as QA needs emerge.
- **Prod (`app.portalsai.io`) wiring** — gated on #83; the guards already treat prod as first-class.

## Next step

`docs/PORTAL_ADMIN_CLI.spec.md` — the `portalai` contract: the `AdminStore` seam + drizzle layer with the schema-parity pin, every command's signature/guard class/`--json` shape, the two `apps/api` touchpoints (`db:reset` invocation; the new `db:seed:demo-org` script), audit attribution, and the docs deliverables. Then `docs/PORTAL_ADMIN_CLI.plan.md` — likely **4 slices**: (1) scaffold + `AdminStore` + org/user reads (+ parity pin); (2) org/tier/member mutations with guards+audit; (3) reset + demo-org seed via the app scripts; (4) bin + docs + smoke.
