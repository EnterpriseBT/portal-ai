# Portal App-admin CLI — Spec

Pins the contract for `@portalai/admin-cli` (`portalai`): the `AdminStore` seam + purpose-built data layer with the schema-parity pin, the org/user/member/tier/reset/seed command surface, the three `apps/api` touchpoints (provisioning refactor + create-org/seed-org scripts), and the docs deliverables. Discovery: `docs/PORTAL_ADMIN_CLI.discovery.md` (reconciled + reviewed). Issue: [#190](https://github.com/EnterpriseBT/portal-ai/issues/190) (epic #191; foundations #194/#192 shipped).

## Key decisions (flag for review)

1. **DB data path, permanently** (confirmed): `resolveEnvConnection().db()` → the CLI's own drizzle layer behind `AdminStore`; the admin HTTP API + RBAC files with the future public customer CLI.
2. **Row construction via `@portalai/core` model factories** — `OrganizationModelFactory` / `OrganizationUserModelFactory` produce validated rows with correct ids + audit stamping; the CLI's drizzle handles I/O only. (Core is a package — importing it is the intended reuse; the *app* remains runtime-forbidden.)
3. **Schema-parity pin** (confirmed exception): a **test-only** relative import of `apps/api/src/db/schema/*.table.ts` (pure modules — no env side effects), asserting the CLI's minimal table defs match via `getTableConfig` (table name; column names, data types, notNull). Runtime `apps/api` imports remain forbidden.
4. **Create/reset/seed spawn workspace scripts** with `DATABASE_URL` injected from the env connection — the app owns its own provisioning/reset/fixture semantics; the CLI owns env resolution, guards, audit, UX. **`seed org`** (renamed from demo-org — it simply creates a fully-provisioned org on demand) takes a required `--name`, a **synthetic owner** (`auth0Id: "seed|<uuid>"`), and an optional **`--member-email`** adding a real user so the org is enterable from the app; the new **`member switch`** command bumps a membership's `lastLogin` — which is how the app picks your current org — making the CLI the org switcher the UI doesn't have.
5. **Two new exit codes** extend the sibling contract: `8` = `ADMIN_NOT_FOUND` (org/user/tier), `9` = `ADMIN_CONFLICT` (e.g. duplicate membership, org-name collision). 2–7 unchanged from `portalops`.
6. **Mutations against staging/production require an active device-flow session** (confirmed): the mutation/destructive guard path first calls cli-env `getToken(env)` — no session → `ENV_NOT_AUTHORIZED` pointing at `portalai login --env <env>`. `local` (kind development) is exempt. Audit `operator` is therefore **always the real Auth0 `sub`** where it matters (decoded from the cached token — attribution, not auth); local falls back to the OS username. The CLI ships `login`/`logout` commands wrapping cli-env's device flow. *No STS/AWS SDK anywhere.*
7. **`org create` reuses the app's full provisioning transaction** — a CLI-created org must be indistinguishable from a webhook-created one. `ApplicationService.setupOrganization` (`application.service.ts:44-183`) creates, transactionally: the org (tier `standard`), the owner membership, **system column definitions**, the **Sandbox connector instance**, the **default station** + `data_query` toolpack, the station link, and `defaultStationId`. The CLI invokes this via the D4 spawn pattern (a new `db:create-org` script); `setupOrganization` is refactored to accept an **existing** owner user (webhook path unchanged — it still creates the user first). `AdminStore` has **no** `createOrg` — a bare insert would make half-provisioned orgs.

## Scope

### In scope
- New package `packages/admin-cli` (`@portalai/admin-cli`, **bin `portalai`**): `login`/`logout`, `org` (list/get/create/update/delete/set-tier/reset), `user` (list/get), `member` (add/remove/switch), `seed org`; guards + audit; `--json`; docs (README + COMMANDS.md); scaffold cloned from `devops-cli`.
- `apps/api`: refactor `ApplicationService.setupOrganization` to take an existing-or-new owner; new scripts `src/db/create-org.ts` (`db:create-org`) and `src/db/seed-org.ts` (`db:seed:org`) — both thin wrappers over `setupOrganization`.
- Doc-sync: root README tree + CLAUDE.md monorepo row (+ copilot mirror).

### Out of scope
- The admin HTTP API + RBAC (public customer CLI's ticket). Vendor coordination (needs #176). User provisioning (Auth0-originated). Hard deletes. Prod env entries (#83).

## Surface

### `packages/admin-cli` package

`"name": "@portalai/admin-cli"`, `"type": "module"`, **`"bin": { "portalai": "./dist/bin.js" }`**, toolchain cloned from `devops-cli` (`test:integration: "true"`). Deps: `@portalai/cli-env` (workspace `*`), `@portalai/core` (workspace `*`), `commander` (^14), `drizzle-orm`, `postgres` (^3.4.8 — same driver family as the app), `zod`. DevDeps additionally allow the **test-only** parity import (no package dependency needed — relative path within the monorepo). **No AWS SDK anywhere.**

### `src/errors.ts`

```ts
export type AdminCliErrorCode = "ADMIN_NOT_FOUND" | "ADMIN_CONFLICT";
export class AdminCliError extends Error { readonly code: AdminCliErrorCode; }
export class AdminNotFoundError extends AdminCliError;   // "Organization abc123 not found" etc.
export class AdminConflictError extends AdminCliError;   // duplicate membership, name collision
```

Exit-code map (in `src/output.ts`, superset of the sibling contract): `…cli-env codes 3–7…, ADMIN_NOT_FOUND: 8, ADMIN_CONFLICT: 9`.

### `src/tables.ts` — minimal drizzle defs + the parity pin

CLI-owned `pgTable` definitions for exactly what it touches: `organizations` (all columns per `organizations.table.ts:9-24`), `users` (per `users.table.ts:10-17`), `organizationUsers` (per `organization-users.table.ts`), `tiers` (only `slug` + base columns needed for existence checks). FK `.references()` omitted (the DB enforces them; the CLI defs are for query building).

**Parity pin** (`src/__tests__/tables-parity.test.ts`): imports the API's real table modules via relative path (`../../../../apps/api/src/db/schema/….table.js` — pure modules: drizzle + core only) and asserts, via `getTableConfig` from `drizzle-orm/pg-core`, that for each CLI table: same table name; the CLI's columns each exist in the API's with matching `name`, `dataType`, `notNull`. (Subset match: the CLI may omit columns; it may never disagree on one.)

### `src/store.ts` — the `AdminStore` seam

```ts
export interface AdminStore {
  listOrgs(opts: { limit?: number; offset?: number; search?: string }): Promise<Organization[]>;   // deleted IS NULL; name ILIKE search; ordered created desc
  getOrg(id: string): Promise<Organization>;                                                        // not found/deleted → AdminNotFoundError
  updateOrg(id: string, patch: Partial<Pick<Organization, "name" | "timezone" | "defaultStationId">>, actor: string): Promise<Organization>;  // stamps updated/updatedBy
  setTier(id: string, tierSlug: string, actor: string): Promise<{ id: string; tier: string; previousTier: string }>;
      // tier slug must exist live in `tiers` → else AdminNotFoundError("tier …")
  softDeleteOrg(id: string, actor: string): Promise<void>;                                          // stamps deleted/deletedBy; idempotent-safe (already deleted → AdminNotFoundError)
  listUsers(opts: { orgId?: string; limit?: number; offset?: number }): Promise<User[]>;            // orgId filters via live membership join
  getUserByEmail(email: string): Promise<User>;                                                     // live rows; not found → AdminNotFoundError
  addMember(orgId: string, userId: string, actor: string): Promise<void>;
      // live membership exists → AdminConflictError; soft-deleted membership → revive (clear deleted/deletedBy, stamp updated)
  removeMember(orgId: string, userId: string, actor: string): Promise<void>;                        // soft-delete the join row; absent → AdminNotFoundError
  switchMember(orgId: string, userId: string, actor: string): Promise<void>;                        // bump the live membership's lastLogin to now (the app's current-org selector); absent → AdminNotFoundError
  close(): Promise<void>;
}
export function createDbAdminStore(connectionString: string): AdminStore;   // postgres-js + drizzle over src/tables.ts
```

Every read filters `deleted IS NULL`; every mutation is a **single-row, id-scoped** statement stamping the audit columns — semantics matching `base.repository.ts`, guarded by the parity pin + store tests.

### `src/commands/*.ts` — command functions (library-first; guards + audit inside)

| Command | Guard class | Behavior / `--json` shape |
|---|---|---|
| `login` / `logout` | read (no guard) | cli-env device flow for the env; `login` prints the activation URL + code; `logout` clears the session |
| `org list` | read | `{ orgs: Organization[] }`; `--limit/--offset/--search` |
| `org get <id>` | read | `{ org }` |
| `org create --name --owner-email` | mutation | spawns `npm run --workspace @portalai/api db:create-org -- --owner-email … --name …` (full app provisioning: org+membership+column defs+sandbox+station); `{ organizationId, stationId }` |
| `org update <id> [--name] [--timezone] [--default-station-id]` | mutation | `{ org }` |
| `org set-tier <id> <slug>` | mutation | `{ id, tier, previousTier }` — audit logs old→new |
| `org delete <id>` | **destructive** | soft-delete; `{ id, deleted: true }` |
| `org reset <id>` | **destructive** | spawns `npm run --workspace @portalai/api db:reset -- <id>` with `DATABASE_URL` from the env connection (injectable spawner); `{ id, reset: true }` |
| `user list [--org <id>]` | read | `{ users }` |
| `user get <email>` | read | `{ user }` |
| `member add <orgId> <email>` | mutation | resolves the user by email; `{ orgId, userId, added: true }` |
| `member remove <orgId> <email>` | mutation | `{ orgId, userId, removed: true }` |
| `member switch <orgId> <email>` | mutation | bumps membership `lastLogin` → the app now lands that user in this org; `{ orgId, userId, switched: true }` |
| `seed org --name <name> [--member-email <email>]` | **destructive** (never prod — synthetic data; prod orgs go through `org create` with a real owner) | spawns `npm run --workspace @portalai/api db:seed:org -- --name <name> [--member-email …]`; `{ organizationId, name }` |

Every command: `getEnvironment` → banner (stderr) → guard (`assertOperationAllowed`; destructive per the table) → **session requirement** (staging/prod mutations: `getToken(env)` must succeed, else `ENV_NOT_AUTHORIZED` naming `portalai login`; local exempt) → `resolveEnvConnection().db()` → store → `recordAudit({ env, operator, command, args })` on mutations (operator = Auth0 `sub` from the session; local fallback OS username; args carry ids/slugs, never row contents) → `dispose()`.

### `src/bin.ts` — `portalai`

Commander wiring identical in shape to `portalops`' `bin.ts` (required `--env`, `--json`, `--yes`, `--confirm-prod`, exitOverride → `runCli(argv): Promise<number>`, stderr banner / stdout payload, `--json` error envelope) with the extended exit-code map.

### `apps/api` — the provisioning refactor + two scripts

**Refactor:** `ApplicationService.setupOrganization(owner: User)` splits so the provisioning body accepts an already-persisted user:

```ts
static async setupOrganization(owner: User)                       // unchanged signature: creates the user, then provisions (webhook path)
static async provisionOrganizationFor(userId: string, opts?: { name?: string }) // the transaction body: org + membership + seedSystemColumnDefinitions + sandbox instance + default station/toolpack/link + defaultStationId
```

**Scripts** (both `dotenv -e .env -- tsx …` as fallback; the CLI passes `DATABASE_URL` explicitly):

```jsonc
"db:create-org":    "dotenv -e .env -- tsx src/db/create-org.ts"      // --owner-email <email> --name <name>; owner must exist (else exit 1, "user not found"); prints { organizationId, stationId } JSON
"db:seed:org":    "dotenv -e .env -- tsx src/db/seed-org.ts"          // --name <required> [--member-email <email>]; idempotent by live org name; creates a synthetic owner (auth0Id "seed|<uuid>", email "seed+<slug>@portalsai.io"), provisions, and — when --member-email resolves an existing user — adds that user as a member; prints { organizationId, ownerUserId, memberUserId? } JSON
```

Both ride `provisionOrganizationFor` — a CLI-created or seeded org is provisioned **identically** to a webhook org.

### Docs deliverables

- `packages/admin-cli/README.md` — running it (same npx pattern), the command guide, guard rules, quickstarts (incl. "you used to run `npm run db:reset`" → `portalai org reset <id> --env local`), troubleshooting with exit codes 2–9.
- `packages/admin-cli/COMMANDS.md` — agent reference (synopsis/flags/guard class/`--json` shape/exit codes per command), matching `--help`.
- Root README tree + operator quickstart mention; `CLAUDE.md` monorepo row + copilot mirror. (`db:reset` npm script **stays** — the app's own entrypoint the CLI spawns.)

## Migration / Seed

**None.** No schema change; `db:seed:org` is a new fixture script, not a migration.

## TDD test plan

```bash
cd packages/admin-cli && npm run test:unit
cd apps/api && npm run test:unit           # provisioning refactor + seed-org unit (mocked repos)
```

### Layer 1 — tables parity (`packages/admin-cli/src/__tests__/tables-parity.test.ts`)
Org/users/organizationUsers/tiers defs each subset-match the API's via `getTableConfig` (name, dataType, notNull); a deliberate-mismatch red-first check during development. ≈ 4 cases.

### Layer 2 — store (`…/store.test.ts`, drizzle instance injected/mocked)
listOrgs filters deleted + search + pagination; getOrg not-found typed (8); updateOrg stamps updated/updatedBy; setTier validates tier existence, returns previousTier; softDeleteOrg stamps deleted; addMember conflict on live row / revives soft-deleted; removeMember soft-deletes; getUserByEmail live-only. ≈ 10 cases.

### Layer 3 — commands (`…/commands.test.ts`, store + cli-env mocked via the shared helper pattern)
Guard classes per the table (destructive for delete/reset/seed — prod blocked); **staging mutations without a device-flow session → ENV_NOT_AUTHORIZED naming login; local mutations exempt**; audit operator = the session `sub`; `org create` resolves owner or 8; `member add/remove/switch` resolve email (switch bumps lastLogin); create/reset/seed spawn contracts (workspace argv + `DATABASE_URL` injected, guard **before** spawn); `dispose()` always called. ≈ 11 cases.

### Layer 4 — bin (`…/bin.test.ts`)
Required `--env`; exit 8 for a not-found (json envelope `ADMIN_NOT_FOUND`); banner/stdout separation. ≈ 3 cases.

### Layer 5 — apps/api provisioning refactor + scripts (`apps/api/src/__tests__/services/application.service.test.ts` extend + `…/db/create-org.test.ts`)
`provisionOrganizationFor` provisions the full set (org/membership/column defs/sandbox/station/link/defaultStationId — mocked repos assert each) for an existing user; `setupOrganization` still creates the user first then delegates (webhook parity); create-org script rejects a missing owner email; seed-org is idempotent by live org name, creates the synthetic owner, and adds the --member-email user when given. ≈ 7 cases.

**Totals ≈ 33 cases.** No migration test. Live paths (tunnel CRUD against app-dev, local reset round-trip, seed org + member switch flow) via the manual smoke doc.

## Acceptance criteria
- [ ] Full org/user/member/tier lifecycle works against **local and app-dev** from the terminal (smoke): create → list/get → update → set-tier (visible in the app ≤60s) → member add/remove → delete — and a CLI-created org is **fully provisioned** (column defs, sandbox connector, default station) exactly like a webhook-created one (verified by logging into it in the app).
- [ ] `org reset <id>` performs the app's org-scoped reset against the selected env; `seed org --name X --member-email <you>` + `member switch` lands your real Google login inside the new org in the app; both seed/reset refuse production unconditionally.
- [ ] A staging mutation without `portalai login` exits 4 naming the login command; after login, the audit line carries your Auth0 `sub`.
- [ ] Destructive/mutation guards + audit lines (with Auth0-`sub` attribution when logged in) on every mutation; ids only, never row contents.
- [ ] Schema drift between the CLI's table defs and `apps/api`'s fails `packages/admin-cli` unit tests.
- [ ] Exit codes 2–9 behave per COMMANDS.md; `--json` everywhere; no TTY coupling.
- [ ] `dist/` of the CLI contains no `apps/api` code (runtime independence); no AWS SDK in the package.
- [ ] README/COMMANDS.md shipped; root README + CLAUDE.md rows updated.

## Risks & rollback
- **Direct-DB writes bypass API validation** — mitigated by core-factory row construction (same Zod), repository-matching soft-delete/audit semantics (store tests), and the parity pin; residual risk accepted for owner tooling (identical to `portalops db psql`).
- **Parity pin's relative import** could break if the API schema moves — it fails loudly (test error), which is the pin working.
- **Spawned scripts depend on the workspace layout** (`npm run --workspace @portalai/api`) — fails typed if run outside the repo; documented (the CLI is repo-tooling, not globally distributed — that's the public CLI's job later).
- Fail-closed posture inherited wholesale. Rollback: additive package + one new app script; revert cleanly.

## Files touched
- New: `packages/admin-cli/*` (scaffold, `src/{errors,output,tables,store}.ts`, `src/commands/{org,user,member,seed}.ts`, `src/bin.ts`, `src/index.ts`, tests, `README.md`, `COMMANDS.md`).
- Edit: `apps/api/src/services/application.service.ts` (the `provisionOrganizationFor` split); New: `apps/api/src/db/create-org.ts`, `apps/api/src/db/seed-org.ts`; Edit: `apps/api/package.json` (+`db:create-org`, `db:seed:org`).
- Edit (doc-sync): `README.md` (tree + mention), `CLAUDE.md` (+ copilot mirror).
- New: `docs/PORTAL_ADMIN_CLI.smoke.md`.

## Next step
`docs/PORTAL_ADMIN_CLI.plan.md` — **4 slices**: (1) scaffold + errors/output + tables + parity pin + store reads; (2) store mutations (update/set-tier/delete/membership) + org/user/member commands with guards+audit; (3) the apps/api provisioning refactor + create-org/seed-org/reset scripts + their spawn commands + login/logout + member switch; (4) bin + docs + smoke + doc-sync. Then implement, smoke together, and close the epic.
