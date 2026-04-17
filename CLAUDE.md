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
npm run db:generate -- --name <descriptive-name>  # Generate named SQL migration from schema changes
npm run db:migrate                                # Apply pending migrations
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

## Component File Policy (application-wide)

This rule applies to **every** `*.component.tsx`, `*.view.tsx`, and `*.layout.tsx` file across the monorepo (`apps/web`, `packages/core`, anywhere else React components live). It generalizes — and supersedes — the "container + pure UI" bullet in the Workflow Module Pattern and Module Pattern sections below.

### One or two components per file

- A component file may define and export **at most two** components.
- **Inline helper components are not allowed.** If a JSX fragment is worth naming, it is worth its own file. A new component always goes in a new file.
- **Single-component file:** the component must be a **pure UI component** — it receives all data and callbacks via props and is free of data fetching, routing, context consumption, state machines, effects against external systems, or any other wiring. It renders from its props and nothing else.
- **Two-component file:** the second export is allowed **only** when it is the implementation (container) of the pure UI component also exported from the same file. The container wires hooks/state/contexts, then delegates rendering to the UI component. No other pairing (e.g. "UI + another unrelated UI", "UI + small header", "container + container") is permitted.

### Naming

- Pure UI component: `<ComponentName>UI` — props type `<ComponentName>UIProps`.
- Implementation component: `<ComponentName>` — props type `<ComponentName>Props`. Its render method is `<ComponentName>UI {...uiProps} />`.
- The file is named after the implementation: `<ComponentName>.component.tsx`. A file containing only a pure UI component is still named `<ComponentName>.component.tsx` (not `<ComponentName>UI.component.tsx`).

### Testing

- Unit tests render the pure UI component (`<ComponentName>UI`) so they can drive behavior through props and need no SDK, router, or provider mocks.
- Implementation components are exercised through higher-level integration tests (container/workflow/view level) where covering the wiring is genuinely the point.
- Storybook stories also render the pure UI component so stories need no context setup.

## Form & Dialog Pattern (apps/web)

Every data-submission dialog must follow this structure:

### Form Wrapping

- Every dialog that submits data **must** be wrapped in a `<form onSubmit>` element
- For `Modal`-based dialogs: use `slotProps.paper.component="form"` with `onSubmit` handler on `slotProps.paper`
- For raw MUI `Dialog`: wrap `DialogContent` + `DialogActions` in a native `<form>`
- Action buttons must use `type="button"` to prevent double-firing with form submission
- The first interactive field must receive auto-focus via `useDialogAutoFocus(open)` from `utils/use-dialog-autofocus.util.ts` (or `autoFocus` prop for simple text fields outside Modal)

### Server Error Display

Every dialog that triggers a mutation must:

- Accept a `serverError?: ServerError | null` prop (type from `utils/api.util.ts`)
- Render `<FormAlert serverError={serverError} />` (from `components/FormAlert.component.tsx`) inside the dialog content
- The parent view must pass `toServerError(mutation.error)` from `utils/api.util.ts`

### Zod Validation

Every form with user input must:

- Validate via `validateWithSchema(Schema, data)` from `utils/form-validation.util.ts` using the matching `@portalai/core/contracts` schema
- Maintain `touched` and `errors` state (`FormErrors` type from `form-validation.util.ts`); show errors only after blur or submit
- Block submission when validation fails (never call `onSubmit` with invalid data)
- Call `focusFirstInvalidField()` from `utils/form-validation.util.ts` after setting errors — this finds the first `[aria-invalid="true"]` element, scrolls it into view, and focuses it

### Utility Reference

| Utility | Path | Purpose |
|---------|------|---------|
| `ServerError` | `utils/api.util.ts` | Structured error type with `message` and `code` |
| `toServerError()` | `utils/api.util.ts` | Converts `ApiError \| null` to `ServerError \| null` |
| `FormAlert` | `components/FormAlert.component.tsx` | Renders `<Alert>` with error message and code |
| `validateWithSchema()` | `utils/form-validation.util.ts` | Zod `safeParse` wrapper returning `FormErrors` |
| `focusFirstInvalidField()` | `utils/form-validation.util.ts` | Focuses and scrolls to first invalid field |
| `FormErrors` | `utils/form-validation.util.ts` | `Record<string, string>` type for field-level errors |
| `useDialogAutoFocus()` | `utils/use-dialog-autofocus.util.ts` | Returns a ref that auto-focuses after dialog open |

## Accessibility Requirements (apps/web)

- All `<TextField>` with validation must include `error={touched[field] && !!errors[field]}` and `helperText={touched[field] && errors[field]}` — MUI auto-links `aria-describedby` when `helperText` is set
- All validated `<TextField>` must include `slotProps={{ htmlInput: { "aria-invalid": touched[field] && !!errors[field] } }}`
- All icon-only `<IconButton>` components must have a descriptive `aria-label`
- `<FormAlert>` uses MUI `<Alert>` which provides `role="alert"` automatically — do not add custom alert roles
- Searchable select components (`AsyncSearchableSelect`, `SearchableSelect`, etc.) accept `inputRef` for focus management

## Mutation Cache Invalidation (apps/web)

