# Feature Spec: Portal `lastOpened` Timestamp

## Overview

Add a `lastOpened` timestamp to portals that records the most recent time a user visited/launched a portal session. Portals should be sortable by `lastOpened` in addition to `created`.

## Requirements

- `lastOpened` is a nullable `bigint` column (epoch milliseconds) on the `portals` table
- Migration defaults `lastOpened` to the portal's `created` date for all existing rows
- When a user visits a portal session (navigates to the portal view), the frontend fires a `PATCH /api/portals/:id` to update `lastOpened`
- Everywhere portals are listed, `lastOpened` desc is the default sort order
- Portal cards display the `lastOpened` timestamp when available

---

## 1. Database Schema

### `packages/core/src/models/portal.model.ts`

Add `lastOpened` to `PortalSchema`:

```ts
export const PortalSchema = CoreSchema.extend({
  organizationId: z.string(),
  stationId: z.string(),
  name: z.string().min(1),
  lastOpened: z.number().nullable(),
});
```

Update `PortalModelFactory.create()` to initialize `lastOpened: null`.

### `apps/api/src/db/schema/portals.table.ts`

Add column:

```ts
import { pgTable, text, bigint } from "drizzle-orm/pg-core";

export const portals = pgTable("portals", {
  ...baseColumns,
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  stationId: text("station_id").notNull().references(() => stations.id),
  name: text("name").notNull(),
  lastOpened: bigint("last_opened", { mode: "number" }),
});
```

### Migration

Generate with: `npm run db:generate -- --name add-portal-last-opened`

The generated migration will add a nullable `last_opened` column. After generation, manually edit the migration SQL to backfill existing rows:

```sql
ALTER TABLE "portals" ADD COLUMN "last_opened" bigint;
UPDATE "portals" SET "last_opened" = "created" WHERE "last_opened" IS NULL;
```

### `apps/api/src/db/schema/zod.ts`

No changes — `createSelectSchema(portals)` / `createInsertSchema(portals)` auto-derive from the updated table.

### `apps/api/src/db/schema/type-checks.ts`

No changes — existing bidirectional `IsAssignable` checks between `PortalSelect` and `Portal` will fail at compile time if the schemas don't match, enforcing the dual-schema contract.

---

## 2. API Changes

### `PATCH /api/portals/:id` — extend existing endpoint

**Current behavior**: Accepts `{ name: string }` to rename a portal.

**New behavior**: Accepts `{ name?: string, lastOpened?: number }`. At least one field must be present. When `lastOpened` is provided, update the `lastOpened` column.

**File**: `apps/api/src/routes/portal.router.ts` (lines 507–549)

Update the PATCH handler:

```ts
portalRouter.patch(
  "/:id",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { organizationId, userId } = req.application!.metadata;

    const { name, lastOpened } = req.body as {
      name?: string;
      lastOpened?: number;
    };

    // Require at least one field
    if (!name && lastOpened === undefined) {
      return next(new ApiError(400, ApiCode.PORTAL_NOT_FOUND, "name or lastOpened is required"));
    }

    const existing = await DbService.repository.portals.findById(id);
    if (!existing || existing.organizationId !== organizationId) {
      return next(new ApiError(404, ApiCode.PORTAL_NOT_FOUND, "Portal not found"));
    }

    const now = SystemUtilities.utc.now().getTime();
    const updates: Record<string, unknown> = {
      updated: now,
      updatedBy: userId,
    };
    if (name && typeof name === "string" && name.trim() !== "") {
      updates.name = name.trim();
    }
    if (typeof lastOpened === "number") {
      updates.lastOpened = lastOpened;
    }

    const portal = await DbService.repository.portals.update(id, updates as never);
    return HttpService.success(res, { portal });
  }
);
```

### `GET /api/portals` — support `sortBy=lastOpened`

**File**: `apps/api/src/routes/portal.router.ts` (lines 177–221)

The `PaginationRequestQuerySchema` already parses `sortBy` as a string (default `"created"`). Update the list handler to map `sortBy` to the correct column:

```ts
const sortColumn =
  sortBy === "lastOpened" ? portals.lastOpened : portals.created;

const listOpts = {
  limit,
  offset,
  orderBy: { column: sortColumn, direction: sortOrder },
};
```

**Note**: When `sortBy=lastOpened`, the base repository's `findMany` will use `SQL` ordering with `NULLS LAST` for the nullable column (see `base.repository.ts` lines 157–163). Since we backfill all existing rows, NULLs should only appear for portals created between migration and code deploy — an acceptable edge case.

---

## 3. Portal Service

### `apps/api/src/services/portal.service.ts`

In `createPortal()` (line 270–281), add `lastOpened: null` to the `create` call:

```ts
const portal = await repo.portals.create({
  id: SystemUtilities.id.v4.generate(),
  organizationId,
  stationId,
  name,
  lastOpened: null,
  created: now,
  createdBy: userId,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
});
```

`lastOpened` is `null` at creation. It gets set when the user first visits the portal view.

---

## 4. Frontend SDK

### `apps/web/src/api/portals.api.ts`

Add a `touch` mutation that PATCHes `lastOpened`:

```ts
touch: (id: string) =>
  useAuthMutation<{ portal: { id: string } }, { lastOpened: number }>({
    url: `/api/portals/${encodeURIComponent(id)}`,
    method: "PATCH",
  }),
```

---

## 5. Frontend — Portal View (trigger update)

### `apps/web/src/views/Portal.view.tsx`

When the portal view mounts and portal data loads, fire the `touch` mutation to update `lastOpened`:

