# Portal.ai

## Overview

Portal.ai is a Turborepo monorepo for displaying dynamic UI content from a Model-Controller-Presenter architecture. It consists of a React frontend, an Express API server, a shared component/model library, and a JSON-Render registry for dynamic UI catalogs.

## Monorepo Structure

| Package | Path | Purpose |
|---------|------|---------|
| `@portalai/web` | `apps/web/` | Vite + React 19 frontend with Auth0, TanStack Router/Query, MUI |
| `@portalai/api` | `apps/api/` | Express + TypeScript API with Auth0 JWT, Drizzle ORM, PostgreSQL |
| `@portalai/core` | `packages/core/` | Shared UI components, MUI themes, Zod domain models, utilities |
| `@portalai/registry` | `packages/registry/` | Dynamic UI catalog registry using @json-render |

## Key Scripts

```bash
npm run dev              # Start all dev servers (web :3000, api :3001)
npm run build            # Build all packages
npm run lint / lint:fix   # ESLint across monorepo
npm run format           # Prettier across monorepo
npm run type-check       # TypeScript validation
npm run test             # Jest tests across monorepo
npm run storybook        # Storybook (core :7006, web :6007)
```

### API Database Scripts (run from `apps/api/`)

```bash
npm run db:generate      # Generate SQL migration from schema changes
npm run db:migrate       # Apply pending migrations
npm run db:push          # Push schema directly (dev only)
npm run db:studio        # Open Drizzle Studio GUI
npm run db:seed          # Seed the database
```

## File Naming Conventions

| Suffix | Purpose | Example |
|--------|---------|---------|
| `*.component.tsx` | Reusable UI components | `Header.component.tsx` |
| `*.view.tsx` | Page-level view components | `Dashboard.view.tsx` |
| `*.layout.tsx` | Layout wrappers | `Authorized.layout.tsx` |
| `*.stories.tsx` | Storybook stories | `Header.stories.tsx` |
| `*.test.ts(x)` | Jest tests | `Header.component.test.tsx` |
| `*.util.ts` | Utility functions / hooks | `api.util.ts` |
| `*.model.ts` | Zod domain models | `user.model.ts` |
| `*.router.ts` | Express route handlers | `health.router.ts` |
| `*.middleware.ts` | Express middleware | `auth.middleware.ts` |
| `*.table.ts` | Drizzle table definitions | `users.table.ts` |
| `*.repository.ts` | Database repository classes | `users.repository.ts` |

## Naming Conventions

- **Components / Views / Layouts / Interfaces / Types**: `PascalCase` — `LoginForm`, `UserProfile`
- **Functions / Hooks / Variables**: `camelCase` — `useAuthFetch`, `formatDate`
- **Constants**: `UPPER_SNAKE_CASE` — `API_BASE_URL`, `DEFAULT_THEME`
- **API Error Codes**: `<DOMAIN>_<FAILURE>` — `USER_NOT_FOUND`, `PROFILE_MISSING_TOKEN`

## Import Ordering

Organize imports in this order (separated by blank lines):

1. React and React-related libraries
2. Third-party libraries (`@mui`, `@tanstack`, `@auth0`, `zod`, etc.)
3. Monorepo packages (`@portalai/core`, `@portalai/registry`)
4. Local components and utilities (relative imports)
5. Types, interfaces, styles, and assets

## Component Structure Pattern

```tsx
// 1. Props interface
interface MyComponentProps {
  title: string;
  onAction?: () => void;
}

// 2. Component with hooks
export const MyComponent: React.FC<MyComponentProps> = ({ title, onAction }) => {
  const data = useCustomHook();

  // 3. Event handlers
  const handleClick = () => onAction?.();

  // 4. JSX
  return (
    <Box>
      <Typography>{title}</Typography>
    </Box>
  );
};
```

## Database Schema Workflow (Dual-Schema)

This project enforces a dual-schema approach — Zod models in `@portalai/core` and Drizzle tables in the API. Compile-time type assertions prevent drift.

### Adding a new table

1. **Define Zod model** in `packages/core/src/models/<entity>.model.ts` — extend `CoreObjectSchema`
2. **Define Drizzle table** in `apps/api/src/db/schema/<entity>.table.ts` — use `baseColumns`
3. **Generate drizzle-zod schemas** in `apps/api/src/db/schema/zod.ts` — `createSelectSchema` / `createInsertSchema`
4. **Add type guards** in `apps/api/src/db/schema/type-checks.ts` — bidirectional `IsAssignable` checks
5. **Generate & apply migration** — `npm run db:generate` then `npm run db:migrate`

If either side is updated without the other, **the build fails**.

### Adding a new repository

Extend `Repository<TTable, TSelect, TInsert>` in `apps/api/src/db/repositories/`. The base class provides `findById`, `findMany`, `count`, `create`, `createMany`, `update`, `updateWhere`, `updateMany`, `softDelete`, `softDeleteMany`, `hardDelete`, `hardDeleteMany`. All reads/updates automatically skip soft-deleted rows (`deleted IS NOT NULL`).

## Domain Model Pattern (packages/core)

Models follow a layered schema → class → factory pattern:

1. **Zod schema** — `CoreObjectSchema.extend({...})` defines fields and validation
2. **Model class** — `extends BaseModelClass<T>` with `toJSON()`, `validate()`, `update()`
3. **Model factory** — `extends ModelFactory<T, M>` with `create(createdBy)` method

Reference implementation: `packages/core/src/models/user.model.ts`

## API Style Guide

- **Services**: Export classes with static methods, not loose functions
- **Logging**: Log at route, service, and database layers using Pino logger
- **Request validation**: Middleware with typed `Request` interfaces
- **Response validation**: Validate payload structure before sending
- **Error handling**: Use `ApiError` class with `next(error)` — never send error responses directly
- **Error codes**: Add to `ApiCode` enum in `src/constants/api-codes.constants.ts`, format: `<DOMAIN>_<FAILURE>`

## Authentication

- **Frontend**: Auth0 React SDK — `useAuth0()` for login, `useAuthFetch()` hook for authenticated API calls
- **Backend**: Auth0 JWT middleware — `Authorization: Bearer <token>` header on all `/api/*` routes
- **Protected routes**: Frontend routes wrapped in `AuthorizedLayout` require authentication

## Routing (apps/web)

TanStack Router with file-based routing in `apps/web/src/routes/`. Route tree auto-generates on save. Create routes with `createFileRoute`, protect them by nesting under `_authorized`.

## Theming

Three themes via `@portalai/core`: Brand (default), Light, Dark. Persisted in localStorage. Fonts: Noto Sans (body), Playfair Display (headings), Cutive Mono (monospace).

## Registry (packages/registry)

Dynamic UI catalog system using `@json-render`. Each catalog defines components with Zod-validated props and React implementations. Register new catalogs in `src/catalogs/` and add to `src/registry.ts`. See `catalogs/Blog/` as the reference implementation.

## Environment URLs

| Service | URL |
|---------|-----|
| Web App | http://localhost:3000 |
| API Server | http://localhost:3001 |
| Swagger Docs | http://localhost:3001/api-docs |
| Core Storybook | http://localhost:7006 |
| Web Storybook | http://localhost:6007 |

## Detailed Documentation

Each package has its own README with deeper documentation:
- `apps/web/README.md` — routing, auth flow, theming, testing, storybook
- `apps/api/README.md` — DB schema workflow, repositories, transactions, API style guide
- `packages/core/README.md` — model architecture, component library, theme system
- `packages/registry/README.md` — catalog system, adding new catalogs
