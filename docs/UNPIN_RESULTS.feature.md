# Feature: Show Pinned State & Unpin from Portal Session

## Goal

When viewing a portal session chat, blocks that have already been pinned should display a visual indicator (filled pin icon) instead of the default "pin" affordance. Clicking that icon unpins the result.

---

## Current State

- `PortalResult` model has `portalId` but does **not** store `messageId` or `blockIndex`
- The list endpoint (`GET /api/portal-results`) filters by `stationId` but **not** `portalId`
- `PortalSession` does not fetch pinned results — `PortalMessage` has no awareness of existing pins
- The `remove` mutation already exists in the SDK (`sdk.portalResults.remove(id)`)

---

## Implementation Plan

### Step 1 — Add `messageId` and `blockIndex` to the PortalResult model

**packages/core/src/models/portal-result.model.ts**

Add two fields to `PortalResultSchema`:

```ts
messageId: z.string().nullable(),
blockIndex: z.number().int().min(0).nullable(),
```

Both are nullable to remain backward-compatible with results pinned before this feature.

---

### Step 2 — Add columns to the database table

**apps/api/src/db/schema/portal-results.table.ts**

Add two columns after `portalId`:

```ts
messageId: text("message_id"),
blockIndex: integer("block_index"),
```

Both nullable (no `notNull`), matching the model.

Then generate and apply a migration:

```bash
cd apps/api && npm run db:generate && npm run db:migrate
```

---

### Step 3 — Update drizzle-zod schemas and type checks

**apps/api/src/db/schema/zod.ts** — No manual changes needed; `createSelectSchema` / `createInsertSchema` auto-derive from the updated table.

**apps/api/src/db/schema/type-checks.ts** — The existing bidirectional `IsAssignable` checks between `PortalResultSelect` and `PortalResult` will enforce that Steps 1 and 2 stay in sync. Verify the build passes.

---

### Step 4 — Persist `messageId` and `blockIndex` when pinning

**apps/api/src/routes/portal-results.router.ts** — POST handler

The handler already extracts `messageId` and `blockIndex` from the request body. Update the `create` call to include them in the inserted row:

```ts
messageId: messageId ?? null,
blockIndex: blockIndex ?? null,
```

---

### Step 5 — Add `portalId` filter to the list endpoint

**apps/api/src/routes/portal-results.router.ts** — GET handler

1. Accept `portalId` as an optional query parameter.
2. When present, add `eq(portalResults.portalId, portalId)` to the where clause.

This allows the frontend to fetch all pinned results for a specific portal session.

---

### Step 6 — Expose `portalId` filter in the frontend SDK

**apps/web/src/api/portal-results.api.ts**

Add `portalId?: string` to `PortalResultsListParams`. Thread it into the query URL when present.

---

### Step 7 — Surface pinned-block status via server-side `include`

Rather than fetching pinned results in a separate frontend query (which would be subject to pagination limits and risk showing stale pin states), the server returns pinned-block data as part of the existing portal detail response using the `include` convention.

#### 7a — Contract: add `PinnedBlockEntry` and extend response payload

**packages/core/src/contracts/portal.contract.ts**

Add a lightweight schema for pin-status entries and an optional `pinnedBlocks` array to `PortalGetResponsePayloadSchema`:

```ts
export const PinnedBlockEntrySchema = z.object({
  messageId: z.string(),
  blockIndex: z.number().int().min(0),
  portalResultId: z.string(),
});

export const PortalGetResponsePayloadSchema = z.object({
  portal: PortalSchema,
  messages: z.array(PortalMessageResponseSchema),
  pinnedBlocks: z.array(PinnedBlockEntrySchema).optional(),
});
```

- [x] `PinnedBlockEntrySchema` and type exported
- [x] `pinnedBlocks` added as optional field on `PortalGetResponsePayloadSchema`

#### 7b — Service: load pinned blocks when `include` contains `"pinnedResults"`

**apps/api/src/services/portal.service.ts**

Update `getPortal` to accept `opts?: { include?: string[] }`. When `"pinnedResults"` is included, query all non-deleted portal results for the portal (no pagination — scoped to a single session so naturally bounded), filter to rows with non-null `messageId`/`blockIndex`, and return as `PinnedBlockEntry[]`.

- [x] `PortalWithMessages` extended with `pinnedBlocks?: PinnedBlockEntry[]`
- [x] `getPortal` accepts `opts` parameter
- [x] Queries portal results without pagination limits
- [x] Filters out legacy pins (null `messageId`/`blockIndex`)

#### 7c — Router: parse `include` query param on `GET /api/portals/:id`

**apps/api/src/routes/portal.router.ts**

