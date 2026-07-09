# Portal App-admin CLI — Discovery

**Issue:** [EnterpriseBT/portal-ai#190](https://github.com/EnterpriseBT/portal-ai/issues/190) · epic **Portal CLIs** (#191) · sibling **DevOps CLI** (#192)

**Why this exists.** The app owner has no first-class, safe way to inspect or fix a customer organization's **application data** in a running environment — today it's ad-hoc `psql` or one-off scripts. As we approach billing (#176) and production (#83), we need a repeatable admin surface to authenticate into any environment and manage customer app-data (orgs, tiers, users), coordinate vendor customer-records (Auth0/Stripe/Tavily), and seed/mock for dev/QA. This is the **customer-app-data control plane** — a TypeScript monorepo package, deliberately **infra-free** (secrets/tunnels/ECS live in the sibling DevOps CLI #192) so its domain core stays reusable by a future customer-facing developer CLI.

## The current shape

### Package wiring & the shared-core precedent

Turborepo + npm workspaces (`package.json:29-31` globs `packages/*`); a new `packages/admin-cli` slots in as `@portalai/admin-cli`, `tsc` build to `dist/`, `bin` entry (like `packages/core`). `packages/core` already exposes `@portalai/core/models`, `/contracts`, `/constants` (`packages/core/package.json:14-49`), consumed by the API (`organization.router.ts:12`). The CLI imports the same models/contracts for typed org/user/tier shapes — the seam a future public CLI would also extract.

### App auth (this CLI's central question)

`/api/*` is guarded by Auth0 `express-oauth2-jwt-bearer` (`auth.middleware.ts:12-16`: audience/issuer/JWKS, RS256) → `req.auth.payload.sub`. **No machine-to-machine path exists**; `auth0.service.ts:42-55` only exchanges a user token for a profile. So an *API-path* admin CLI needs either an admin-scoped user token or a new M2M client + `/api/admin/*` routes.

### Data-access seams for org CRUD

- **HTTP API** — `organization.router.ts` exposes only `GET current` (`:157`), `GET usage` (`:265`), `PATCH {id}` (`:92`). **No list/create/delete** — an admin surface would have to be built.
- **Repository** — `organizations.repository.ts:13-34` (`findByName` + inherited `findById/create/update/softDelete/findMany` from `base.repository.ts:48-64`, with soft-delete + `DbClient` transactions). The API calls these directly.
- **Direct drizzle/psql** — `organizations.table.ts:9-24`; rawest, bypasses invariants.

### Customer-org data model

`organizations.table.ts:9-24` — `name`, `timezone`, `ownerUserId`→users, `tier`→`tiers.slug` (default `standard`), `defaultStationId`. `users.table.ts:10-17` — `auth0Id`, `email`, … ; an `organization-users` membership join. `tiers.table.ts:15-61` + `tier.service.ts:27-50` (tier assignment per org).

### Seeding

`db:seed` → `SeedService.seed()` (`seed.service.ts:1-100`) seeds **system definitions only** (tiers, column defs, connector defs) — **no mock orgs** today. The CLI's dev/QA seeding extends this to customer-org fixtures.

### Environment access — the shared layer (#194)

Selecting/authorizing/connecting to a *deployed* environment is **#194** (the foundational driver of the epic), which orchestrates the DevOps CLI's tunnel + secret primitives (#192). This CLI *consumes* #194's `resolveEnvConnection(--env)` to obtain either an **API base URL + admin token** (API path) or a **`DATABASE_URL`** (v1 DB-fallback). It authorizes to **the app**, not to AWS. **v1 of this CLI targets `local`** (no #194 dependency); its deployed capability lands once #194 does.

## The design space

*(Topology is settled by the epic: two TS CLIs, this one is app-data-only, no shared `cli-core` yet. The decisions below are app-admin-specific.)*

### Decision 1 — Data path (confirmed: API-target, DB-fallback for v1)

Target the **HTTP admin API** (app auth; respects invariants; the exact surface a public CLI reuses), but allow **direct DB (repository layer) for v1** — local and early deployed use — so we don't block on building admin endpoints. Migrate to API-only as the admin surface grows.

| | API (target) | DB / repository (v1 fallback) |
|---|---|---|
| Respects invariants | Yes | Yes (soft-delete/FK/tier via base repo) |
| Needs new code | admin endpoints + admin auth | none |
| Public-CLI-reusable | **Yes** | No |
| Holds infra/DB creds | No | Yes (a small, temporary entanglement) |

**Lean: as confirmed** — DB-fallback unblocks v1; API is the end state. Keep CRUD behind a narrow internal interface so swapping the fallback for the API client later is a one-adapter change.

### Decision 2 — App auth mechanism (the open one)

**A. Admin-scoped Auth0 user token** — owner logs in via an OAuth device/browser flow; the CLI calls `/api/admin/*` with the bearer. **B. Auth0 M2M client** — a service token for automation; needs a new Auth0 app + admin route validation. **C. v1 DB-fallback sidesteps app auth entirely** — the owner reaches the DB (local `.env`, or the DevOps CLI's connectivity for deployed) with no app token.

**Lean: C for v1, A as the API-path target.** v1 rides the DB-fallback and needs no app-auth work; when the admin API is built, use an admin-scoped **user** token (A) — the owner is a real principal and it reuses the existing JWT check. Reserve M2M (B) for unattended automation if that need appears. (The future *public* CLI is per-customer-user tokens — A-shaped — reinforcing A over B as the primary.)

### Decision 3 — CRUD entity scope for v1

**Lean: organizations + tier assignment + org-users/membership.** These are the "manage a customer org" essentials. Connectors, entity records, stations come later — they're higher-cardinality and lower-frequency for admin ops.

### Decision 4 — Seeding / mocking

**Lean: reuse `SeedService` for system defs and add customer-org fixtures** (a demo org + owner user + tier) behind an explicit, **prod-guarded** `seed`/`mock` command. Idempotent.

## Tradeoff comparison

|  | D1 API-target/DB-fallback | D2 admin user token (A), DB-fallback v1 (C) | D3 orgs+tier+users | D4 SeedService + org fixtures |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| Blocks v1 on new API/auth | No | No (v1 = DB path) | No | No |
| Public-CLI-ready | via the API target | via user-token path | — | — |

## Recommendation

1. **`@portalai/admin-cli`** TypeScript package, infra-free, importing `@portalai/core` models/contracts.
2. **CRUD behind a narrow interface**: DB/repository adapter for v1, HTTP-admin-API adapter as the target — swappable without touching commands.
3. **Auth:** v1 rides the DB-fallback (no app token); the API path uses an admin-scoped Auth0 **user** token.
4. **v1 entity scope:** organizations + tier assignment + org-users.
5. **Seeding:** reuse `SeedService`, add prod-guarded customer-org fixtures.
6. **Vendor coordination (Auth0/Stripe/Tavily) is a follow-up**, not v1 (Stripe needs #176).

## Open questions

1. **Admin API + auth shape** — when we move off the DB-fallback, is it an admin-scoped user token (A) or M2M (B)? **Lean: user token (A)**; defer the build until the fallback's limits bite.
2. **Which envs in v1?** Prod (`app.portalsai.io`) is gated on #83. **Lean: local + app-dev in v1**, prod when #83 lands (and via the DevOps CLI's connectivity).
3. **Does v1 reach a *deployed* DB, or local only?** Reaching app-dev's DB needs the DevOps CLI's tunnel (#192) — a cross-CLI dependency. **Lean: local-first in v1; app-dev DB access lands once #192's tunnel is callable** (or app-admin waits for the API path there).
4. **Interface seam for the CRUD adapter** — a hand-rolled port or a generated client from the OpenAPI spec (`generate-swagger.ts` exists)? **Lean: hand-rolled thin adapter for v1**; revisit a generated client with the public CLI.

## Enterprise-scale considerations

- **Accuracy & auditability** — *engaged.* Every mutating command writes an audit record (operator/env/entity/op/time). Non-negotiable for a tool editing real customer orgs; seeds the #179 audit direction.
- **Failure modes** — *fail-closed on env ambiguity.* Active env echoed on every command; no implicit prod default; destructive/bulk ops require typed confirmation + `--dry-run`; prod extra barrier; seeding/teardown prod-guarded.
- **Concurrency & correctness** — *engaged.* CLI writes race live app writes → go through the repository layer / API (transactions, soft-delete, FK/tier invariants), never raw SQL. Seeding idempotent.
- **Multi-tenancy** — *engaged.* Spans orgs; require an explicit org id + confirmation for cross-org/bulk ops; never a "select all orgs" default.
- **Contract stability** — *engaged.* Infra-free package + a CRUD adapter seam (DB→API) means the domain core survives the fallback→API transition and is cleanly extractable by a public CLI.
- **Scale & unbounded growth** — *Lean:* list/export paginate (base repo already does); not a hot path.
- **Data lifecycle** — `N/A because` this manages entities, not metered windows.

## What this doesn't decide

- **Deployed-environment access & connectivity** — **#194** (the shared env layer) + the DevOps CLI (#192)'s tunnel/secret primitives. This CLI consumes `resolveEnvConnection`, it doesn't own env auth or infra.
- **Vendor management implementation** (Auth0/Stripe/Tavily subcommands) — follow-up; #176 defines the Stripe surface.
- **The public customer-facing CLI** — anticipated, not built; no speculative shared-core split.
- **Prod (`app.portalsai.io`) wiring** — gated on #83.

## Next step

Write `docs/PORTAL_ADMIN_CLI.spec.md` (v1 contract: the `@portalai/admin-cli` package shape, the CRUD adapter interface with a repository-backed v1 implementation, the org/tier/org-user commands, and the audit + confirmation/dry-run guardrails) and `docs/PORTAL_ADMIN_CLI.plan.md`. Plan slices: (1) package scaffold + env/profile selection + local connectivity; (2) command framework + audit/confirmation/dry-run guardrails; (3) org + tier + org-user CRUD via the repository adapter; (4) prod-guarded seeding/mocking reusing `SeedService`. The API-path adapter, vendor subcommands, and deployed-env access follow as later slices/tickets.
