# Portals AI — Copilot Instructions

## Project

Turborepo monorepo: React 19 frontend (`apps/web/`), Astro public marketing site (`apps/site/`), Express API (`apps/api/`), shared component/model library (`packages/core/`), CLI environment-access layer (`packages/cli-env/`, Node-only), `portalops` operator CLI (`packages/devops-cli/`), `portalai` app-data CLI (`packages/admin-cli/`).

## File Naming

- Components: `*.component.tsx` — Views: `*.view.tsx` — Layouts: `*.layout.tsx`
- Stories: `*.stories.tsx` — Tests: `*.test.ts(x)` — Utils: `*.util.ts`
- Models: `*.model.ts` — Routers: `*.router.ts` — Middleware: `*.middleware.ts`
- Tables: `*.table.ts` — Repositories: `*.repository.ts`

## Naming

- Components/Types/Interfaces: `PascalCase`
- Functions/Hooks/Variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- API error codes: `<DOMAIN>_<FAILURE>` (e.g. `USER_NOT_FOUND`)

## Import Order

1. React / React libraries
2. Third-party (`@mui`, `@tanstack`, `zod`, etc.)
3. Monorepo (`@portalai/core`)
4. Local (relative imports)
5. Types, styles, assets

## Component Pattern

Props interface → `React.FC` component → hooks → handlers → JSX return.

User feedback (apps/web): failures **inside a dialog** render `<FormAlert serverError={…} />` and keep the dialog open; failures **anywhere else** raise `useToast().error(…)`. Never a local `Snackbar` or per-component toast state — `UpdateBanner` and `ConnectorInstanceSyncFeedback` are recorded exceptions (polling and progress are not toast surfaces), not precedents.

