# MCP UI — Copilot Instructions

## Project

Turborepo monorepo: React 19 frontend (`apps/web/`), Express API (`apps/api/`), shared component/model library (`packages/core/`), dynamic UI registry (`packages/registry/`).

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
3. Monorepo (`@mcp-ui/core`, `@mcp-ui/registry`)
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
5. `npm run db:generate && npm run db:migrate`

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

Three MUI themes: Brand (default), Light, Dark. Persisted in localStorage via `@mcp-ui/core`.

## Registry (packages/registry)

`@json-render` catalog system. Each catalog in `src/catalogs/` defines Zod prop schemas + React implementations. Register in `src/registry.ts`. Reference: `catalogs/Blog/`.
