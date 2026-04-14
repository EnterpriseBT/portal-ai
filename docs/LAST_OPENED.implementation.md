# Implementation Plan: Portal `lastOpened` Timestamp

TDD implementation plan for the [feature spec](./LAST_OPENED.spec.md). Each step follows red-green-refactor: write a failing test, make it pass with minimal code, then clean up.

---

## Prerequisites

- Read the full spec: `docs/LAST_OPENED.spec.md`
- Ensure local database is running (`npm run db:push` or `npm run db:migrate`)
- Ensure all existing tests pass: `npm run test`

---

## Phase 1: Core Model (packages/core)

The Zod schema and model factory are the foundation. Everything downstream depends on `Portal` having a `lastOpened` field.

### Step 1.1 — RED: Add schema tests for `lastOpened`

**File**: `packages/core/src/__tests__/models/portal.model.test.ts`

Add tests inside the existing `PortalSchema` describe block:

```ts
it("should accept valid data with lastOpened as a number", () => {
  const data = {
    id: "p-1",
    created: Date.now(),
    createdBy: "user-1",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    organizationId: "org-1",
    stationId: "station-1",
    name: "Portal A",
    lastOpened: Date.now(),
  };
  const result = PortalSchema.safeParse(data);
  expect(result.success).toBe(true);
});

it("should accept lastOpened as null", () => {
  const data = {
    id: "p-1",
    created: Date.now(),
    createdBy: "user-1",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    organizationId: "org-1",
    stationId: "station-1",
    name: "Portal A",
    lastOpened: null,
  };
  const result = PortalSchema.safeParse(data);
  expect(result.success).toBe(true);
});
```

Update the `validPortalFields` helper to include `lastOpened: null`.

Add a test in the `PortalModelFactory > create` block:

```ts
it("should expose lastOpened in the schema shape", () => {
  const model = factory.create("user-1");
  expect(model.schema.shape).toHaveProperty("lastOpened");
});
```

**Run**: `cd packages/core && npm test -- --testPathPattern=portal.model`
**Expect**: Tests fail — `lastOpened` is not in the schema.

### Step 1.2 — GREEN: Add `lastOpened` to PortalSchema

**File**: `packages/core/src/models/portal.model.ts`

1. Add `lastOpened: z.number().nullable()` to `PortalSchema.extend({...})`

**Run**: `cd packages/core && npm test -- --testPathPattern=portal.model`
**Expect**: All tests pass.

### Step 1.3 — Verify type-check compilation

**Run**: `npm run type-check`
**Expect**: Compile error in `apps/api/src/db/schema/type-checks.ts` — the `IsAssignable` checks between `PortalSelect` (Drizzle) and `Portal` (Zod) will fail because the Drizzle table doesn't have `lastOpened` yet. This is expected and proves the dual-schema guard works.

---

## Phase 2: Database Schema (apps/api)

### Step 2.1 — GREEN: Add `lastOpened` column to Drizzle table

**File**: `apps/api/src/db/schema/portals.table.ts`

1. Add `bigint` import: `import { pgTable, text, bigint } from "drizzle-orm/pg-core";`
2. Add column: `lastOpened: bigint("last_opened", { mode: "number" }),`

**Run**: `npm run type-check`
**Expect**: Type checks pass — `PortalSelect` and `Portal` are now in sync.

### Step 2.2 — Generate and edit migration

1. Generate migration:
   ```bash
   cd apps/api && npm run db:generate -- --name add-portal-last-opened
   ```

2. Open the generated SQL file in `apps/api/drizzle/`. It will contain:
   ```sql
   ALTER TABLE "portals" ADD COLUMN "last_opened" bigint;
   ```

3. Append the backfill statement:
   ```sql
   UPDATE "portals" SET "last_opened" = "created" WHERE "last_opened" IS NULL;
   ```

4. Apply migration:
   ```bash
   npm run db:migrate
   ```

### Step 2.3 — Update portal service `createPortal()`

**File**: `apps/api/src/services/portal.service.ts`

In the `repo.portals.create({...})` call inside `createPortal()` (around line 270), add:

```ts
lastOpened: null,
```

This ensures new portals are created with `lastOpened: null` (set when the user first visits).

---

