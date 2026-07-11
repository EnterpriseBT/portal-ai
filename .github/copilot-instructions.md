# Portal.ai — Copilot Instructions

## Project

Turborepo monorepo: React 19 frontend (`apps/web/`), Express API (`apps/api/`), shared component/model library (`packages/core/`), CLI environment-access layer (`packages/cli-env/`, Node-only), `portalops` operator CLI (`packages/devops-cli/`), `portalai` app-data CLI (`packages/admin-cli/`).

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

## API Pattern

- Services: classes with static methods (not loose functions)
- Errors: `ApiError` class + `next(error)` — never `res.status().json()` directly
- Error codes: `ApiCode` enum in `src/constants/api-codes.constants.ts`
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

## Domain Models (packages/core)

Layered: Zod schema (`CoreObjectSchema.extend`) → model class (`BaseModelClass<T>`) → factory (`ModelFactory<T, M>`). Reference: `user.model.ts`.

## Auth

- Frontend: Auth0 React SDK, `useAuthFetch()` hook for authenticated calls
- Backend: Auth0 JWT middleware on `/api/*` routes, `Authorization: Bearer <token>`
- Protected routes: nest under `_authorized` layout in TanStack Router

## Routing (apps/web)

TanStack Router, file-based in `src/routes/`. Route tree auto-generates. Use `createFileRoute`.

## Themes

Three MUI themes: Brand (default), Light, Dark. Persisted in localStorage via `@portalai/core`.


## Discovery docs — enterprise-scale lens (default)

Portal.ai is enterprise, multi-tenant, and billing-facing, so a discovery doc's default lens is **enterprise-scale, not prototype-grade**. Every discovery (`docs/<SLUG>.discovery.md`) carries an **"Enterprise-scale considerations"** pass — each dimension gets a `Lean:` or an explicit `N/A because …`: concurrency & correctness (multi-instance races, atomicity, idempotency); accuracy & auditability (durable ledger vs. ephemeral counter; chargeback/compliance); failure modes (fail-open vs. fail-closed and its cost/safety implication; dependency-down degradation); scale & unbounded growth (fan-out, cardinality ceilings, backpressure); multi-tenancy (per-org isolation, noisy-neighbor); contract stability (future paid/enterprise features plug in without re-plumbing); data lifecycle (windows aligned to business/contract semantics, not arbitrary technical ones). It's a lens, not bureaucracy — proportionate to the ticket, and any prototype-grade choice must be a *conscious, stated* downgrade, never a silent default. See CLAUDE.md → "Enterprise-scale considerations in discovery".

## Tool cost control (apps/api)

Tool spend is **server-enforced, not prompt-enforced**: a build-time wrap in `ToolService.buildAnalyticsTools` (`CostGateService.resolveCostGate`) charges every call against the org's tier allocation, keyed by the tool's `costHint` + `TierPolicy` (#172). Who-pays rule: units meter *application* cost — built-ins hitting Portal-paid APIs (Tavily/geocode) are charged; **custom/webhook tools are org-hosted → never charged** (their `costHint` is advisory to the agent only). `free` tools are immune. Denials return a typed tool *result* (`TOOL_USAGE_RATE_LIMITED`/`TOOL_USAGE_QUOTA_EXCEEDED`), never a throw; infra errors fail open. See CLAUDE.md → "Tool Cost Control" and `docs/TOOL_COST_GATE.spec.md`.

## Keep documentation in sync with capabilities (feature changes)

Every feature/bugfix carries a standing check: is any documentation — user- or developer-facing — now out of sync with what the app actually does? Update every affected surface **in the same PR**; stale docs are a bug here, not a follow-up. Surfaces: user-facing Help (`apps/web/src/utils/{glossary,faq,getting-started}.util.ts`); the tool contract (`apps/api/src/tools/*.tool.ts` description + its `packages/core/src/registries/builtin-toolpacks.ts` mirror for pack tools + `apps/api/src/prompts/system.prompt.ts`); in-workflow examples / `helperText` / sample components / validation messages; and developer docs (`README.md`s, `docs/*.md` for shipped behavior, `CLAUDE.md` + this file for conventions). Tools are one category, not the framing. See CLAUDE.md → "Keeping Documentation in Sync with Capabilities".
