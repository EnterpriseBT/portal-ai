# Portal.ai

## Overview

Portal.ai is a Turborepo monorepo for displaying dynamic UI content from a Model-Controller-Presenter architecture. It consists of a React frontend, an Express API server, and a shared component/model library.

## Monorepo Structure

| Package | Path | Purpose |
|---------|------|---------|
| `@portalai/web` | `apps/web/` | Vite + React 19 frontend with Auth0, TanStack Router/Query, MUI |
| `@portalai/api` | `apps/api/` | Express + TypeScript API with Auth0 JWT, Drizzle ORM, PostgreSQL |
| `@portalai/core` | `packages/core/` | Shared UI components, MUI themes, Zod domain models, utilities |
| `@portalai/cli-env` | `packages/cli-env/` | Shared CLI environment-access layer: env registry, AWS-IAM + Auth0 device-flow authorization, `resolveEnvConnection`. Node-only — never imported by web/core |
| `@portalai/devops-cli` | `packages/devops-cli/` | `portalops` — infrastructure operator CLI (DB tunnels/psql/reset/seed, Secrets Manager + SSM config catalog) over `cli-env`. Replaces `apps/api/scripts/api-cli.sh` |
| `@portalai/admin-cli` | `packages/admin-cli/` | `portalai` — customer-app-data operator CLI (org/user/member/tier management, full org provisioning, fixtures) over `cli-env`. Infra-free |

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

### Formatting enforcement

Prettier is enforced, not advisory: a husky pre-commit hook (installed by `npm install` via the `prepare` script) runs lint-staged, formatting staged files over the same `src/**` globs the per-package `format` scripts cover, and CI runs `format:check` in the unit-test workflow. `apps/web/src/routeTree.gen.ts` is excluded (the TanStack Router generator owns its formatting — never hand-format it), and markdown (`docs/*.md`, skills) is deliberately unformatted. `--no-verify` is the escape hatch for the hook; CI still catches it.

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

## API Calls & SDK Helpers (apps/web)

All API calls route through the SDK. No component — view, workflow, module, or primitive — may call `fetch`, `useAuthFetch`, or `fetchWithAuth` directly. The SDK is the only path.

- **Where**: `apps/web/src/api/<domain>.api.ts` defines the endpoints; `apps/web/src/api/sdk.ts` exposes them as `sdk.<domain>.<action>()`. Every network call originates here.
- **What to use**: SDK endpoints are built on the helpers in `utils/api.util.ts`:
  - `useAuthMutation` — write calls AND imperative reads. For GET endpoints that must fire per-invocation (e.g. viewport-driven fetches), use `method: "GET"`, `body: () => undefined`, and build the URL from variables via `url: (vars) => string`. Consumers get `mutateAsync` for imperative use.
  - `useAuthQuery` — declarative reads keyed by a stable `queryKeys.*` entry. React Query handles caching + invalidation.
- **What to avoid**: hand-rolled `useAuthFetch` + `useCallback` wrappers are the exception, not the rule — reserved for search hooks that populate a bespoke label-map cache. Every other endpoint uses the helpers above so auth-error handling, response unwrapping, and react-query integration stay uniform.
- **Consumption pattern**: containers destructure the imperative handle (`const { mutateAsync: fooMutate } = sdk.foo.bar()`) and hand a narrow callback down as a prop. Pure UI components in `modules/` and `components/` stay context-agnostic — they accept callbacks, they never import `sdk`.

## Mutation Cache Invalidation (apps/web)

- Every mutation's `onSuccess` callback must invalidate at minimum its own entity's `.root` query key via `queryClient.invalidateQueries({ queryKey: queryKeys.<entity>.root })`
- Delete operations that cascade on the backend must also invalidate downstream entity query keys on the frontend:
  - Station delete → `stations.root`, `portals.root`, `portalResults.root`
  - Connector instance delete → `connectorInstances.root`, `connectorEntities.root`, `stations.root`, `fieldMappings.root`
  - Portal delete → `portals.root`, `portalResults.root`
- Never manually remove or update cache entries — always use `invalidateQueries`
- Query keys are defined in `api/keys.ts` and re-exported from `api/sdk.ts`

## Async Job State & Data Locking