## Phase 3: API — PATCH endpoint (apps/api)

### Step 3.1 — RED: Add integration tests for PATCH with `lastOpened`

**File**: `apps/api/src/__tests__/__integration__/routes/portal.router.integration.test.ts`

Add tests inside the existing `PATCH /api/portals/:id` describe block:

```ts
it("updates lastOpened", async () => {
  const { organizationId } = await seedUserAndOrg(
    db as ReturnType<typeof drizzle>,
    AUTH0_ID
  );

  const station = createStation(organizationId);
  await (db as ReturnType<typeof drizzle>)
    .insert(stations)
    .values(station as never);

  const portal = createPortal(organizationId, station.id);
  await (db as ReturnType<typeof drizzle>)
    .insert(portals)
    .values(portal as never);

  const timestamp = Date.now();
  const res = await request(app)
    .patch(`/api/portals/${portal.id}`)
    .send({ lastOpened: timestamp })
    .expect(200);

  expect(res.body.payload.portal.lastOpened).toBe(timestamp);

  const [row] = await (db as ReturnType<typeof drizzle>)
    .select()
    .from(portals)
    .where(eq(portals.id, portal.id));
  expect(row.lastOpened).toBe(timestamp);
  expect(row.updated).not.toBeNull();
});

it("updates both name and lastOpened simultaneously", async () => {
  const { organizationId } = await seedUserAndOrg(
    db as ReturnType<typeof drizzle>,
    AUTH0_ID
  );

  const station = createStation(organizationId);
  await (db as ReturnType<typeof drizzle>)
    .insert(stations)
    .values(station as never);

  const portal = createPortal(organizationId, station.id);
  await (db as ReturnType<typeof drizzle>)
    .insert(portals)
    .values(portal as never);

  const timestamp = Date.now();
  const res = await request(app)
    .patch(`/api/portals/${portal.id}`)
    .send({ name: "New Name", lastOpened: timestamp })
    .expect(200);

  expect(res.body.payload.portal.name).toBe("New Name");
  expect(res.body.payload.portal.lastOpened).toBe(timestamp);
});

it("returns 400 when neither name nor lastOpened is provided", async () => {
  await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

  await request(app)
    .patch(`/api/portals/${generateId()}`)
    .send({})
    .expect(400);
});
```

Update the `createPortal` fixture helper to include `lastOpened: null`.

**Run**: `cd apps/api && npx jest --testPathPattern=portal.router.integration`
**Expect**: `updates lastOpened` fails (PATCH currently requires `name`). The `returns 400 when neither name nor lastOpened` test will also fail since the current handler only checks for `name`.

### Step 3.2 — GREEN: Extend PATCH handler to accept `lastOpened`

**File**: `apps/api/src/routes/portal.router.ts`

Replace the existing PATCH handler (lines 507–549) with the updated version from the spec. Key changes:

1. Destructure `{ name, lastOpened }` from `req.body`
2. Validate at least one field is present: `if (!name && lastOpened === undefined)`
3. Build `updates` object conditionally
4. Use `SystemUtilities.utc.now().getTime()` for the `updated` timestamp (add import if needed)

**Run**: `cd apps/api && npx jest --testPathPattern=portal.router.integration`
**Expect**: All PATCH tests pass, including the existing rename tests.

### Step 3.3 — Update OpenAPI docs for PATCH

**File**: `apps/api/src/routes/portal.router.ts`

Update the `@openapi` JSDoc block above the PATCH handler:
- Change `required: [name]` to remove the required constraint
- Add `lastOpened` property with type `number` and example

---

## Phase 4: API — GET list sorting (apps/api)

### Step 4.1 — RED: Add integration test for `sortBy=lastOpened`

**File**: `apps/api/src/__tests__/__integration__/routes/portal.router.integration.test.ts`

Add inside the `GET /api/portals` describe block:

```ts
it("sorts portals by lastOpened desc", async () => {
  const { organizationId } = await seedUserAndOrg(
    db as ReturnType<typeof drizzle>,
    AUTH0_ID
  );

  const station = createStation(organizationId);
  await (db as ReturnType<typeof drizzle>)
    .insert(stations)
    .values(station as never);

  const older = createPortal(organizationId, station.id, {
    name: "Older",
    lastOpened: now - 10000,
  });
  const newer = createPortal(organizationId, station.id, {
    name: "Newer",
    lastOpened: now,
  });

  await (db as ReturnType<typeof drizzle>)
    .insert(portals)
    .values([older as never, newer as never]);

  const res = await request(app)
    .get("/api/portals?sortBy=lastOpened&sortOrder=desc")
    .expect(200);

  const names = res.body.payload.portals.map((p: { name: string }) => p.name);
  expect(names[0]).toBe("Newer");
  expect(names[1]).toBe("Older");
});
```

**Run**: `cd apps/api && npx jest --testPathPattern=portal.router.integration`
**Expect**: Fails — the GET handler ignores `sortBy` and always sorts by `created`.

### Step 4.2 — GREEN: Map `sortBy` to column in GET handler

**File**: `apps/api/src/routes/portal.router.ts`

In the `GET /` handler (around line 192–196), replace the hardcoded `portals.created` with a dynamic column lookup:

```ts
const { limit, offset, sortOrder, sortBy, stationId } =
  PortalListRequestQuerySchema.parse(req.query);

// ... existing filter logic ...

const sortColumn =
  sortBy === "lastOpened" ? portals.lastOpened : portals.created;

const listOpts = {
  limit,
  offset,
  orderBy: { column: sortColumn, direction: sortOrder },
};
```

Note: `sortBy` is already parsed by `PaginationRequestQuerySchema` (defaults to `"created"`).

**Run**: `cd apps/api && npx jest --testPathPattern=portal.router.integration`
**Expect**: All GET tests pass.

### Step 4.3 — Update OpenAPI docs for GET list

**File**: `apps/api/src/routes/portal.router.ts`

Add `sortBy` parameter to the `@openapi` JSDoc block above the GET handler with enum `[created, lastOpened]`.

---

## Phase 5: Repository (apps/api)

### Step 5.1 — RED: Update `findRecentByOrg` integration test

**File**: `apps/api/src/__tests__/__integration__/db/repositories/portals.repository.integration.test.ts`

Update the existing `findRecentByOrg` tests. The `makePortal()` fixture helper needs `lastOpened` added. Then add a test:

```ts
it("returns portals ordered by lastOpened desc", async () => {
  const portal1 = makePortal({ lastOpened: now - 10000 });
  const portal2 = makePortal({ id: generateId(), lastOpened: now });

  await db.insert(portals).values([portal1 as never, portal2 as never]);

  const results = await repo.findRecentByOrg(orgId, 10, db);
  expect(results[0].lastOpened).toBe(now);
  expect(results[1].lastOpened).toBe(now - 10000);
});
```

**Run**: `cd apps/api && npx jest --testPathPattern=portals.repository.integration`
**Expect**: Fails — `findRecentByOrg` still orders by `created`.

### Step 5.2 — GREEN: Update `findRecentByOrg` to sort by `lastOpened`

**File**: `apps/api/src/db/repositories/portals.repository.ts`

Change the `orderBy` in `findRecentByOrg` from `this.cols.created` to `this.cols.lastOpened`:

```ts
{ limit, orderBy: { column: this.cols.lastOpened, direction: "desc" } },
```

**Run**: `cd apps/api && npx jest --testPathPattern=portals.repository.integration`
**Expect**: All repository tests pass.

---

## Phase 6: Frontend SDK (apps/web)

### Step 6.1 — RED: Add test for `touch` API method

**File**: `apps/web/src/__tests__/api/portals.api.test.ts`

Add a new describe block:

```ts
describe("touch", () => {
  it("sends PATCH to portal endpoint", () => {
    portals.touch("portal-123");
    expect(mockUseAuthMutation).toHaveBeenCalledWith({
      url: "/api/portals/portal-123",
      method: "PATCH",
    });
  });
});
```

**Run**: `cd apps/web && npm test -- --testPathPattern=portals.api`
**Expect**: Fails — `portals.touch` is not a function.

### Step 6.2 — GREEN: Add `touch` method to portals API

**File**: `apps/web/src/api/portals.api.ts`

Add after the `rename` method:

```ts
touch: (id: string) =>
  useAuthMutation<{ portal: { id: string } }, { lastOpened: number }>({
    url: `/api/portals/${encodeURIComponent(id)}`,
    method: "PATCH",
  }),
```

**Run**: `cd apps/web && npm test -- --testPathPattern=portals.api`
**Expect**: All API tests pass.

---

## Phase 7: Frontend — PortalCard (apps/web)

### Step 7.1 — RED: Update RecentPortalsList tests for `lastOpened` display

**File**: `apps/web/src/__tests__/RecentPortalsList.test.tsx`

Update the `makePortal` helper to include `lastOpened`:

```ts
const makePortal = (overrides: Partial<Portal> = {}): Portal => ({
  id: "portal-1",
  organizationId: "org-1",
  stationId: "station-1",
  name: "Sales Analysis",
  created: Date.now() - 3600000,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  lastOpened: null,
  ...overrides,
});
```

Add tests:

```ts
it("should render lastOpened timestamp when available", () => {
  const portal = makePortal({ lastOpened: Date.now() - 3600000 });
  render(<RecentPortalsListUI portals={[portal]} onPortalClick={jest.fn()} />);
  expect(screen.getByText("1h ago")).toBeInTheDocument();
});

it("should fall back to created when lastOpened is null", () => {
  const portal = makePortal({ lastOpened: null, created: Date.now() - 86400000 });
  render(<RecentPortalsListUI portals={[portal]} onPortalClick={jest.fn()} />);
  expect(screen.getByText("1d ago")).toBeInTheDocument();
});
```

**Run**: `cd apps/web && npm test -- --testPathPattern=RecentPortalsList`
**Expect**: Fails at compilation — `Portal` type doesn't yet have `lastOpened` in the test's imported type (it should pass once Phase 1 is done, but the display logic tests will validate fallback behavior).

### Step 7.2 — GREEN: Update `RecentPortalsList` component

**File**: `apps/web/src/components/RecentPortalsList.component.tsx`

1. Update the timestamp display (line 62) to prefer `lastOpened`:
   ```tsx
   {portal.lastOpened
     ? DateFactory.relativeTime(portal.lastOpened)
     : DateFactory.relativeTime(portal.created)}
   ```

2. Update the query (line 83) to sort by `lastOpened`:
   ```ts
   sortBy: "lastOpened",
   ```

**Run**: `cd apps/web && npm test -- --testPathPattern=RecentPortalsList`
**Expect**: All tests pass.

### Step 7.3 — GREEN: Update `PortalCard` component

**File**: `apps/web/src/components/PortalCard.component.tsx`

1. Add `lastOpened: number | null` to `PortalCardUIProps`
2. Add `lastOpened` to the destructured props
3. Update the display:
   ```tsx
   {lastOpened
     ? `Opened ${DateFactory.relativeTime(lastOpened)}`
     : `Created ${DateFactory.relativeTime(created)}`}
   ```

No dedicated PortalCard test file exists — the component is tested indirectly via StationDetail. Verify manually in browser.

---

## Phase 8: Frontend — Portal View touch-on-visit (apps/web)

### Step 8.1 — Implement touch mutation on portal visit

**File**: `apps/web/src/views/Portal.view.tsx`

Inside the `PortalView` component, after the existing mutation hooks:

1. Add `DateFactory` import from `@portalai/core/utils`
2. Add static `now()` method to `DateFactory` if it doesn't exist (see Step 8.2)
3. Add the touch mutation and effect:
   ```tsx
   const touchMutation = sdk.portals.touch(portalId);

   React.useEffect(() => {
     touchMutation.mutate(
       { lastOpened: DateFactory.now() },
       {
         onSuccess: () => {
           queryClient.invalidateQueries({ queryKey: queryKeys.portals.root });
         },
       }
     );
   }, [portalId]); // eslint-disable-line react-hooks/exhaustive-deps
   ```

### Step 8.2 — Add `DateFactory.now()` static method (if needed)

**File**: `packages/core/src/utils/date.factory.ts`

Check if `DateFactory` has a static `now()` method. If not, add it alongside `relativeTime`:

```ts
/** Returns the current Unix-ms timestamp. */
static now(): number {
  return Date.now();
}
```

