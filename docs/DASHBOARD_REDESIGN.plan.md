# Dashboard Redesign - TDD Implementation Plan

Each step follows the Red-Green-Refactor cycle: write a failing test first, implement the minimum code to make it pass, then refactor. Steps are ordered so each builds on the last with the test suite staying green.

---

## Step 1: Contract - Add `include` and extended response fields

**Files:**
- `packages/core/src/contracts/portal.contract.ts`

**Changes:**

1. Add `include: z.string().optional()` to `PortalListRequestQuerySchema` (line 13)
2. Create `PortalWithIncludesSchema = PortalSchema.extend({ stationName: z.string().optional() })` and use it in `PortalListResponsePayloadSchema` (line 21)
3. `PortalResultListRequestQuerySchema` inherits `include` automatically since it extends `PortalListRequestQuerySchema` -- verify no duplication needed
4. Create `PortalResultWithIncludesSchema = PortalResultSchema.extend({ portalName: z.string().nullable().optional() })` for documentation/frontend typing -- export the inferred type

**Verification:** `npm run type-check` from repo root

---

## Step 2: Backend - Portal repository `include=station` LEFT JOIN

### 2a: Write failing integration test

**File:** `apps/api/src/__tests__/__integration__/routes/portal.router.integration.test.ts`

Add test inside the existing `describe("GET /api/portals")` block (after line ~260):

```typescript
it("attaches stationName when include=station", async () => {
  const { organizationId } = await seedUserAndOrg(
    db as ReturnType<typeof drizzle>,
    AUTH0_ID
  );

  const station = createStation(organizationId, { name: "Research Lab" });
  await (db as ReturnType<typeof drizzle>)
    .insert(stations)
    .values(station as never);

  const portal = createPortal(organizationId, station.id);
  await (db as ReturnType<typeof drizzle>)
    .insert(portals)
    .values(portal as never);

  const res = await request(app)
    .get("/api/portals?include=station")
    .expect(200);

  expect(res.body.payload.portals).toHaveLength(1);
  expect(res.body.payload.portals[0].stationName).toBe("Research Lab");
});

it("omits stationName when include is absent", async () => {
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

  const res = await request(app).get("/api/portals").expect(200);

  expect(res.body.payload.portals[0]).not.toHaveProperty("stationName");
});
```

**Run:** `npm run test:integration` from `apps/api/` -- both tests FAIL (RED)

### 2b: Implement repository LEFT JOIN

**File:** `apps/api/src/db/repositories/portals.repository.ts`

1. Add imports: `asc`, `getTableColumns`, `type SQL` from `drizzle-orm`; `stations` from `../schema/index.js`
2. Override `findMany` to check `opts.include?.includes("station")` and dispatch to private `findManyWithStation`
3. Implement `findManyWithStation`:
   - `select({ portal: getTableColumns(portals), stationName: stations.name })`
   - `.from(portals).leftJoin(stations, eq(portals.stationId, stations.id))`
   - Apply `this.withSoftDelete()`, ordering, limit, offset
   - Map rows to `{ ...row.portal, stationName: row.stationName }`

**Pattern reference:** `apps/api/src/db/repositories/connector-instances.repository.ts:132-175`

### 2c: Implement router parsing

**File:** `apps/api/src/routes/portal.router.ts`

1. Destructure `include` from `PortalListRequestQuerySchema.parse(req.query)` (line 190)
2. Parse: `const include_ = include?.split(",").map((s) => s.trim()).filter(Boolean);`
3. Add `include: include_` to `listOpts` (line 203)

**Run:** `npm run test:integration` from `apps/api/` -- both tests PASS (GREEN)

**Run:** `npm run type-check` -- passes

---

## Step 3: Backend - Portal results repository `include=portal` LEFT JOIN

### 3a: Write failing integration test

**File:** `apps/api/src/__tests__/__integration__/routes/portal-results.router.integration.test.ts`

Add test inside the existing `describe("GET /api/portal-results")` block (after line ~304):