Parse `include` from query string using the standard convention (`split(",").map(trim).filter(Boolean)`), pass to `PortalService.getPortal`, and spread `pinnedBlocks` into the response when present.

- [x] `include` query param parsed
- [x] Passed to `PortalService.getPortal`
- [x] `pinnedBlocks` included in response payload
- [x] Swagger docs updated with `include` parameter

#### 7d — Frontend SDK: thread `include` param through `portals.get`

**apps/web/src/api/portals.api.ts**

Add optional `params?: { include?: string }` to `portals.get()`. Threaded into the URL via `buildUrl`. Existing callers are unaffected (params defaults to `undefined`).

- [x] `params` argument added to `portals.get`
- [x] Backward-compatible — existing callers unchanged

#### 7e — PortalSession: consume `pinnedBlocks` and build lookup map

**apps/web/src/components/PortalSession.component.tsx**

1. Update `sdk.portals.get(portalId)` call to pass `{ include: "pinnedResults" }`.
2. Derive a lookup `Map<string, string>` keyed by `"${messageId}:${blockIndex}"` → `portalResultId` from `portalQuery.data?.pinnedBlocks`.
3. Pass `pinnedBlocks` map and an `onUnpin(portalResultId)` callback down through `PortalSessionUI` to each `PortalMessage`.
4. After a successful pin or unpin mutation, call `portalQuery.refetch()` so pinned-block data stays in sync — no separate query to invalidate.

- [x] `sdk.portals.get` called with `{ include: "pinnedResults" }`
- [x] Lookup map derived from `pinnedBlocks` via `useMemo`
- [x] `pinnedBlocks` map and `onPinChange` callback threaded through `PortalSessionUI` → `PortalMessage` → `PortalMessageUI`
- [x] `onPinChange` triggers `portalQuery.refetch()` — called after successful pin (via mutation `onSuccess`); unpin will use the same pattern in Step 8/9
- [x] `PortalMessage` container wires `onSuccess: onPinChange` into existing pin mutation

---

### Step 8 — Update PortalMessage to show pinned state and unpin action

**apps/web/src/components/PortalMessage.component.tsx**

#### Props changes

Add to `PortalMessageUIProps`:

```ts
pinnedBlocks: Map<string, string>;   // "messageId:blockIndex" → portalResultId
onUnpin: (portalResultId: string) => void;
```

#### Rendering changes

For each pinnable block, derive the lookup key `"${message.id}:${blockIndex}"`:

- **Not pinned** → show the existing `PushPinOutlinedIcon` with hover-to-reveal "Pin result" behavior (unchanged).
- **Pinned** → show a filled `PushPinIcon` (always visible, not hover-gated) with a tooltip "Unpin result". On click, call `onUnpin(portalResultId)`.

#### New import

```ts
import PushPinIcon from "@mui/icons-material/PushPin";
```

---

### Step 9 — Wire up unpin mutation in the PortalMessage container

**apps/web/src/components/PortalMessage.component.tsx** — `PortalMessage` container

1. Accept `pinnedBlocks` and `onUnpin` as props (threaded from PortalSession).
2. Pass them through to `PortalMessageUI`.

The actual `remove` mutation and query invalidation live in `PortalSession` (Step 7) so that the pinned-results query cache is invalidated in one place.

---

## File Change Summary

| File | Change |
|------|--------|
| `packages/core/src/models/portal-result.model.ts` | Add `messageId`, `blockIndex` fields |
| `packages/core/src/contracts/portal.contract.ts` | Add `PinnedBlockEntry` schema; extend `PortalGetResponsePayload` with optional `pinnedBlocks` |
| `apps/api/src/db/schema/portal-results.table.ts` | Add `messageId`, `blockIndex` columns |
| `apps/api/src/routes/portal-results.router.ts` | Persist new fields on pin; add `portalId` query filter |
| `apps/api/src/routes/portal.router.ts` | Parse `include` query param on GET /:id; return `pinnedBlocks` when requested |
| `apps/api/src/services/portal.service.ts` | `getPortal` accepts `include` opts; loads pinned blocks server-side |
| `apps/web/src/api/portal-results.api.ts` | Add `portalId` to list params |
| `apps/web/src/api/portals.api.ts` | Add optional `params` to `portals.get` for `include` support |
| `apps/web/src/components/PortalSession.component.tsx` | Consume `pinnedBlocks` from portal query, build lookup map, wire unpin mutation |
| `apps/web/src/components/PortalMessage.component.tsx` | Accept pinned state, render filled icon, handle unpin click |

---

## Migration & Backward Compatibility

- New columns are nullable → existing rows unaffected
- Old pinned results (without `messageId`/`blockIndex`) simply won't appear as "pinned" in the chat view — they remain accessible from the pinned results list as before
- No breaking API changes — `portalId` filter is additive