Add a unit test in `packages/core/src/__tests__/utils/date.util.test.ts`:

```ts
describe("DateFactory.now", () => {
  it("returns a number close to Date.now()", () => {
    const before = Date.now();
    const result = DateFactory.now();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });
});
```

---

## Phase 9: Frontend — Station Detail sort option (apps/web)

### Step 9.1 — Update `StationDetail.view.tsx`

**File**: `apps/web/src/views/StationDetail.view.tsx`

1. Update `usePagination` config (line 123–127):
   ```ts
   const portalsPagination = usePagination({
     sortFields: [
       { field: "lastOpened", label: "Last Opened" },
       { field: "created", label: "Created" },
     ],
     defaultSortBy: "lastOpened",
     defaultSortOrder: "desc",
   });
   ```

2. Update `PortalCardUI` usage (line 243–257) to pass `lastOpened`:
   ```tsx
   <PortalCardUI
     key={portal.id}
     id={portal.id}
     name={portal.name}
     created={portal.created}
     lastOpened={portal.lastOpened}
     onClick={(id) => navigate({ to: `/portals/${id}` })}
     onDelete={(id) => setDeleteTarget({ id, name: portal.name })}
   />
   ```

---

## Phase 10: Smoke test

### Step 10.1 — Run full test suite

```bash
npm run test
npm run type-check
npm run lint
```

Fix any failures.

### Step 10.2 — Manual browser verification

```bash
npm run dev
```

1. Open http://localhost:3000
2. Navigate to a station detail page
3. Verify the Sort popover shows "Last Opened" and "Created" options, with "Last Opened" selected by default
4. Open a portal session — verify the page loads normally
5. Navigate back to the station detail page — verify the portal card shows "Opened just now"
6. Verify the dashboard "Recent Portals" widget shows portals sorted by last opened
7. Create a new portal — verify it appears in the list (with `lastOpened` null, showing "Created ..." until first visit)

---

## Step Execution Order

| Step | Package | What | Test Command |
|------|---------|------|--------------|
| 1.1–1.2 | core | Add `lastOpened` to PortalSchema | `cd packages/core && npm test -- --testPathPattern=portal.model` |
| 1.3 | monorepo | Verify type-check fails (expected) | `npm run type-check` |
| 2.1 | api | Add column to Drizzle table | `npm run type-check` |
| 2.2 | api | Generate + edit migration | `cd apps/api && npm run db:generate && npm run db:migrate` |
| 2.3 | api | Update `createPortal()` | — |
| 3.1–3.2 | api | PATCH accepts `lastOpened` | `cd apps/api && npx jest --testPathPattern=portal.router.integration` |
| 3.3 | api | Update OpenAPI docs | — |
| 4.1–4.2 | api | GET sorts by `lastOpened` | `cd apps/api && npx jest --testPathPattern=portal.router.integration` |
| 4.3 | api | Update OpenAPI docs | — |
| 5.1–5.2 | api | `findRecentByOrg` sort | `cd apps/api && npx jest --testPathPattern=portals.repository.integration` |
| 6.1–6.2 | web | `touch` SDK method | `cd apps/web && npm test -- --testPathPattern=portals.api` |
| 7.1–7.3 | web | PortalCard + RecentPortalsList | `cd apps/web && npm test -- --testPathPattern=RecentPortalsList` |
| 8.1–8.2 | core/web | Touch-on-visit + DateFactory.now | `cd packages/core && npm test -- --testPathPattern=date.util` |
| 9.1 | web | StationDetail sort config | — |
| 10.1 | monorepo | Full test suite | `npm run test && npm run type-check && npm run lint` |
| 10.2 | — | Manual browser smoke test | `npm run dev` |

---

## Key Principles

- **Tests first**: Every production change is preceded by a failing test
- **Small increments**: Each step changes 1–2 files. Commit after each green phase if desired
- **Type system as safety net**: The dual-schema `type-checks.ts` guards catch Zod/Drizzle drift at compile time — lean on it
- **Existing patterns**: Follow the codebase's conventions for fixtures (`makePortal`, `createPortal`), mocking (`jest.unstable_mockModule`), and assertions
- **Bottom-up**: Core model first, then DB, then API, then frontend — each layer builds on the one below