```typescript
it("attaches portalName when include=portal", async () => {
  const { organizationId } = await seedUserAndOrg(
    db as ReturnType<typeof drizzle>,
    AUTH0_ID
  );

  const station = createStation(organizationId);
  await (db as ReturnType<typeof drizzle>)
    .insert(stations)
    .values(station as never);

  const portal = createPortal(organizationId, station.id);
  (portal as Record<string, unknown>).name = "Sales Portal";
  await (db as ReturnType<typeof drizzle>)
    .insert(portals)
    .values(portal as never);

  const result = createPortalResult(organizationId, station.id, portal.id);
  await (db as ReturnType<typeof drizzle>)
    .insert(portalResults)
    .values(result as never);

  const res = await request(app)
    .get("/api/portal-results?include=portal")
    .expect(200);

  expect(res.body.payload.portalResults).toHaveLength(1);
  expect(res.body.payload.portalResults[0].portalName).toBe("Sales Portal");
});

it("returns portalName as null when portalId is null", async () => {
  const { organizationId } = await seedUserAndOrg(
    db as ReturnType<typeof drizzle>,
    AUTH0_ID
  );

  const station = createStation(organizationId);
  await (db as ReturnType<typeof drizzle>)
    .insert(stations)
    .values(station as never);

  const result = createPortalResult(organizationId, station.id, null as unknown as string, {
    portalId: null,
  });
  await (db as ReturnType<typeof drizzle>)
    .insert(portalResults)
    .values(result as never);

  const res = await request(app)
    .get("/api/portal-results?include=portal")
    .expect(200);

  expect(res.body.payload.portalResults).toHaveLength(1);
  expect(res.body.payload.portalResults[0].portalName).toBeNull();
});

it("omits portalName when include is absent", async () => {
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

  const result = createPortalResult(organizationId, station.id, portal.id);
  await (db as ReturnType<typeof drizzle>)
    .insert(portalResults)
    .values(result as never);

  const res = await request(app).get("/api/portal-results").expect(200);

  expect(res.body.payload.portalResults[0]).not.toHaveProperty("portalName");
});
```

**Run:** `npm run test:integration` from `apps/api/` -- new tests FAIL (RED)

### 3b: Implement repository LEFT JOIN

**File:** `apps/api/src/db/repositories/portal-results.repository.ts`

1. Add imports: `desc`, `asc`, `getTableColumns`, `type SQL` from `drizzle-orm`; `portals` from `../schema/index.js`
2. Override `findMany` to check `opts.include?.includes("portal")` and dispatch to private `findManyWithPortal`
3. Implement `findManyWithPortal`:
   - `select({ result: getTableColumns(portalResults), portalName: portals.name })`
   - `.from(portalResults).leftJoin(portals, eq(portalResults.portalId, portals.id))`
   - Apply `this.withSoftDelete()`, ordering, limit, offset
   - Map rows to `{ ...row.result, portalName: row.portalName }`

### 3c: Implement router parsing

**File:** `apps/api/src/routes/portal-results.router.ts`

1. Destructure `include` from `PortalResultListRequestQuerySchema.parse(req.query)` (line 255)
2. Parse: `const include_ = include?.split(",").map((s) => s.trim()).filter(Boolean);`
3. Add `include: include_` to `listOpts` (line 273)

**Run:** `npm run test:integration` from `apps/api/` -- all tests PASS (GREEN)

**Run:** `npm run type-check` -- passes

---

## Step 4: Frontend API types - Add `include` to params

**File:** `apps/web/src/api/portal-results.api.ts`

Add `include?: string` to the `PortalResultsListParams` type (line 8).

The portal list hook already uses `PortalListRequestQuery` from the contract, which now includes `include` after Step 1.

**Run:** `npm run type-check` from repo root -- passes

---

## Step 5: Frontend - Recent Portals List: station name + delete button

### 5a: Update existing tests and write new ones (RED)

**File:** `apps/web/src/__tests__/RecentPortalsList.test.tsx`

Update `makePortal` factory to support `stationName`:

```typescript
const makePortal = (overrides: Partial<Portal & { stationName?: string }> = {}): Portal & { stationName?: string } => ({
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

Update `defaultProps` to include `onDeletePortal`:

```typescript
const defaultProps = {
  portals: [portal1, portal2],
  onPortalClick: jest.fn(),
  onDeletePortal: jest.fn(),
};
```

Add new tests:

```typescript
it("should render station name when stationName is provided", () => {
  const portal = makePortal({ stationName: "Research Station" });
  render(
    <RecentPortalsListUI
      portals={[portal]}
      onPortalClick={jest.fn()}
      onDeletePortal={jest.fn()}
    />
  );
  expect(screen.getByText("Research Station")).toBeInTheDocument();
});