Long-running work runs on the shared `jobs` queue (`apps/api/src/queues/`) — file-upload parse, layout-plan commit, connector sync, revalidation, etc. While a job is in flight, **the entities it owns must be treated as read-only across the entire stack**. This keeps the user from racing the worker (e.g., editing a record mid-import, deleting a connector instance whose plan is mid-commit, kicking off a sync against an instance that's still syncing).

### Backend rules

- Routes that mutate an entity must short-circuit with `409 ENTITY_LOCKED_BY_JOB` (add the code to `api-codes.constants.ts` if missing) when a non-terminal job (`pending` / `active` / `awaiting_confirmation`) targets that entity. The check belongs in the route or service layer, before any DB write.
- The check is keyed by the entity in the job metadata — for `layout_plan_commit` and `connector_sync` that's `connectorInstanceId`; for `file_upload_parse` that's the `uploadIds` (and by extension the upload session). New job types must declare which entity ids they lock in their `<Type>MetadataSchema` JSDoc.
- Worker code itself must not write to the entity through a path that bypasses the lock — the worker IS the holder, so its own writes are fine, but unrelated mutations triggered while the worker runs must be rejected.
- Locks release when the job reaches a terminal status (`completed` / `failed` / `cancelled` — see `TERMINAL_JOB_STATUSES` in `job.model.ts`). No manual unlock paths.

### Frontend rules (apps/web)

- Every entity-detail view that has running-job exposure must surface the lock state inline. The connector-instance view is the canonical example: render an MUI `<Alert severity="info">` (or a `<Chip>` in tight headers) listing each running job's type + a "started X ago" timestamp, with copy that names the blocked actions ("Sync, edit fields, and delete are paused until the import finishes.").
- Mutations that target a locked entity must be disabled at the UI layer — the button stays visible (so the affordance doesn't disappear) but is `disabled` with a tooltip pointing at the running job. The disabled state is driven from the same `useAuthQuery` that powers the alert, not from the mutation's own state.
- The alert auto-dismisses on the SSE terminal event for the job (or via an automatic refetch when the entity's `.root` query invalidates after job completion). Don't poll; the existing `/api/sse/jobs/:id/events` channel is the source of truth.
- Workflows that enqueue a long-running job (commit, sync, parse) own the user's expectations *before* the job starts: the action button should already say "Importing…" / "Syncing…" while the SSE stream is open, and the post-202 navigation should land on a view that shows the lock alert so the user immediately understands what they can't do yet.

### When you add a new long-running job

1. Add the JobType + per-type metadata/result schemas to `packages/core/src/models/job.model.ts`. The metadata's JSDoc must declare the entity ids the job locks.
2. The route that enqueues the job validates that no other non-terminal job already locks the same entity ids (re-using the same 409 path).
3. Every entity-detail view that could surface this job adds it to its lock-state query (or extends an existing aggregate query that returns "running jobs for this entity").
4. The processor's terminal payload (the `result` field) carries enough information for the SSE consumer to refresh its caches without a full refetch loop — same as `file_upload_parse` does today.

## Tool Cost Control (apps/api)

Tool spend is **server-enforced**, never prompt-enforced (a cost gate the agent can't opt out of — per the standing "safety/confirmation gates get server enforcement, not prompt instructions" rule). Every tool call routes through a build-time wrap in `ToolService.buildAnalyticsTools` (`CostGateService.resolveCostGate`), keyed by the tool's declared `costHint` (`free | metered | expensive` on `ToolCapability`) and the org's `TierPolicy` (#172).

- **Who-pays rule.** Units meter *application*-incurred cost only. **Built-in** tools that hit a Portal-paid third party or heavy compute (`web_search`→Tavily, GIS `geocode`) are charged against the org's per-cost-class allocation. **Custom/webhook** tools are org-hosted → **`resolveCallCost` returns 0, never charged**; their `costHint` is surfaced to the agent as *advisory* description text only (there's no Portal cost to enforce). See `docs/CUSTOM_TOOLPACK_INTEGRATION.md`.
- **`free` is immune** — never charged, never denied, never rate-limited (even under an exhausted quota).
- **Where state lives.** The durable per-org usage balance + Settings display are #172 (`usage` table, `UsageService`). The gate *charges* it (`UsageService.tryCharge`, an atomic conditional UPSERT — quota) and a Redis fixed-window counter (rate). Denials return a **typed tool result** (`TOOL_USAGE_RATE_LIMITED` / `TOOL_USAGE_QUOTA_EXCEEDED`), never a throw, so the agent relays them. Infra errors **fail open**. See `docs/TOOL_COST_GATE.spec.md` (#169).
- **A guard test asserts every tool (built-in and custom) is wrapped** — a new tool-construction path that bypasses the gate fails CI.

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
- **OpenAPI annotations**: Every route handler must carry a `@openapi` JSDoc block above it. The block declares the route path, method, tags, security scheme, parameters, request body schema, and per-status response schemas. SSE endpoints declare `text/event-stream` as the response content type and reference the event's payload schema.

  Request bodies, payloads, and response shapes are referenced by `$ref` against components registered in `src/config/swagger.config.ts`, **not** spelled inline. Adding a new route generally means: (a) register the shape(s) under `components.schemas` (often `z.toJSONSchema` from the source Zod schema), and (b) refer to them via `$ref: '#/components/schemas/<Name>'` in the route's JSDoc. Inline shapes are reserved for tiny one-off `properties` that exist nowhere else; if you'd reuse a shape twice, register it.

  The annotations feed `/api/docs` (Swagger UI at `http://localhost:3001/api-docs`); a route without `@openapi`, or one that re-spells a shape inline that's already a registered component, is a missing-docs bug, not "deferred."

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

- **Frontend**: Auth0 React SDK — `useAuth0()` for login. All authenticated API calls go through the SDK (`sdk.<domain>.<action>()`) built on `useAuthMutation`/`useAuthQuery`; see *API Calls & SDK Helpers (apps/web)* above.
- **Backend**: Auth0 JWT middleware — `Authorization: Bearer <token>` header on all `/api/*` routes
- **Protected routes**: Frontend routes wrapped in `AuthorizedLayout` require authentication

## Routing (apps/web)

TanStack Router with file-based routing in `apps/web/src/routes/`. Route tree auto-generates on save. Create routes with `createFileRoute`, protect them by nesting under `_authorized`.

## Theming

Two themes via `@portalai/core`: Brand (default, light) and Brand Dark. Persisted in localStorage. Fonts: Noto Sans (body), Playfair Display (headings), Cutive Mono (monospace).

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

## Issue → PR Workflow

Issues and PRs live on `EnterpriseBT/portal-ai`; use `gh` for all ticket/PR work.

### One feature = one branch = one PR

Every non-trivial change lives on **one branch** with **one PR**. The five artifacts — discovery doc, spec doc, plan doc, implementation, smoke doc — land as separate commits on that branch as the work progresses. The PR is opened early (often as draft) and grows commit-by-commit; reviewers track progress at the commit level, not across multiple PRs.

| Artifact | What lands | When it's needed |
|---|---|---|
| 1. Ticket | GitHub issue with a PRD (feature) or repro + impact (bug). Issue Type set; sizing recorded; project board card in `Todo`. | Always for non-trivial work |
| 2. Discovery | `docs/<SLUG>.discovery.md` — survey + design space + decisions. | Anything that touches more than one package, introduces a new pattern, or changes a contract |
| 3. Spec + plan | `docs/<SLUG>.spec.md` (contract) and `docs/<SLUG>.plan.md` (phased TDD slices). | Same threshold as discovery — when discovery is warranted, spec + plan follow |
| 4. Implementation | Code + tests, one commit per testable slice from the plan. | Always |
| 5. Smoke | `docs/<SLUG>.smoke.md` — manual walkthrough checklist mapped from the spec's acceptance criteria (see "The smoke gate"). | After implementation, before merge. Condensed tickets embed it in the single doc |

Each phase has a skill that executes it deterministically: `/ticket` → `/discovery` → `/spec` → `/plan` → `/smoke`, with `/epic` coordinating multi-ticket parents. **Implementation only starts after discovery/spec/plan are reviewed and confirmed** — the skills draft, the user confirms, then code lands.

Branch naming follows the work, not the artifact: `feat/<slug>` for new functionality, `fix/<slug>` for bug fixes, `chore/<slug>` / `docs/<slug>` / `test/<slug>` for everything else. The discovery/spec/plan commits live on this same branch — there is **no** `docs/<slug>-discovery` or `docs/<slug>-spec` interim branch.

Notes:

- **Skip or condense artifacts when proportionate.** A one-line typo fix or a localized bug with a clear reproduction goes straight to implementation — no docs at all. A small-but-real ticket takes the **condensed path** (one combined doc — see below). Anything that touches more than one package, introduces a new pattern, or changes a contract produces all five artifacts. The call is made at ticket time (`## Sizing`) and revisited at discovery if it was wrong.
- **Phase = commit, not PR.** The phases exist to (a) break work into single testable units and (b) keep each commit reviewable on its own. They do **not** mean separate PRs.
- **When to split a feature across multiple PRs.** Only when context-window management forces it — features so large that a single AI-assisted session can't hold the implementation in context end-to-end. Each split PR ships a complete, testable slice (its own branch off `main`, its own ticket reference, `Closes #N` on the final slice). For human-driven work, "too big" is rarely the reason — prefer one PR.
- **Doc artifacts live in `docs/`** with the existing suffix convention (`.discovery.md`, `.spec.md`, `.plan.md`). For multi-PR features, the plan doc names the slices and the slice mapping appears in each PR's body.
- **The issue body holds the index.** As each doc commits, edit the issue to append the link. The issue is the canonical entry point for anyone catching up on the work.
- **Project-board card movement.** `Todo` → `In Progress` when the first commit lands on the branch (whichever phase it is). `Done` is set automatically when the PR with `Closes #N` merges.

### Ticket kinds & body templates

Every ticket is one of three kinds, each with a codified body shape (`/ticket` scaffolds them; `/epic` owns the third):

- **Feature** — a PRD: `## Why` → `## Deliverables` (checklist) → `## Acceptance criteria` (externally-observable) → `## Out of scope` → `## Sizing` → `## References`.
- **Bugfix** — a reproduction: `## Repro` (steps, Expected vs Got) → `## Impact` → `## Likely cause / fix direction` → `## Evidence` → `## Sizing` → `## References`.
- **Epic** — a parent tracking issue (Issue Type `Epic`) grouping feature/bugfix children as native sub-issues, with an overview, a `## Status` table, and a `## Children & dependencies` map. See "Epic branches".

The `## Sizing` section records the doc-path decision at creation time: **`full`** (all five artifacts) or **`condensed`** (one combined doc). Condensed is right only when the change is single-package, introduces no new pattern, and changes no contract.

Feature PRDs are elicited against the **PRD dimension checklist** in `.claude/skills/ticket/SKILL.md` (actors & roles, surfaces & placement, standard vs bespoke paths, lifecycle interactions, states & edge behavior — the single source is that file); `/discovery` gates on the PRD's completeness against the same checklist before surveying, and post-filing scope changes on any ticket kind (feature requirements, or a bug's repro/impact) follow `/ticket`'s amendment procedure — issue body and in-flight branch docs reconciled in one action (#212).

### Condensed path for small tickets

When sizing chose `condensed`, `/discovery <N> condensed` writes a single `docs/<SLUG>.md` covering discovery + spec + plan + smoke (exemplar: `docs/PORTAL_MESSAGE_TIMESTAMPS.md`): `**Why.**` → `## Current shape` → `## Decision — <name>` → `## Plan — <n> slice(s)` → `## Smoke (manual, against your dev stack)` → `## Out of scope`, ≤ ~80 lines. `/spec` and `/plan` are not run on a condensed branch (they detect the single doc and defer to it); `/smoke` refreshes the embedded Smoke section, which is the ticket's merge gate.

### Enterprise-scale considerations in discovery

Portal.ai is an enterprise, multi-tenant, billing-facing product — a discovery doc's **default lens is enterprise-scale**, not prototype-grade. Every discovery (the `/discovery` skill scaffolds this section automatically) carries an **"Enterprise-scale considerations"** pass that weighs the design against these dimensions, each getting a `Lean:` or an explicit `N/A because …`:

- **Concurrency & correctness** — multi-instance/ECS races, atomicity of check-then-act, idempotency keys.
- **Accuracy & auditability** — a durable record-of-truth (ledger / event log) vs. an ephemeral counter; chargeback / dispute / compliance needs.
- **Failure modes** — fail-open vs. fail-closed and its *cost/safety* implication; graceful degradation when a dependency (Redis / DB / upstream provider) is down.
- **Scale & unbounded growth** — fan-out, cardinality ceilings, pagination, backpressure, runaway loops.
- **Multi-tenancy** — per-org isolation, noisy-neighbor protection, per-tenant limits.
- **Contract stability** — shaping the input so future paid/enterprise features (tiers, quotas, SSO, RBAC) plug in without re-plumbing call sites.
- **Data lifecycle** — windows/periods aligned to *business/contract* semantics (e.g. a billing period), retention — not arbitrary technical windows ("calendar UTC day because it's easy").

**This is a lens, not bureaucracy.** Proportionate to the ticket: a localized single-package change marks dimensions `N/A` in a line; a cross-cutting, contract, or billing ticket engages each. Prototype-grade choices (in-process-only state, non-atomic counters, blanket fail-open) are allowed **only** as a *conscious, recorded* downgrade — "prototype-grade acceptable because X" — never as a silent default. The tool cost gate (#169) is the cautionary example: it first defaulted to flat counting, ±1-slop increments, blanket fail-open, and calendar-day windows, and every one was wrong for a per-org billing feature — the correction (units meter, atomic check-and-charge, split fail policy, contract-aligned periods) and the split-out tier contract (#172) is what this lens exists to catch up front.

### Filing an issue

- File on GitHub (`gh issue create --repo EnterpriseBT/portal-ai`), not in `docs/`. The `docs/` tree is reserved for design specs / plans / smoke checklists.
- Set the **Issue Type** (`Bug` / `Feature` / `Task` / `Epic`) — this is GitHub's structured type field, not a label. There's no `gh issue edit --type` shortcut yet; set it via GraphQL:
  ```bash
  gh api graphql -f query='mutation($id:ID!,$typeId:ID!){updateIssue(input:{id:$id,issueTypeId:$typeId}){issue{number}}}' -f id=<issueNodeId> -f typeId=<IT_…>
  ```
  Fetch the issue node id and the type ids via `repository.issue(number:N){id}` and `repository.issueTypes(first:10){nodes{id name}}`. `Epic` = `IT_kwDODs25Bc4CFje_` (org-level type; parents get it via `/epic`).
- Optional labels (`documentation`, `question`, `help wanted`, etc.) layer on top of the type.
- Project board: the **Portal AI** Projects v2 board (project #1) auto-adds new issues to `Todo` and auto-moves them to `Done` when the linked PR merges. Move the card to `In Progress` manually when work starts on it — the snippet below sets that. The token needs `project` scope (`gh auth refresh -s read:project,project`). IDs:
  - Project id: `PVT_kwDODs25Bc4BUMsm`
  - Status field id: `PVTSSF_lADODs25Bc4BUMsmzhBWfpk`
  - Status options: `Todo` = `f75ad846`, `In Progress` = `47fc9ee4`, `Done` = `98236657`
  - One-liner to move issue `<N>` to In Progress:
    ```bash
    ITEM_ID=$(gh project item-list 1 --owner EnterpriseBT --format json --limit 100 \
      | jq -r '.items[] | select(.content.number==<N>) | .id')
    gh project item-edit --id "$ITEM_ID" \
      --project-id PVT_kwDODs25Bc4BUMsm \
      --field-id PVTSSF_lADODs25Bc4BUMsmzhBWfpk \
      --single-select-option-id 47fc9ee4
    ```
- Closing: `gh issue close <N> --reason completed` / `--reason "not planned"` (the reason value contains a space). PRs containing `Closes #N` in the body auto-close the issue with `reason: completed` on merge — no manual close needed. Auto-close only fires on merges to the **default branch** — child PRs merging into an epic branch close nothing (see "Epic branches").

### Branching

- Branch off `main`. Prefix by intent: `fix/<slug>` for bug fixes, `feat/<slug>` for new functionality; use `chore/`, `docs/`, `test/` for other types.
- **Exception:** children of an open epic branch off — and PR back into — `epic/<slug>`, not `main`. See "Epic branches".

### Epic branches

`main` auto-deploys to the app-dev environment, so a multi-ticket epic must not land there half-finished as child PRs merge. The epic branch is that **deployment gate** (`/epic` automates all of this):

- The parent issue (Issue Type `Epic`) carries the overview, a `## Status` table (`Todo` → `In progress` → `Merged into epic` → `Closed`), and the dependency map; children are native GitHub sub-issues. The Status table is the record of truth — update it with every child state change.
- `epic/<slug>` is created from `main` and pushed at epic creation. Children branch from it and PR back into it (base: `epic/<slug>`, squash, review + CI per child — workflows run on all non-`main` pushes).
- **Keep-pace rule:** before each child PR merges, merge `main` into the epic branch (`git checkout epic/<slug> && git merge main && git push`) so the final integration is never a big bang. Merge commits on the epic branch are fine — they vanish at the final merge.
- **Child issues stay open at child-merge** (auto-close doesn't fire off-default-branch); their Status row flips to `Merged into epic`.
- **Close-out:** all children merged + epic CI green + user-confirmed epic smoke → one final PR `epic/<slug>` → `main` whose body carries `Closes #<parent>` and `Closes #<child>` for every child (the single closing event). Merge it **rebase-preferred** (keeps one commit per child on `main`; linear history) with squash as the conflict fallback, and pass `--delete-branch`.
- Branch protection for `epic/**` (require PRs + checks) is an optional manual settings step, not automated.

### Commits

- Conventional format: `type(scope): subject`
- Types: `feat`, `fix`, `test`, `docs`, `refactor`, `chore`
- Scopes: `web`, `api`, `core`, `db`, `smoke`. Comma-separate for cross-cutting changes — e.g. `fix(web,api): …`
- Reference the issue in the subject when there is one: `fix(web): swap interpret loader in (#63)`

### Pull requests

- **Merge style**: squash (matches existing history). The repo allows merge / rebase / squash but squash is the convention. Exception: the final epic → `main` PR is rebase-preferred (see "Epic branches").
- **Title**: short imperative, mirrors the lead commit.
- **Body**: two sections — `## Summary` (1–3 bullets) and `## Test plan` (checklist of what was / still needs to be verified). Reference the originating issue with `Closes #N` so it auto-closes on merge.
- `deleteBranchOnMerge` is **off** on the repo — always pass `--delete-branch` to `gh pr merge` so the remote branch is removed.

### The smoke gate

A PR merges only when **both** hold: CI is green, **and** the user has walked the ticket's manual smoke checklist (`docs/<SLUG>.smoke.md`, or the condensed doc's `## Smoke` section) against their own running stack and confirmed it. `/smoke` scaffolds the checklist from the spec's acceptance criteria with every box unchecked; checking boxes is the human's act — the agent never checks one and never merges on the user's behalf. Bugs found during the walk go through the smoke doc's bug-filing template, not ad-hoc fixes.

### After merge

- `git checkout main && git pull --ff-only origin main`
- `git remote prune origin` to drop tracking refs for deleted remote branches
- Local branches that were squash-merged need `git branch -D` (squash rewrites the SHA, so `-d` refuses)
- Run `git branch -vv` after pruning — anything still listed with a `gone` upstream or `ahead/behind` divergence is intentional kept work; confirm before deleting

### Branch protection on `main`

These are the protection rules `main` should carry. They are settings on the repo, not code in this branch — apply them via **Settings → Branches → Branch protection rules** on GitHub. Listing them here so the convention is documented and the rules can be re-applied if the repo is ever recreated.

- **Require a pull request before merging.** Direct pushes to `main` blocked.
- **Require status checks to pass before merging** — at minimum `unit-test` and `integration-test` (from `.github/workflows/`). Add new required checks as they're added to CI.
- **Require branches to be up to date before merging.** Prevents merging a PR that hasn't seen the latest `main`.
- **Require linear history.** Matches the squash convention; no merge commits on `main`.
- **Do not allow bypassing the above settings** — applies to administrators too. Force-push and deletion are off by default once protection is enabled.
- **Restrict who can push** is not needed if PR-required is on; everyone goes through PRs.

## Keeping Documentation in Sync with Capabilities

**Every feature or bugfix carries a standing check: is any documentation — user-facing *or* developer-facing — now out of sync with the application's actual capabilities?** A change anywhere (a renamed step, a changed validation rule, a new field, altered example output, a new script, a changed convention) can invalidate docs that describe the old behavior. Update every affected surface **in the same PR**. Stale docs are a **bug in this PR**, not a follow-up — wrong instructions to the *user* (user-facing copy) and wrong instructions to the *next contributor* (developer-facing docs) are equally bugs. Tools/toolpacks are one category below, not the framing.

### Documentation surfaces (the inventory)

**Structured user-facing Help** (surfaced in `apps/web/src/views/Help.view.tsx`)
- `apps/web/src/utils/glossary.util.ts` — term definitions, examples, related terms
- `apps/web/src/utils/faq.util.ts` — Q&A pairs
- `apps/web/src/utils/getting-started.util.ts` — onboarding steps + CTAs

**Agent / tool contract** (three places that drift independently)
- `apps/api/src/tools/<tool>.tool.ts` — the `description` field on the `Tool` subclass (the agent-facing contract). For pack tools, keep the **hand-authored mirror** in `packages/core/src/registries/builtin-toolpacks.ts` in sync (else the modal + `tools.service.ts` disagree); system tools (`current_time`, `station_context`) live only in the tool file — nothing to mirror.
- `apps/api/src/prompts/system.prompt.ts` — agent guidance (which tool to reach for, how to read a result, workflow ordering). Prefer making a tool's **output** unambiguous over prose alone — an LLM can misread guidance; it can't misread a field it must echo.

**In-workflow examples, helper text & sample references**
- `apps/web/src/workflows/FileUploadConnector/SampleFiles.component.tsx` — sample CSV/XLSX + descriptions
- `apps/web/src/workflows/RestApiConnector/TransformEditor.component.tsx` — `EXAMPLE_TRANSFORM`
- `apps/web/src/components/RegisterToolpackDialog.component.tsx` — webhook code examples (TS/Python/C#) + `AUTH_HEADER_BOILERPLATES`
- placeholder / `helperText` copy across the RestApi / FileUpload / GoogleSheets / MicrosoftExcel workflows
- validation messages in `apps/web/src/utils/record-field-serialization.util.ts`

**Developer-facing docs**
- `README.md` (root), `apps/web/README.md`, `apps/api/README.md`, `packages/core/README.md`, `packages/spreadsheet-parsing/README.md`
- `docs/*.md` design specs/plans, where they describe **shipped** behavior
- `docs/CUSTOM_TOOLPACK_INTEGRATION.md` — the custom-tool author contract
- `CLAUDE.md` itself, when a change alters a documented convention (and its mirror, `.github/copilot-instructions.md`)

### What changed → what to check

| You changed… | Re-check… |
|---|---|
| a new/renamed domain concept | `glossary.util.ts` + `faq.util.ts` |
| a workflow step, its inputs, or its order | that workflow's `helperText`/placeholder copy + `getting-started.util.ts` |
| an example's output, sample data, or boilerplate | the example/sample components (`SampleFiles`, `TransformEditor` `EXAMPLE_TRANSFORM`, `RegisterToolpackDialog`) |
| a validation rule or its message | `record-field-serialization.util.ts` (+ the field's `helperText`) |
| a tool (capability/input/semantics) | the three tool surfaces above (`.tool.ts` + `builtin-toolpacks.ts` mirror + `system.prompt.ts`) |
| the custom-tool wire/capability contract | `CUSTOM_TOOLPACK_INTEGRATION.md` + `RegisterToolpackDialog` |
| a convention, script, or setup step | the relevant `README.md` / `docs/*.md` / `CLAUDE.md` (+ `.github/copilot-instructions.md`) |

The pinning tests (`builtin-toolpacks.test.ts`, `system.prompt.test.ts`, `glossary.util.test.ts`, `faq.util.test.ts`) catch some drift — but not semantic drift or the prose surfaces. The check is yours, not the test suite's.

## Detailed Documentation

Each package has its own README with deeper documentation:
- `apps/web/README.md` — routing, auth flow, theming, testing, storybook
- `apps/api/README.md` — DB schema workflow, repositories, transactions, API style guide
- `packages/core/README.md` — model architecture, component library, theme system
