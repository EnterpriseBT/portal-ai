# Portal.ai

## Overview

Portal.ai is a Turborepo monorepo for displaying dynamic UI content from a Model-Controller-Presenter architecture. It consists of a React frontend, an Express API server, and a shared component/model library.

## Monorepo Structure

| Package | Path | Purpose |
|---------|------|---------|
| `@portalai/web` | `apps/web/` | Vite + React 19 frontend with Auth0, TanStack Router/Query, MUI |
| `@portalai/api` | `apps/api/` | Express + TypeScript API with Auth0 JWT, Drizzle ORM, PostgreSQL |
| `@portalai/core` | `packages/core/` | Shared UI components, MUI themes, Zod domain models, utilities |

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
3. Monorepo packages (`@portalai/core`)
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

## Workflow Module Pattern (apps/web)

Multi-step user workflows (e.g., file upload, data import wizards) live in `apps/web/src/workflows/<WorkflowName>/`. Each workflow is a self-contained module with a strict internal structure:

```
workflows/
  <WorkflowName>/
    index.ts                            # Barrel exports
    <WorkflowName>.component.tsx        # Container (hooks + state) and pure UI component
    <StepName>Step.component.tsx         # Per-step presentational components
    utils/
      <feature>.util.ts                 # Hooks, state machines, helpers
    __tests__/
      <WorkflowName>.test.tsx           # Unit tests for the workflow
      <StepName>Step.test.tsx           # Unit tests for individual step components
    stories/
      <WorkflowName>.stories.tsx        # Storybook stories for the workflow UI
```

### Rules

- **Components** (`*.component.tsx`) go in the workflow root — these are the UI pieces (container, step panels)
- **Hooks and helpers** (`*.util.ts`) go in the `utils/` subfolder — these are the data-fetching, state management, and business logic pieces
- **Tests** (`*.test.tsx`) go in the `__tests__/` subfolder — co-located with the workflow, not in the top-level `src/__tests__/`
- **Stories** (`*.stories.tsx`) go in the `stories/` subfolder — co-located with the workflow, not in the top-level `src/stories/`
- **Container vs. UI**: Each workflow exports both a container component (wires hooks) and a pure `*UI` component (props-only, no hooks) for Storybook and testing
- **Barrel export** (`index.ts`) re-exports the public API: container, UI component, UI props type, and hooks

### Reference Implementation

`workflows/CSVConnector/` — CSV file upload workflow with 4-step stepper

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

### Include / Join Convention

Routes are **not** responsible for join logic. The router's job is to intake an `include` query parameter, parse it, and pass the resulting array to repository methods. The repository layer handles the actual joins or batch-loading. This pattern applies primarily to **GET requests** (list and detail endpoints).

#### URL Standard

Standard query parameters for list endpoints: `limit`, `offset`, `sortBy`, `sortOrder`, `search`, `include`. The specific values accepted by `include` are determined at an endpoint level — each endpoint defines which relations it supports. Additional custom parameters (single strings or comma-separated) are allowed per endpoint.

```
/api/resource?include=<comma,separated,attrs>&limit=10&offset=0&sortOrder=asc&sortBy=created&search=keyword
```

#### Router Layer

Parse `include` from the query string and pass to the repository:

```typescript
const include_ = req.query.include?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
```

#### Repository Layer

Repository methods accept `include` as an option. Pagination values are always optional:

```typescript
repository.findMany(where, { include, ...opts })
repository.findById(id, { include, ...opts })
repository.findByCustom(customValue, { include, ...opts })
```

Concrete repositories extend `ListOptions` with `include?: string[]` and override `findMany` (or add custom finders) to handle the join/batch-loading logic. Two implementation patterns are used:

1. **LEFT JOIN** — for 1-to-1 relations (e.g., `connectorDefinition` on `connectorInstances`)
2. **Post-query batch-loading** — for 1-to-many relations (e.g., `fieldMappings` on `connectorEntities`)

## Authentication

- **Frontend**: Auth0 React SDK — `useAuth0()` for login, `useAuthFetch()` hook for authenticated API calls
- **Backend**: Auth0 JWT middleware — `Authorization: Bearer <token>` header on all `/api/*` routes
- **Protected routes**: Frontend routes wrapped in `AuthorizedLayout` require authentication

## Routing (apps/web)

TanStack Router with file-based routing in `apps/web/src/routes/`. Route tree auto-generates on save. Create routes with `createFileRoute`, protect them by nesting under `_authorized`.

## Theming

Three themes via `@portalai/core`: Brand (default), Light, Dark. Persisted in localStorage. Fonts: Noto Sans (body), Playfair Display (headings), Cutive Mono (monospace).

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