Action affordances (apps/web, #688): decide every action **per object** from the row's server-computed `capabilities` (`{read, write, delete}`, plus `share` on station/pin/curated view) via `decideActionGate` / `useActionGate`, and render the `ActionGate` through `GatedButton`, `GatedIconButton` or a menu/suite item's `gate`. Precedence is permission → `hide` (or `disable` with the grant hint for a plausible primary action, naming the access needed, never a role), tier → `upsell`, state → `disable` naming it. A create reads `canOnResource(type, "create")` (#708: computed per type with the create route's own check); never gate on `canOnResource(…, "write" | "delete")`, which are any-grant signals the guard rejects. An entity-wide action whose route needs an unconditional class grant reads a derived capability (`can("entity_record.revalidate")`). A read-only caller gets a read-only view. A raw `disabled={!canX}` on a `Button`/`IconButton` is a bug (`action-gate.guard.test.ts`; its `KNOWN_VIOLATIONS` is empty and only shrinks). Mutations on an existing per-object resource declare `onPermissionDenied: { invalidate }` on `useAuthMutation` so a 403, or a 404 for an object gone for the caller (#713), refetches the capabilities (`permission-denied-invalidation.guard.test.ts` enforces it); feedback stays with the caller, shown through `serverErrorMessage` in a toast or `FormAlert` alike (#711). A job-locked action is a `disable` gate whose reason points at the running job.

Dialog forms (apps/web): actions are `type="button"`, so **Enter must still submit** — `Modal` renders a hidden `FormDefaultButton` (`@portalai/core/ui`) when its paper is a form, and every form `Modal` passes `submitDisabled` (the visible submit's `disabled` expression) so Enter can't submit while the button can't — guarded by `dialog-enter-submit.guard.test.ts`. Duplicate submits (double-click, double Enter, click then Enter) are stopped at the request layer, not in the dialog: `useAuthMutation` sends one request per method+URL+body while one is in flight (`dedupeInFlight: false` opts out), and a multi-request workflow action wraps itself in `useSingleFlight` (#751). A raw `Dialog` + `<form>` renders `<FormDefaultButton disabled={…} />` by hand. Test Enter with a real key press (`user.type(field, "x{Enter}")`), never `fireEvent.submit`.

## API Pattern

- Services: classes with static methods (not loose functions)
- Errors: `ApiError` class + `next(error)` — never `res.status().json()` directly; a 500 answers `Internal server error` with its code (the original is only logged, #687), so user-facing copy belongs in a 4xx or an authored 502/503
- Authorization (#685, #692): every route, reads included, authorizes server-side and is classified in `apps/api/src/__tests__/config/route-authorization.map.ts` (CI guard). Resolve the caller with `getApplicationMetadata` (never an org/user id from the body); load the object **org-scoped** first, on reads as well as writes (the permission engine doesn't see orgs; lists add `visibilityPredicate`); then `resource.<verb>` on `{type, id, createdBy}`; creates check the parent's read plus owned or class create; unreadable == 404, forbidden == 403. A by-id write/delete/share on a loaded row goes through `ObjectAccessService.loadForVerb` (#713), so the read check always precedes the verb check.
- Request DB work is cancellable (#698): the one 10-connection pool is shared with in-process workers. A request's queries are cancelled only before it has started DB work (client disconnect, or a first query waiting > 30s → `503 DB_ADMISSION_TIMEOUT`, no write applied). Read-only routes safe to cut mid-statement opt into `setDbCancelPolicy("always")` (map tiles). Expensive per-request DB work goes behind an `AdmissionGate` with a typed `503` + `Retry-After` on overload (the tile gate's `MAP_TILE_BUSY` is the reference). Map tiles have their own per-user rate-limit bucket (#705, `AUTH_TILE_RATE_LIMIT_PER_MIN`) mounted ahead of the API limiter, refusing with `429 MAP_TILE_RATE_LIMITED` (logged at warn). Put a backoff hint in `details.retryAfterSeconds`; `HttpService.error` sets `Retry-After` from it.
- Error codes: `ApiCode` enum in `src/constants/api-codes.constants.ts`
- Request validation (#745): `safeParse` the body or query against its core contract; a failure answers `invalidPayload(code, label, parsed.error)` → `400 <DOMAIN>_INVALID_PAYLOAD` (body) / `<DOMAIN>_INVALID_QUERY` (query) naming the first failing field, the first 20 issues in `details.issues` and the total in `details.issueCount` (capped so the response can't scale with the body). Query rules (allowed `sortBy`, required ids) live in the schema. Request-body schemas are `.strict()` (an unknown key is a 400, not silently dropped; `.strict()` goes before any `.refine`); core's `strict-request-bodies.test.ts` sweeps every exported body schema, with recorded `LOOSE` exceptions. A route-specific check that must outrank the schema runs before the parse. `invalid-request-code.guard.test.ts` fails CI on a hand-built 400 in an `if (!x.success)` branch or carrying `issues`. Don't copy the list routes' `.parse(req.query)` in try/catch: it answers a bad query with a 500 (#756).
- Permission refusals (#711): throw `permissionDenied(action, object)` → `403 PERMISSION_DENIED`, a message naming the permission ("You don't have permission to manage billing."), never a role. Hints, help, OpenAPI docs and the agent prompt likewise say what access is needed, not who by role; only a rule about roles (`MEMBER_ROLE_ASSIGNMENT_RESTRICTED`) names them. `permission-copy.guard.test.ts` enforces it.
- Validation: middleware with typed `Request` interfaces
- Logging: Pino logger at route, service, and DB layers

## Database (Dual-Schema)

Zod models in `packages/core/src/models/` + Drizzle tables in `apps/api/src/db/schema/`. Both must stay in sync — compile-time `IsAssignable` type checks in `type-checks.ts` enforce this.

New table workflow:
1. Zod model extending `CoreObjectSchema`
2. Drizzle table using `baseColumns`
3. `createSelectSchema`/`createInsertSchema` in `zod.ts`
4. Bidirectional `IsAssignable` checks in `type-checks.ts`
5. `npm run db:generate -- --name <descriptive-name> && npm run db:migrate`

## Repositories

Extend `Repository<TTable, TSelect, TInsert>`. Base provides: `findById`, `findMany`, `count`, `create`, `createMany`, `update`, `updateWhere`, `updateMany`, `softDelete`, `hardDelete`, and more. Soft-delete aware — skips rows where `deleted IS NOT NULL`.

## Paginated lists at scale (#433)

`created` is every list's default `sortBy`. A table that can grow needs `(<scope>, created, id) WHERE deleted IS NULL` — scope first, then the sort key, then `id`. Every paginated `ORDER BY` ends in a unique tiebreaker: ties otherwise come back in an undefined order, and paginating over that **repeats and skips rows**. Emit `NULLS LAST` only for nullable sort columns (a btree cannot serve `DESC NULLS LAST`). Indexing does not fix deep `OFFSET` — the planner abandons the index; a big list pages by keyset cursor (`usePagination`'s `mode: "keyset"`), while `offset` stays valid for small ones.

## Soft-delete retention (#442)

Tombstones count toward `reltuples`, so they raise the table's own autoanalyze threshold and leave large writes running on stale statistics. A table that soft-deletes at volume needs (a) a purge — a repeatable job on the `maintenance` queue, batch-drain loop, delete by `IN (<subquery>)` so ids stay server-side; and (b) an index on `deleted` **partial on `deleted IS NOT NULL`**, since every other index excludes exactly the rows a purge reads. Without it the drain gets slower as it runs (measured 1,664 ms → 0.089 ms on the tail batch). Classify tombstones from data you already have — a `deleted_reason` column cannot be backfilled; #442 splits on whether the row's *parent* is also deleted. Reference: `entity-record-retention-purge.processor.ts`.

## Async job state (#441)

Terminal status reflects whether the **work** succeeded. A failed attempt is **not** terminal while BullMQ holds retry budget — the worker writes the row then rethrows, so an unconditional `failed` releases the entity lock on a job that is about to write again (`statusForFailedAttempt` in `jobs.worker.ts`; `pending` while `attemptsMade + 1 < opts.attempts`). `UnrecoverableError` is exempt — stall exhaustion voids the budget rather than consuming an attempt. A sync whose records landed but whose best-effort mirror cascade failed reports `completed` with `mirrorDegraded: true` on the result, not `failed`. Guard best-effort side tasks in the repository, not per-caller, and surface the degradation on a rendered field. Clear a stale error with an explicit `null` (Drizzle drops `undefined` from a `SET`). `worker.on("failed")` records deaths that skip the in-band catch **only when a live worker receives a failed event** — a SIGKILLed process cannot run its own handler, and BullMQ re-delivers a first stall without emitting one. That re-delivery is caught at the other end (#464): the resuming execution reads its row before the opening `active` transition and, finding it still `active`, increments a fail-open `lost_executions` column — `attempts` stays the BullMQ attempt count (executions are not overloaded onto it), and `JobDetail` shows `lost_executions` only when nonzero. The `failed` handler must also be idempotent, because it fires for handled failures too.

## Reaping by watermark (#460)

The job-level entity lock keys on the job *row*, so it does not see a BullMQ **stall re-delivery** — a second pass of the *same* job, with `attemptsMade` unchanged. Two passes then reap by their own watermarks and the later deletes the earlier's in-flight writes (34,000 records lost, job reported `completed`). Any watermark reaper must take `SyncLockService.withInstanceLock(connectorInstanceId, …)` first — a session-scoped Postgres advisory lock, not a TTL lease: BullMQ re-delivered *because it guessed wrong* about liveness, and a lease guesses the same way. A pass that cannot acquire does no work and reports `superseded`, never `failed`. No reap predicate is an alternative — "rows this pass did not touch" is correct from each pass's own view.

## Domain Models (packages/core)

Layered: Zod schema (`CoreObjectSchema.extend`) → model class (`BaseModelClass<T>`) → factory (`ModelFactory<T, M>`). Reference: `user.model.ts`.

## Auth

- Frontend: Auth0 React SDK, `useAuthFetch()` hook for authenticated calls
- Backend: Auth0 JWT middleware on `/api/*` routes, `Authorization: Bearer <token>`
- Protected routes: nest under `_authorized` layout in TanStack Router

## Routing (apps/web)

TanStack Router, file-based in `src/routes/`. Route tree auto-generates. Use `createFileRoute`.

**Addressable sections (#365).** A view linked to from elsewhere makes its sections addressable via `?tab=` / `?category=` / `#<surface>-entry-<slug>`, following Help (`utils/routes.util.ts`): one sanitizer (`normalizeHelpSearch`) shared by the route's `validateSearch` and the view; fail open on anything unrecognized; read `useRouterState({select: s => s.location.search})`, not `useSearch` (which needs a route match); `to` is a string literal, not the `ApplicationRoute` enum, wherever typed `search` is passed, with `MuiLink component="span"` inside a router `Link`; destinations push, filters replace; anchor slugs come from `contentEntrySlug` in `@portalai/core/content`; anchor-reachable accordions are controlled, never `defaultExpanded`. Settings (#284) is the older read-once shape and stays that way. User-typed search text never enters the URL.

## Themes

Three MUI themes: Brand (default), Light, Dark. Persisted in localStorage via `@portalai/core`.


## Issue → PR workflow (lifecycle)

One feature = one branch = one PR. Artifacts land as commits/gates on that branch: ticket (PRD for features / repro + impact for bugs, Issue Type set, sizing recorded), discovery, spec + plan, implementation (one commit per TDD slice), then the **review chain** — `/code-review` and `/security-review` (Claude Code built-ins; findings via native output, confirmed on the PR) → a **smoke checklist** (`docs/<SLUG>.smoke.md`, acceptance) → an **adversarial checklist** (`docs/<SLUG>.adversarial.md`, edge-case / misuse probes). **Merge requires green CI and human confirmation of every required phase — code-review, security, smoke, and adversarial** (a five-condition PR `## Merge gate` checklist); `security` is required whenever the change touches auth, data, multi-tenancy, secrets, or external egress, and the chain scales down for chores/bugs/condensed per the coverage matrix. `/smoke` and `/adversarial-review` scaffold `.md` checklists that `/smoke-walk` walks in a real browser (Playwright MCP against the dev stack, reusing the `@portalai/e2e` auth fixture + seeded org), producing a per-step evidence report the human reviews and accepts; manual-only steps (third-party redirects, payments, visual judgment) stay a human walk. The agent produces evidence but never checks a box or merges. Each phase has a skill: `/ticket` → `/discovery` → `/spec` → `/plan` → `/code-review` → `/security-review` → `/smoke` → `/adversarial-review` (`/smoke-walk` walks both smoke and adversarial checklists), plus `/epic` for multi-ticket parents. Small tickets take the **condensed path**: `/discovery <N> condensed` writes one combined `docs/<SLUG>.condensed.md` instead of the separate docs. **Phase docs are ephemeral (#419):** the five suffixes (`.discovery`/`.spec`/`.plan`/`.smoke`/`.condensed`) mark a per-ticket working artifact, an unsuffixed doc is a durable reference, and starting a **feature** ticket sweeps `docs/` of leftover phase docs (bugfixes don't sweep). Git history is the archive, so a stale `docs/` citation in a source comment is acceptable and `lint:doc-pointers` gates the durable set only. **Epics**: `main` auto-deploys to app-dev, so an epic's children branch from and PR into `epic/<slug>` (native sub-issues under an `Epic`-typed parent; keep the epic branch merged up with `main`); one final rebase-preferred PR ships the epic and closes parent + children together. Formatting is enforced (husky pre-commit prettier + CI `format:check`), and `build` / `type-check` / `lint` gate every PR through the **Static Checks** workflow — `lint` at **zero warnings** in every package, so an `eslint-disable` carries its reason in-file or the finding gets fixed. The suites do not re-run at merge (`main` requires branches up to date + squash, so the merged tree is the tested tree). See CLAUDE.md → "CI gating" and "Branch protection on `main`". Every turbo invocation in CI reads/writes a shared **Turborepo remote cache** (#454), guarded by `npm run lint:ci-cache` — five rules covering the credentials (absent token = caches nothing and still reports success), the required-check job names, the concurrency literals, and `apps/site` staying uncached (its env is `passThroughEnv`, so caching it would let a prod deploy restore dev's artifact). Fail-open on cache availability, fail-closed on integrity; a cache hit can never turn a red check green, since a failing task is never cached. Developer machines never write to it. The API image (built only at deploy, not on PRs) runs a **supply-chain gate** (#573): build → **Trivy** scan of the **whole image** (fails a deploy on any fixable `CRITICAL`/`HIGH`, `--ignore-unfixed`) → push with **SBOM + provenance** → **cosign keyless** signature. The runtime image is minimized to keep the gate clean — `apk upgrade`, bundled `npm`/`npx`/`corepack` removed, `drizzle-kit` moved to devDeps (drops `esbuild`; prod migrate uses `drizzle-orm`'s migrator), so the migrate/seed ECS tasks run `node dist/...` not `npm run`. `npm audit` stays the non-gating source-tree check. Policy + SLA + verify runbook: `docs/SUPPLY_CHAIN.md`.

## Discovery docs — enterprise-scale lens (default)

Portals AI is enterprise, multi-tenant, and billing-facing, so a discovery doc's default lens is **enterprise-scale, not prototype-grade**. Every discovery (`docs/<SLUG>.discovery.md`) carries an **"Enterprise-scale considerations"** pass — each dimension gets a `Lean:` or an explicit `N/A because …`: concurrency & correctness (multi-instance races, atomicity, idempotency); accuracy & auditability (durable ledger vs. ephemeral counter; chargeback/compliance); failure modes (fail-open vs. fail-closed and its cost/safety implication; dependency-down degradation); scale & unbounded growth (fan-out, cardinality ceilings, backpressure); multi-tenancy (per-org isolation, noisy-neighbor); contract stability (future paid/enterprise features plug in without re-plumbing); data lifecycle (windows aligned to business/contract semantics, not arbitrary technical ones). It's a lens, not bureaucracy — proportionate to the ticket, and any prototype-grade choice must be a *conscious, stated* downgrade, never a silent default. See CLAUDE.md → "Enterprise-scale considerations in discovery".

## Tool cost control (apps/api)

Tool spend is **server-enforced, not prompt-enforced**: a build-time wrap in `ToolService.buildAnalyticsTools` (`wrapWithCostGate`) charges every call against the org's tier allocation, keyed by the tool's `costHint` + `TierPolicy` (#172). The wrap is two-phase (#183): `CostGateService.checkAdmission` pre-flight (no charge) then `CostGateService.commitCharge` **only after `execute` succeeds** — a failed call is never charged, and async-job tools (`resultKind: "progress"`) defer the commit to their processor. Who-pays rule: units meter *application* cost — built-ins hitting Portal-paid APIs (Tavily/geocode) are charged; **custom/webhook tools are org-hosted → never charged** (their `costHint` is advisory to the agent only). `free` tools are immune. Denials return a typed tool *result* (`TOOL_USAGE_RATE_LIMITED`/`TOOL_USAGE_QUOTA_EXCEEDED`), never a throw; infra errors fail open. See CLAUDE.md → "Tool Cost Control" and `docs/TOOL_COST_GATE.spec.md`.

## Operating the Portal CLIs (`portalops` / `portalai`)

The native operator CLIs are **agent-operable by contract**: `--env <name>` required on every command, `--json` output (payload on stdout, banner on stderr), and **exit codes are the contract** (`0` ok · `2` usage · `3` not-configured · `4` not-authorized · `5` confirmation-required · `6` destructive-blocked · `7` infra-error; `portalai` adds `8` not-found / `9` conflict — branch on the code). Guards are **server-enforced** (`cli-env/guard.ts`, keyed on env `kind`): `local` unrestricted, `app-dev` mutations need `--yes`, `prod` destructive **blocked** + non-destructive needs `--yes --confirm-prod` — real enforcement, unlike the vendor CLIs whose mutation safety is a read-scoped credential. Auth: AWS-IAM (infra/DB) + Auth0 device-flow (`portalai login`). Mutating ops append a **write-only** JSONL line to `~/.portalai/audit.log`. The `.claude` allowlist covers **read** invocations only; secret-exposing reads (`vars get`, `vars list --unmask`) and arbitrary SQL (`db psql`) are not allowlisted. Runbooks: `packages/{devops-cli,admin-cli}/COMMANDS.md`; index: `docs/CLI_OPERATIONS_CHARTER.md`. See CLAUDE.md → "Operating the Portal CLIs".

## Keep documentation in sync with capabilities (feature changes)

Every feature/bugfix carries a standing check: is any documentation — user- or developer-facing — now out of sync with what the app actually does? Update every affected surface **in the same PR**; stale docs are a bug here, not a follow-up. Surfaces: user-facing Help (`apps/web/src/utils/{glossary,faq,getting-started}.util.ts`); the tool contract (`apps/api/src/tools/*.tool.ts` description + its `packages/core/src/registries/builtin-toolpacks.ts` mirror for pack tools + `apps/api/src/prompts/system.prompt.ts`); in-workflow examples / `helperText` / sample components / validation messages; and developer docs (`README.md`s, `docs/*.md` for shipped behavior, `CLAUDE.md` + this file for conventions, and the workflow skills under `.claude/skills/`). Tools are one category, not the framing. **Egress note (#582):** changing an egress vector — a tool that makes a third-party call, its env var (`ANTHROPIC_BASE_URL`/`TAVILY_API_KEY`/`GEOCODING_API_KEY`/a new one), or a subprocessor/telemetry behavior — drifts `docs/DEPLOYMENT_SECURITY_REVIEW.md` (egress/subprocessor/telemetry sections + SaaS baseline); update it in the same PR. See CLAUDE.md → "Keeping Documentation in Sync with Capabilities".