it("should not render station name when stationName is absent", () => {
  const portal = makePortal();
  render(
    <RecentPortalsListUI
      portals={[portal]}
      onPortalClick={jest.fn()}
      onDeletePortal={jest.fn()}
    />
  );
  expect(screen.queryByText("Research Station")).not.toBeInTheDocument();
});

it("should call onDeletePortal with id and name when delete button is clicked", () => {
  const onDeletePortal = jest.fn();
  render(
    <RecentPortalsListUI {...defaultProps} onDeletePortal={onDeletePortal} />
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Delete portal" })[0]);
  expect(onDeletePortal).toHaveBeenCalledWith("portal-1", "Sales Analysis");
});

it("should not trigger onPortalClick when delete button is clicked", () => {
  const onPortalClick = jest.fn();
  const onDeletePortal = jest.fn();
  render(
    <RecentPortalsListUI
      {...defaultProps}
      onPortalClick={onPortalClick}
      onDeletePortal={onDeletePortal}
    />
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Delete portal" })[0]);
  expect(onDeletePortal).toHaveBeenCalled();
  expect(onPortalClick).not.toHaveBeenCalled();
});

it("should render a delete button for each portal", () => {
  render(<RecentPortalsListUI {...defaultProps} />);
  expect(screen.getAllByRole("button", { name: "Delete portal" })).toHaveLength(2);
});
```

**Run:** `npm run test` from `apps/web/` -- new tests FAIL (RED) because `onDeletePortal` isn't a prop yet and no delete button exists

### 5b: Implement component changes (GREEN)

**File:** `apps/web/src/components/RecentPortalsList.component.tsx`

1. Add imports: `IconButton` from `@mui/material/IconButton`, `DeleteIcon` from `@mui/icons-material/Delete`
2. Update `RecentPortalsListUIProps`:
   - `portals: (Portal & { stationName?: string | null })[]`
   - Add `onDeletePortal: (portalId: string, portalName: string) => void`
3. Update card rendering to include station name text and delete `IconButton`
4. Use `e.stopPropagation()` on delete button click
5. Update `RecentPortalsListConnectedProps` to add `onDeletePortal`
6. Pass through in connected component
7. Update `RecentPortalData` to pass `include: "station"` to the query

**Run:** `npm run test` from `apps/web/` -- all tests PASS (GREEN)

---

## Step 6: Frontend - Pinned Results List: portal name

### 6a: Update existing tests and write new ones (RED)

**File:** `apps/web/src/__tests__/PinnedResultsList.test.tsx`

Update `makePinnedResult` factory:

```typescript
const makePinnedResult = (
  overrides: Partial<PortalResult & { portalName?: string | null }> = {}
): PortalResult & { portalName?: string | null } => ({
  // ... existing fields ...
  ...overrides,
});
```

Add new tests to `describe("PinnedResultCardUI")`:

```typescript
it("should render portal name when portalName is provided", () => {
  const result = makePinnedResult({ portalName: "Research Portal" });
  render(
    <PinnedResultCardUI result={result} onResultClick={jest.fn()} onUnpin={jest.fn()} />
  );
  expect(screen.getByText("from Research Portal")).toBeInTheDocument();
});

it("should not render portal name when portalName is null", () => {
  const result = makePinnedResult({ portalName: null });
  render(
    <PinnedResultCardUI result={result} onResultClick={jest.fn()} onUnpin={jest.fn()} />
  );
  expect(screen.queryByText(/from/)).not.toBeInTheDocument();
});

it("should not render portal name when portalName is absent", () => {
  const result = makePinnedResult();
  render(
    <PinnedResultCardUI result={result} onResultClick={jest.fn()} onUnpin={jest.fn()} />
  );
  expect(screen.queryByText(/from/)).not.toBeInTheDocument();
});
```

**Run:** `npm run test` from `apps/web/` -- new tests FAIL (RED)

### 6b: Implement component changes (GREEN)

**File:** `apps/web/src/components/PinnedResultsList.component.tsx`

1. Update `PinnedResultCardUIProps` to extend result type with `portalName?: string | null`
2. Update `PinnedResultsListUIProps` similarly
3. Add portal name rendering: `{result.portalName && <Typography variant="caption" color="text.secondary">from {result.portalName}</Typography>}`
4. Update `PinnedResultsData` to pass `include: "portal"` to the query

**Run:** `npm run test` from `apps/web/` -- all tests PASS (GREEN)

---

## Step 7: Frontend - Dashboard view redesign

### 7a: Write tests for the redesigned dashboard (RED)

**File:** `apps/web/src/__tests__/DashboardView.test.tsx` (NEW)

This is a new test file for the dashboard container. Follow the project's mutable mock state pattern from `PinnedResultsListView.test.tsx`.

```typescript
import { jest } from "@jest/globals";
import type { Portal } from "@portalai/core/models";
import type { PortalResult } from "@portalai/core/models";

// ── Mutable mock state ──────────────────────────────────────────────

let portalListQuery: Record<string, unknown> = {};
let pinnedResultListQuery: Record<string, unknown> = {};
let mockFetchWithAuth: jest.Mock;

jest.unstable_mockModule("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    getAccessTokenSilently: jest.fn().mockResolvedValue("test-token"),
    isAuthenticated: true,
    user: { sub: "user-1" },
  }),
}));

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    portals: {
      list: () => portalListQuery,
      create: () => ({ mutate: jest.fn(), isPending: false, error: null }),
    },
    portalResults: {
      list: () => pinnedResultListQuery,
    },
    organizations: {
      current: () => ({
        data: { organization: { id: "org-1", defaultStationId: "station-1" } },
        isLoading: false,
        isSuccess: true,
      }),
    },
    stations: {
      list: () => ({
        data: { stations: [], total: 0 },
        isLoading: false,
        isSuccess: true,
      }),
    },
  },
  queryKeys: {
    portals: { root: ["portals"], list: () => ["portals", "list"] },
    portalResults: { root: ["portalResults"], list: () => ["portalResults", "list"] },
    organizations: { root: ["organizations"] },
    stations: { root: ["stations"] },
  },
}));