- Every mutation's `onSuccess` callback must invalidate at minimum its own entity's `.root` query key via `queryClient.invalidateQueries({ queryKey: queryKeys.<entity>.root })`
- Delete operations that cascade on the backend must also invalidate downstream entity query keys on the frontend:
  - Station delete → `stations.root`, `portals.root`, `portalResults.root`
  - Connector instance delete → `connectorInstances.root`, `connectorEntities.root`, `stations.root`, `fieldMappings.root`
  - Portal delete → `portals.root`, `portalResults.root`
- Never manually remove or update cache entries — always use `invalidateQueries`
- Query keys are defined in `api/keys.ts` and re-exported from `api/sdk.ts`

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
- **Container vs. UI**: Each workflow exports both a container component (wires hooks) and a pure `*UI` component (props-only, no hooks) for Storybook and testing. Naming and file-shape follow the [Component File Policy](#component-file-policy-application-wide): the pair lives in one file, UI is suffixed `UI`, implementation is unsuffixed.
- **Barrel export** (`index.ts`) re-exports the public API: container, UI component, UI props type, and hooks

### Stepper Validation

- Each step that collects user input must define a Zod schema in `utils/<feature>.util.ts`
- The container must call the step's validation function before advancing to the next step (`onNext`)
- If validation fails, the step must display per-field errors and block navigation
- Reference implementation: `workflows/CSVConnector/utils/csv-validation.util.ts`

### Reference Implementation

`workflows/CSVConnector/` — CSV file upload workflow with 4-step stepper

## Module Pattern (apps/web)

Large-scale reusable building blocks live in `apps/web/src/modules/<ModuleName>/`. A module is **structurally identical to a workflow** but is **context-agnostic**: it is intended for reuse across multiple components and/or workflows rather than owning a single end-to-end user flow. Apply all the rules below from the Workflow Module Pattern — same folder layout, same container + pure-UI split, same test and story co-location, same barrel `index.ts` — substituting "module" for "workflow".

```
modules/
  <ModuleName>/
    index.ts                            # Barrel exports — the public surface consumers embed
    <ModuleName>.component.tsx          # Container + pure UI component
    <StepName>Step.component.tsx         # Sub-panels (if multi-step)
    utils/
      <feature>.util.ts                 # Hooks, state machines, helpers
    __tests__/
      <ModuleName>.test.tsx
      <StepName>Step.test.tsx
    stories/
      <ModuleName>.stories.tsx
      <StepName>Step.stories.tsx
```

### When to use a module vs. a workflow vs. a component

- **`components/`** — small, general-purpose UI primitives (button variant, form alert, chip).
- **`modules/`** — large, self-contained, reusable building blocks. Context-agnostic: no knowledge of connectors, routes, or specific features. Consumers seed them with inputs and read back emitted state. May be multi-step internally but do not own a user journey.
- **`workflows/`** — end-to-end, context-specific user flows (e.g., `FileUploadConnector`). Own routing, entry/exit, commit actions. May embed one or more modules.

**Promote to a module when**: the block is shared by two or more consumers (workflows, views, or other modules), or is planned to be; it has no single "owning" user flow; it knows nothing connector- or feature-specific.

### Reference Implementation

`modules/RegionEditor/` — spreadsheet region-drawing editor embedded by file-upload and cloud-spreadsheet connector workflows (see `docs/SPREADSHEET_PARSING.frontend.spec.md`).

## Database Schema Workflow (Dual-Schema)

This project enforces a dual-schema approach — Zod models in `@portalai/core` and Drizzle tables in the API. Compile-time type assertions prevent drift.

### Adding a new table

1. **Define Zod model** in `packages/core/src/models/<entity>.model.ts` — extend `CoreObjectSchema`
2. **Define Drizzle table** in `apps/api/src/db/schema/<entity>.table.ts` — use `baseColumns`
3. **Generate drizzle-zod schemas** in `apps/api/src/db/schema/zod.ts` — `createSelectSchema` / `createInsertSchema`
4. **Add type guards** in `apps/api/src/db/schema/type-checks.ts` — bidirectional `IsAssignable` checks
5. **Generate & apply migration** — `npm run db:generate -- --name <descriptive-name>` then `npm run db:migrate`

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

## Dialog & Form Test Checklist (apps/web)

Every new dialog must have tests covering:

- Renders title and content when `open={true}`
- Does not render when `open={false}`
- Calls `onSubmit`/`onConfirm` on button click
- Supports Enter key submission (form submit event)
- Calls `onClose` on Cancel click
- Shows loading state when `isPending={true}`
- Renders `<FormAlert>` when `serverError` is provided
- Does not render `<FormAlert>` when `serverError` is null
- Displays field-level validation errors on invalid submit
- `aria-invalid="true"` is set on invalid fields
- `required` attribute is present on required fields

Tests use ESM dynamic imports with `jest.unstable_mockModule` for SDK mocks. The test render utility (`__tests__/test-utils.tsx`) accepts an optional `queryClient` for verifying cache invalidation via `jest.spyOn(queryClient, "invalidateQueries")`.

## Detailed Documentation

Each package has its own README with deeper documentation:
- `apps/web/README.md` — routing, auth flow, theming, testing, storybook
- `apps/api/README.md` — DB schema workflow, repositories, transactions, API style guide
- `packages/core/README.md` — model architecture, component library, theme system