```tsx
const touchMutation = sdk.portals.touch(portalId);

// Fire once when portal data loads
React.useEffect(() => {
  touchMutation.mutate(
    { lastOpened: DateFactory.now() },
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.portals.root });
      },
    }
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [portalId]);
```

> **Note**: `DateFactory.now()` returns the current epoch-ms timestamp using the project's date utility, keeping frontend code consistent with `DateFactory` usage elsewhere. If a static `.now()` method doesn't yet exist on `DateFactory`, add one: `static now(): number { return Date.now(); }`.

Place this inside the `PortalView` component body, after the existing mutation hooks. The `useEffect` triggers once per portal visit (keyed on `portalId`).

---

## 6. Frontend — Station Detail View (sort option)

### `apps/web/src/views/StationDetail.view.tsx`

Update `usePagination` config (line 123–127) to add the `lastOpened` sort field:

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

This adds a "Last Opened" radio option in the Sort popover of `PaginationToolbar` and makes it the default. The `sortBy` value flows through `queryParams` to the API automatically.

### `apps/web/src/components/RecentPortalsList.component.tsx`

The dashboard "Recent Portals" widget (line 80–85) hardcodes `sortBy: "created"`. Update to sort by `lastOpened`:

```ts
const res = sdk.portals.list({
  limit: 5,
  offset: 0,
  sortBy: "lastOpened",
  sortOrder: "desc",
});
```

Also update the timestamp display (line 62) to show `lastOpened` when available:

```tsx
<Typography variant="caption" color="text.secondary" sx={{ ml: 2, flexShrink: 0 }}>
  {portal.lastOpened
    ? DateFactory.relativeTime(portal.lastOpened)
    : DateFactory.relativeTime(portal.created)}
</Typography>
```

### `apps/api/src/db/repositories/portals.repository.ts`

`findRecentByOrg` (line 34–44) hardcodes ordering by `this.cols.created`. Update to order by `lastOpened`:

```ts
async findRecentByOrg(
  organizationId: string,
  limit: number = 10,
  client: DbClient = db
): Promise<PortalSelect[]> {
  return this.findMany(
    eq(portals.organizationId, organizationId),
    { limit, orderBy: { column: this.cols.lastOpened, direction: "desc" } },
    client
  );
}
```

---

## 7. Frontend — Portal Card (display)

### `apps/web/src/components/PortalCard.component.tsx`

Add `lastOpened` prop and display it:

```tsx
interface PortalCardUIProps {
  id: string;
  name: string;
  created: number;
  lastOpened: number | null;
  onClick: (id: string) => void;
  onDelete: (id: string) => void;
}

export const PortalCardUI: React.FC<PortalCardUIProps> = ({
  id, name, created, lastOpened, onClick, onDelete,
}) => {
  const actions: ActionSuiteItem[] = [
    { label: "Delete", icon: <DeleteIcon />, onClick: () => onDelete(id), color: "error" },
  ];

  return (
    <DetailCard title={name} onClick={() => onClick(id)} actions={actions} data-testid={`portal-card-${id}`}>
      <Typography variant="caption" color="text.secondary">
        {lastOpened
          ? `Opened ${DateFactory.relativeTime(lastOpened)}`
          : `Created ${DateFactory.relativeTime(created)}`}
      </Typography>
    </DetailCard>
  );
};
```

### `apps/web/src/views/StationDetail.view.tsx`

Update the `PortalCardUI` usage (line 243–257) to pass `lastOpened`:

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

## 8. OpenAPI Documentation

Update the PATCH endpoint docs in `portal.router.ts` to reflect the new optional `lastOpened` field:

```yaml
requestBody:
  required: true
  content:
    application/json:
      schema:
        type: object
        properties:
          name:
            type: string
            example: Updated Portal Name
          lastOpened:
            type: number
            example: 1713100800000
```

Update the GET list endpoint docs to document `sortBy`:

```yaml
parameters:
  - in: query
    name: sortBy
    schema:
      type: string
      enum: [created, lastOpened]
    description: Field to sort portals by
```

---

## Files Changed Summary

| File | Change |
|------|--------|
| `packages/core/src/models/portal.model.ts` | Add `lastOpened: z.number().nullable()` to schema |
| `apps/api/src/db/schema/portals.table.ts` | Add `lastOpened` bigint column |
| `apps/api/src/db/migrations/XXXX_add-portal-last-opened.sql` | Add column + backfill from `created` |
| `apps/api/src/services/portal.service.ts` | Pass `lastOpened: null` in `createPortal()` |
| `apps/api/src/routes/portal.router.ts` | Extend PATCH to accept `lastOpened`; map `sortBy` to column in GET list |
| `apps/web/src/api/portals.api.ts` | Add `touch` mutation |
| `apps/web/src/views/Portal.view.tsx` | Fire touch mutation on portal visit |
| `apps/web/src/views/StationDetail.view.tsx` | Add `lastOpened` sort field (default); pass prop to card |
| `apps/web/src/components/PortalCard.component.tsx` | Accept + display `lastOpened` |
| `apps/web/src/components/RecentPortalsList.component.tsx` | Sort by `lastOpened`; display `lastOpened` timestamp |
| `apps/api/src/db/repositories/portals.repository.ts` | `findRecentByOrg` orders by `lastOpened` instead of `created` |

**No changes required**: `type-checks.ts`, `zod.ts`, `keys.ts`, `pagination.contract.ts`, `portal.contract.ts`, `base.repository.ts`, `PaginationToolbar.component.tsx` — existing patterns handle the new field automatically.