jest.unstable_mockModule("../utils/api.util", () => ({
  useAuthFetch: () => ({ fetchWithAuth: mockFetchWithAuth }),
  toServerError: () => null,
}));

const { render, screen, fireEvent } = await import("./test-utils");
const { DashboardViewUI } = await import("../views/Dashboard.view");

// ── Factories ───────────────────────────────────────────────────────

const makePortal = (overrides: Partial<Portal & { stationName?: string }> = {}): Portal & { stationName?: string } => ({
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
  lastOpened: Date.now() - 1800000,
  ...overrides,
});

// ── Tests ───────────────────────────────────────────────────────────

const defaultUIProps = {
  onNewPortal: jest.fn(),
  onPortalClick: jest.fn(),
  onDeletePortal: jest.fn(),
  onResultClick: jest.fn(),
  onUnpin: jest.fn(),
  onViewAllResults: jest.fn(),
};

describe("DashboardViewUI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchWithAuth = jest.fn();
  });

  it("renders Recent Portals section", () => {
    render(<DashboardViewUI {...defaultUIProps} />);
    expect(screen.getByText("Recent Portals")).toBeInTheDocument();
  });

  it("renders Pinned Results section", () => {
    render(<DashboardViewUI {...defaultUIProps} />);
    expect(screen.getByText("Pinned Results")).toBeInTheDocument();
  });

  it("does not render Default Station section", () => {
    render(<DashboardViewUI {...defaultUIProps} />);
    expect(screen.queryByText("Default Station")).not.toBeInTheDocument();
  });

  it("renders Launch New Portal button", () => {
    render(<DashboardViewUI {...defaultUIProps} />);
    expect(screen.getByRole("button", { name: /Launch New Portal/i })).toBeInTheDocument();
  });

  it("calls onNewPortal when Launch New Portal is clicked", () => {
    const onNewPortal = jest.fn();
    render(<DashboardViewUI {...defaultUIProps} onNewPortal={onNewPortal} />);
    fireEvent.click(screen.getByRole("button", { name: /Launch New Portal/i }));
    expect(onNewPortal).toHaveBeenCalled();
  });
});
```

**Run:** `npm run test` from `apps/web/` -- tests FAIL (RED) because `DashboardViewUI` still has old props and Default Station section

### 7b: Implement dashboard view changes (GREEN)

**File:** `apps/web/src/views/Dashboard.view.tsx`

1. **Remove** imports: `DefaultStationCardConnected`
2. **Add** imports: `PinnedResultsListConnected`, `DeletePortalDialog`, `useAuthFetch`
3. **Update `DashboardViewUIProps`**: Remove `onLaunchPortal`, `onChangeDefault`, `onViewStation`. Add `onDeletePortal`, `onResultClick`, `onUnpin`, `onViewAllResults`.
4. **Update `DashboardViewUI` JSX**:
   - Remove the `PageGridItem` + `PageSection` for Default Station
   - Change `PageGrid columns` to `{{ xs: 1 }}` (single column)
   - Make Recent Portals `PageGridItem` span full width, pass `onDeletePortal` to `RecentPortalsListConnected`
   - Add new `PageGridItem` + `PageSection` for Pinned Results with `PinnedResultsListConnected`
5. **Update `DashboardView` container**:
   - Remove `handleLaunchPortal`, `handleChangeDefault`, `handleViewStation`
   - Add `deleteTarget` state, `deletePending`/`deleteError` state
   - Add `handleDeletePortal`, `handleDeleteClose`, `handleDeleteConfirm` using `fetchWithAuth`
   - Add `handleUnpin` using `fetchWithAuth`
   - Add `handleResultClick`, `handleViewAllResults` navigation handlers
   - Render `DeletePortalDialog` conditionally on `deleteTarget`
   - Pass all new callbacks to `DashboardViewUI`

**Run:** `npm run test` from `apps/web/` -- all tests PASS (GREEN)

### 7c: Refactor

Review the container for clarity. Ensure:
- `fetchWithAuth` error handling sets `deleteError` for `FormAlert` in `DeletePortalDialog`
- Query invalidation keys match: `queryKeys.portals.root`, `queryKeys.portalResults.root`
- No unused imports remain

---

## Step 8: Full verification

Run all checks from the repo root:

```bash
npm run type-check        # TypeScript across all packages
npm run lint              # ESLint across monorepo
npm run test              # Unit tests (all packages)
```

If integration tests are available locally:

```bash
cd apps/api && npm run test:integration
```

---

## Step 9: Manual browser testing

Start dev servers:

```bash
npm run dev
```

### Test matrix

| # | Action | Expected |
|---|--------|----------|
| 1 | Open dashboard (`/`) | See "Recent Portals" section with portal cards showing station name. See "Pinned Results" section with result cards showing portal name. No "Default Station" card. |
| 2 | Verify portal card metadata | Each card shows: portal name (bold), station name (caption), relative time, delete icon button |
| 3 | Verify pinned result card metadata | Each card shows: result name, type icon, "from {portalName}" (caption), relative time, unpin button |
| 4 | Click a portal card | Navigates to `/portals/:id` |
| 5 | Click delete on a portal | `DeletePortalDialog` opens with portal name. Cancel closes dialog without deleting. |
| 6 | Confirm delete on a portal | Portal disappears from list. Dialog closes. |
| 7 | Click a pinned result card | Navigates to `/portal-results/:id` |
| 8 | Click unpin on a result | Result disappears from list |
| 9 | Click "View All" on Pinned Results | Navigates to `/portal-results` |
| 10 | Click "Launch New Portal" | `CreatePortalDialog` opens with station picker prefilled to default station |
| 11 | Create a new portal | Dialog closes, navigates to new portal |
| 12 | Empty states | Dashboard with no portals shows "No portals yet". Dashboard with no pinned results shows "No pinned results yet" |
| 13 | Deleted portal with pinned results | Deleting a portal invalidates both portal and result caches. Pinned results from that portal still show (they survive portal deletion) but `portalName` may become null. |

---

## Summary: File change order

| Order | File | Test file | Phase |
|-------|------|-----------|-------|
| 1 | `packages/core/src/contracts/portal.contract.ts` | (type-check) | Contract |
| 2 | `apps/api/src/db/repositories/portals.repository.ts` | `portal.router.integration.test.ts` | Backend |
| 3 | `apps/api/src/routes/portal.router.ts` | `portal.router.integration.test.ts` | Backend |
| 4 | `apps/api/src/db/repositories/portal-results.repository.ts` | `portal-results.router.integration.test.ts` | Backend |
| 5 | `apps/api/src/routes/portal-results.router.ts` | `portal-results.router.integration.test.ts` | Backend |
| 6 | `apps/web/src/api/portal-results.api.ts` | (type-check) | Frontend API |
| 7 | `apps/web/src/components/RecentPortalsList.component.tsx` | `RecentPortalsList.test.tsx` | Frontend UI |
| 8 | `apps/web/src/components/PinnedResultsList.component.tsx` | `PinnedResultsList.test.tsx` | Frontend UI |
| 9 | `apps/web/src/views/Dashboard.view.tsx` | `DashboardView.test.tsx` (new) | Frontend UI |
