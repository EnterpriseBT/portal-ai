# Attach curated views from a portal session — Spec

**Issue:** [EnterpriseBT/portal-ai#1036](https://github.com/EnterpriseBT/portal-ai/issues/1036) · **Discovery:** `docs/ATTACH_VIEWS_FROM_PORTAL.discovery.md`

This spec fixes the contract for three new `view_management` tools: `curated_view_attach`, `curated_view_detach` and `station_list`. It also covers the shared service methods those tools and the existing routes both call, the request-memo invalidation that makes an attached view queryable in the same turn, and the web refresh after a turn that changed attachments.

## Key decisions (flag for review)

1. **One code path (D1).** Attach and detach move into `StationAttachmentService.attachViews` / `detachViews`. The two routes become thin callers, and their status codes and response bodies don't change.
2. **Batch attach is all or nothing (D2).** One unreadable view refuses the whole batch, and nothing is written. Already-attached views are a no-op. A batch holds 1–25 views.
3. **Detach needs station write only (D3).** This is the route's rule. A view that isn't attached is a no-op.
4. **Same-turn queryability (D4).** `forgetForRequest` deletes one memo key. `PortalSqlService.forgetSessionViews` owns the key format. Attach and detach call it only when the target is the session's own station.
5. **`station_list` (D5, Q3).** The list logic moves out of the router into `StationQueryService.listForCaller`, and the route calls it. Each station's attached views come from one batched query, and the toolpack slugs are included.
6. **Errors (Q1).** In the tools, `STATION_ATTACHMENT_NOT_READABLE` becomes `TOOL_TARGET_NOT_FOUND`. The route keeps its 403. This is a recorded difference between the UI and the agent.
7. **No session-provenance entry and no lock (Q2, Q4).** Attach is not added to `SESSION_CREATING_TOOLS`, because `agentAudit(portalId)` already records the session. No lock is added, the same as the routes.
8. **Web (D6).** `usePortalStream` collects the tool names of the turn's `tool_result` events. `handleStreamDone` invalidates `queryKeys.stations.root` when the turn ran attach or detach.

## Scope

### In scope

- The service methods and the routes rewired onto them.
- The three tools and every registry entry for them.
- `forgetForRequest` and `forgetSessionViews`.
- `StationQueryService` with the list route moved onto it.
- The prompt, pack and help copy.
- The web invalidation.

### Out of scope

- Attaching connectors or toolpacks, and creating, editing or deleting stations.
- Changing the attach route's 403.
- Provisioning (#848).
- Any schema change.

## Surface

### `apps/api/src/utils/request-context.util.ts`

```ts
/** #1036: drop one memoized value so the next caller in this request recomputes.
 *  No-op outside a request store. Only the service that owns `key` calls it. */
export function forgetForRequest(key: string): void;
```

`memoizeForRequest`'s docstring changes from "cannot change within one request" to: values the request doesn't change, unless the request changes them through the service that owns the key, which then calls `forgetForRequest`.

### `apps/api/src/services/portal-sql.service.ts`

```ts
/** The `resolveViewsForSession` memo key; the only place its format lives. */
// Instance methods on PortalSqlServiceImpl; argument order matches resolveViewsForSession.
sessionViewsKey(stationId: string, organizationId: string, userId: string): string; // `views:${stationId}:${userId}:${organizationId}`
/** #1036: a view set changed in this request; the next sql_query re-resolves it. */
forgetSessionViews(stationId: string, organizationId: string, userId: string): void;
```

`resolveViewsForSession` uses `sessionViewsKey` instead of building the string inline.

### `apps/api/src/services/station-attachment.service.ts`

```ts
export interface AttachmentAuditContext {           // a plain-object audit source, usable by routes and tools
  userId: string; organizationId: string;
  sourceIp: string | null; userAgent: string | null;
}

export interface ViewAttachResult  { stationId: string; added: string[]; alreadyAttached: string[] }
export interface ViewDetachResult  { stationId: string; removed: string[]; notAttached: string[] }

/** Load the station org-scoped: missing, cross-org or unreadable → 404 STATION_NOT_FOUND,
 *  then `resource.write` → 403 (the PermissionSet's refusal). Moved from curated-view.router.ts. */
static async loadWritableStation(ctx: PermissionContext, stationId: string, client?: DbClient):
  Promise<{ set: PermissionSet; station: StationSelect }>;

/** Attach 1+ views, all or nothing: loadWritableStation → assertAttachable (any unreadable or
 *  missing → 403 STATION_ATTACHMENT_NOT_READABLE) → insertManyIgnoreConflicts in one transaction
 *  → audit `added` after commit (fail-open). Already-attached ids are reported, not an error. */
static async attachViews(ctx: PermissionContext,
  args: { stationId: string; curatedViewIds: string[] }, audit: AttachmentAuditContext): Promise<ViewAttachResult>;

/** Detach 1+ views with station write only (#674): soft-delete by station + views, then audit `removed`. */
static async detachViews(ctx: PermissionContext,
  args: { stationId: string; curatedViewIds: string[] }, audit: AttachmentAuditContext): Promise<ViewDetachResult>;

/** Attached views for many stations in one batched read, each marked readable or not; unreadable ones carry no id or key. */
static async listViewsForStations(set: PermissionSet, organizationId: string, stationIds: string[], client?: DbClient):
  Promise<Map<string, Array<{ id: string; key: string; label: string; canRead: true } | { canRead: false; label: null }>>>;
```

- **Ids are deduplicated** before any check.
- **`auditViewAttachment` moves into the service** as a private `auditChange(audit, stationId, {added, removed})`. It records the same `station.attachments.change` event, with `targetType: "station"` and the `StationAttachmentChange` metadata shape, and it skips an empty change.
- **Unreadable views stay hidden.** `listViewsForStations` exposes neither the label nor the id of a view the caller can't read. The `GET /:id` chips do show labels; this tool deliberately doesn't, because what an agent says can be relayed beyond the user who asked.

### Routes (`apps/api/src/routes/curated-view.router.ts`)

- **`POST /:id/attach`** calls `attachViews(ctx, {stationId, curatedViewIds: [id]}, auditContextFromRequest(req))`.
- **`DELETE /:id/attach/:stationId`** calls `detachViews(...)`.
- **What doesn't change:** request schemas, responses (`CuratedViewAttachResponsePayload`), status codes, `@openapi` blocks and the `route-authorization.map.ts` entries.
- **The private `loadWritableStation` and `auditViewAttachment` are deleted from the router.**

### `apps/api/src/services/station-query.service.ts` (new)

```ts
export interface StationListOptions { search?: string; limit: number; offset: number; sortBy: "name" | "created"; sortOrder: "asc" | "desc" }
export class StationQueryService {
  /** Org-scoped + visibilityPredicate("station"), ilike search, ordered + paged, enabledToolpacks hydrated
   *  in one grouped read, capabilities attached. Moved verbatim from GET /api/stations. */
  static async listForCaller(ctx: PermissionContext, opts: StationListOptions):
    Promise<{ set: PermissionSet; stations: Array<StationSelect & { enabledToolpacks: string[]; capabilities: ShareableObjectCapabilities }>  // core capabilities.contract.ts; total: number }>;
}
```

`GET /api/stations` (`station.router.ts:191-283`) calls it, and its response is unchanged.

### Tools (`apps/api/src/tools/curated-views/`)

Every tool extends `Tool`, runs inside `runViewTool`, and audits with `AGENT_AUDIT` (user and org come from `ctx`). The `build` signature is `build(ctx: PermissionContext, session: { stationId: string; portalId: string | null })` for the three new tools.

**`curated-view-attach.tool.ts`** — `curated_view_attach`
```ts
input:  z.object({
  curatedViewIds: z.array(z.string().min(1)).min(1).max(25).describe("Ids of the views to attach, from curated_view_list or curated_view_create"),
  stationId: z.string().min(1).optional().describe("Station to attach to, from station_list. Omit for this session's station"),
}).strict()
result: { success: true; stationId: string; isSessionStation: boolean;
          added: string[]; alreadyAttached: string[];
          // only when isSessionStation: what sql_query can read now, from resolveGrantedViewColumns
          views?: Array<{ id: string; key: string; label: string; queryable: true; columns: Array<{ key: string; type: string }> }
                        | { id: string; key: string; label: string; queryable: false; reason: "KEY_CONFLICT" }>; }
```

When `isSessionStation` is true and anything was added, the tool:
1. calls `PortalSqlService.forgetSessionViews(stationId, ctx.organizationId, ctx.userId)`;
2. resolves the station's granted view columns and reports each attached view.

An attached view that isn't in the resolved set because another attached view already has its key (`portal-sql.service.ts:650-659`) is reported `queryable: false, reason: "KEY_CONFLICT"`.

**`curated-view-detach.tool.ts`** — `curated_view_detach`
```ts
input:  z.object({ curatedViewIds: z.array(z.string().min(1)).min(1).max(25), stationId: z.string().min(1).optional() }).strict()
result: { success: true; stationId: string; isSessionStation: boolean; removed: string[]; notAttached: string[] }
```

On the session's own station, it calls `forgetSessionViews` when anything was removed.

**`station-list.tool.ts`** — `station_list`
```ts
input:  z.object({ search: z.string().max(120).optional(), limit: z.number().int().min(1).max(100).optional().default(25),
                   offset: z.number().int().min(0).optional().default(0) }).strict()
result: { stations: Array<{ id: string; name: string; description: string | null; isSessionStation: boolean;
            capabilities: { read: boolean; write: boolean; delete: boolean; share: boolean };
            toolpacks: string[];   // builtin slugs; custom packs as "org:<id>" (the route's form)
            views: Array<{ id: string; key: string; label: string } | { unreadable: true }> }>;
          total: number; limit: number; offset: number }
```

It is sorted by `name` ascending. `isSessionStation` compares each station with `session.stationId`.

**Errors.** `runViewTool` gains one rule: an `ApiError` whose code is `STATION_ATTACHMENT_NOT_READABLE` returns `{error: {code: TOOL_TARGET_NOT_FOUND, message}}`, with the service's existing message. It's checked before the 403 re-throw. All other mappings are unchanged:

| Failure | Tool result |
|---|---|
| `STATION_NOT_FOUND` (404) | `TOOL_TARGET_NOT_FOUND` |
| No write (403) | Re-thrown → `TOOL_PERMISSION_DENIED` from the permission gate |
| 5xx | The tool's `*_FAILED` code |

### Registries

| Where | Addition |
|---|---|
| `apps/api/src/services/tools.service.ts` `BUILTIN_TOOL_NAMES` (`:217-283`) | `curated_view_attach`, `curated_view_detach`, `station_list` |
| `tools.service.ts` view_management block (`:892-921`) | Build the three with `(permissionContext, { stationId, portalId: portalId ?? null })`. The pack comment's last sentence becomes "Attach/detach go through StationAttachmentService." |
| `packages/core/src/registries/builtin-toolpacks.ts` `VIEW_MANAGEMENT_PACK` | The three tools, in this order after `curated_view_share`: `station_list`, `curated_view_attach`, `curated_view_detach`, then `MEMBER_LIST_TOOL`. Descriptions match the `.tool.ts` files; schema parity holds |
| `builtin-toolpacks.ts` capabilities (`:2030-2040`) | `station_list: rbacRead()`, `curated_view_attach: rbacWrite()`, `curated_view_detach: rbacWrite()`. No `TOOL_AUTHORIZATION` entry |
| `packages/core/src/registries/tool-phase-labels.ts` | `station_list: "Listing stations"`, `curated_view_attach: "Attaching the view"`, `curated_view_detach: "Detaching the view"` |
| `apps/api/src/constants/api-codes.constants.ts` (after `:653`) | `CURATED_VIEW_ATTACH_FAILED`, `CURATED_VIEW_DETACH_FAILED`, `STATION_LIST_FAILED`, each with a `#1036` JSDoc |

### Copy

**Pack description.** Replace the last sentence with: "…and share them, and attach or detach them on stations, this session's included, so a view can be queried right after it's created."

**Tool descriptions.**
- `curated_view_create`: replace "It does not attach the view to any station" with "To query it in this session, attach it with curated_view_attach."
- `curated_view_entity_list` (`:1567`): the matching change.
- The pack JSDoc (`:1502-1510`) is updated.

**`system.prompt.ts`, `view_management` section.** Replace the "**You cannot attach a view to a station.**" paragraphs (`:638-645`, `:675-679`) with:
- after creating a view the user wants to query, attach it to this station with `curated_view_attach`;
- once attached here, it can be queried with `sql_query` in the same turn, using the key and columns the result returns; the station summary lists it from the next message;
- to attach elsewhere, find the station with `station_list`, and check it has `data_query` if the user wants to query there;
- a refusal names the permission (station write).

**Help.**
- Glossary "Curated View" (`glossary.util.ts:257`): "attaching a view to a station is done when creating or editing the station, or by the assistant with the Curated Views pack."
- Glossary "Station" (`:242`): mention the same.
- FAQ `faq.util.ts:325`: add "…or ask the assistant to attach it."

### Web

`apps/web/src/utils/portal-stream.util.ts`:
- `usePortalStream` records each `tool_result` event's `toolName` in a per-stream `Set` ref, cleared on `send`.
- The `onDone` signature becomes `(clearLocalMessages: () => void, turn: { toolNames: ReadonlySet<string> }) => void`.

`apps/web/src/utils/station-attachment-tools.util.ts` (new):
```ts
export const STATION_ATTACHMENT_TOOLS = ["curated_view_attach", "curated_view_detach"] as const;
export const changedStationAttachments = (toolNames: ReadonlySet<string>): boolean => STATION_ATTACHMENT_TOOLS.some((n) => toolNames.has(n));
```

`PortalSession.component.tsx` `handleStreamDone`: additionally `if (changedStationAttachments(turn.toolNames)) queryClient.invalidateQueries({ queryKey: queryKeys.stations.root })`.

## Migration

None. No schema change.

## Seed

None.

## TDD test plan

API: `npm run test:unit -- --testPathPattern <file>` / `npm run test:integration -- --testPathPattern <file>` from `apps/api`. Core and web: `npm run test:unit` from the package.

### `apps/api` — unit

- **`__tests__/utils/request-context.util.test.ts`**
  - `forgetForRequest` makes the next `memoizeForRequest` call recompute.
  - Outside a store it's a no-op.
  - It only removes the named key.
- **`__tests__/services/portal-sql-view-memo.test.ts`**
  - `sessionViewsKey` matches the key `resolveViewsForSession` uses.
  - `forgetSessionViews` causes a re-resolve within one store.
- **`__tests__/services/station-attachment.service.test.ts`**
  - `attachViews`: dedupes ids; refuses everything on one unreadable id (no insert, no audit); reports `alreadyAttached`; audits only `added`; refuses an unreadable or cross-org station with 404 before 403.
  - `detachViews`: needs write only; reports `notAttached`; audits only `removed`.
  - `listViewsForStations`: one batched read; unreadable views carry no id, key or label.
- **`__tests__/tools/curated-views/curated-view-tools.test.ts`**
  - attach: `stationId` defaults to the session; `isSessionStation`; `forgetSessionViews` is called only for the session station and only when something changed; `KEY_CONFLICT`; `STATION_ATTACHMENT_NOT_READABLE` → `TOOL_TARGET_NOT_FOUND`; 403 is re-thrown; 5xx → `CURATED_VIEW_ATTACH_FAILED`; a 26-id batch is refused by the schema.
  - detach: the equivalent cases.
  - `station_list`: `isSessionStation`, toolpacks, unreadable views, the paging defaults and max.
- **`__tests__/services/tools.service.test.ts`**
  - `VIEW_TOOLS` gains the three; they're on read-only stations.
  - Cost-wrap (`:1025`), NUL gate (`:1107`), refusal-before-admission (`:1165`) and authorization coverage (`:1250`) all include them.
- **`__tests__/tools/builtin-toolpack-schema-parity.test.ts`**: the three mirrors match (no new code; it's covered by the registry change).
- **`__tests__/prompts/system.prompt.test.ts`** (`:404-409`): the old "cannot attach" assertion is replaced by the attach and same-turn guidance.

### `apps/api` — integration

- **`__tests__/__integration__/routes/curated-view.router.integration.test.ts`** and **`station-attachments.router.integration.test.ts`**: the existing attach and detach cases still pass unchanged (parity after the extraction).
- **`__tests__/__integration__/routes/station.router.integration.test.ts`**: the list cases still pass unchanged after the move to `StationQueryService`.
- **`__tests__/__integration__/tools/curated-view-tools.integration.test.ts`**
  - An admin attaches a view to the session station, and `sql_query` **in the same request store** returns its rows.
  - Attaching to another station: a member with read on the view sees it in that station's next `resolveViewsForSession`.
  - A member without station write gets `TOOL_PERMISSION_DENIED`, and no row is written.
  - An unreadable station or view gives `TOOL_TARGET_NOT_FOUND`.
  - Re-attach is a no-op.
  - Detach then `sql_query` in the same store no longer sees the view.
  - Each change writes one `station.attachments.change` audit with `userAgent: "portal-agent"`.
  - `station_list` honours visibility.

### `packages/core`

- **`__tests__/registries/builtin-toolpacks.test.ts`** (`:437-449`): the view_management tool order and the control-plane assertion.
- **`__tests__/registries/tool-capabilities.test.ts`** (`:18`, `:139-145`): the three cost hints are `free`.
- **`__tests__/registries/tool-phase-labels.test.ts`**: key set.
- **`glossary.util.test.ts` / `faq.util.test.ts`**: still pass. A pin is added for the agent-attach sentence on "Curated View".

### `apps/web`

- **`__tests__/portal-stream.util.test.ts`**: `onDone` receives the turn's tool names, and they're reset per `send`.
- **`__tests__/station-attachment-tools.util.test.ts`**: `changedStationAttachments`.
- **`__tests__/PortalSession.test.tsx`**: a turn with `curated_view_attach` invalidates `stations.root`; a turn without it doesn't (spy on `invalidateQueries`).

**Totals ≈ 60 cases** (api unit ≈ 32, api integration ≈ 14, core ≈ 6, web ≈ 8).

## Acceptance criteria

- [ ] On a station with `entity_management` + `view_management` + `data_query`, one prompt can create an entity and records, create a view, attach it to this station, and query it. `sql_query` returns the records in the same turn.
- [ ] An admin can attach a view to another station found by name through `station_list`, and that station's members who can read the view see it on their next turn.
- [ ] Without write on the target station, the caller gets `TOOL_PERMISSION_DENIED` naming the permission, and nothing is attached.
- [ ] An unreadable station or view gives `TOOL_TARGET_NOT_FOUND`.
- [ ] A batch with one unreadable view attaches nothing.
- [ ] Re-attaching and detaching a view that isn't attached are no-ops.
- [ ] `station_list` returns only readable stations, with write capability, toolpack slugs and attached views. Unreadable views are shown without id, key or label.
- [ ] Every agent attach or detach records the same `station.attachments.change` audit event as the UI, with `userAgent: "portal-agent"`.
- [ ] The attach and detach routes and `GET /api/stations` behave exactly as before.
- [ ] After a turn that attached or detached a view, the portal header's view list and the station page refresh without a reload.

## Risks & rollback

- **Route regression from the extraction.** The routes' integration suites run unchanged against the new service, and any drift fails them. Rollback is reverting the PR; there's no migration.
- **Memo invalidation clearing too much or too little.** One owner holds the key format, and the same-store integration test is the guard. If it misfires, `sql_query` sees the view on the next turn, which is today's behaviour. That fails safe: a wrong invalidation can never widen what a caller sees, because the view set is always re-resolved through `resolveGrantedViewColumns`.
- **Authorization.** It fails closed, with the same checks as the routes (404 when unreadable, 403 without write, all-or-nothing on views). The agent can't attach anything the user couldn't attach in the UI.
- **Audit.** It fails open, as in the routes: a failed audit write doesn't undo the attachment.
- **Prompt drift.** `system.prompt.test.ts` pins the new guidance, and schema parity pins the mirrors.

## Files touched

**New**
- `apps/api/src/services/station-query.service.ts`
- `apps/api/src/tools/curated-views/curated-view-attach.tool.ts`
- `apps/api/src/tools/curated-views/curated-view-detach.tool.ts`
- `apps/api/src/tools/curated-views/station-list.tool.ts`
- `apps/web/src/utils/station-attachment-tools.util.ts` (+ its test)

**Edit (api)**
- `apps/api/src/utils/request-context.util.ts`
- `apps/api/src/services/portal-sql.service.ts`
- `apps/api/src/services/station-attachment.service.ts`
- `apps/api/src/routes/curated-view.router.ts`
- `apps/api/src/routes/station.router.ts`
- `apps/api/src/tools/curated-views/curated-view-tool.util.ts`
- `apps/api/src/tools/curated-views/curated-view-create.tool.ts`
- `apps/api/src/tools/curated-views/curated-view-entity-list.tool.ts`
- `apps/api/src/services/tools.service.ts`
- `apps/api/src/constants/api-codes.constants.ts`
- `apps/api/src/prompts/system.prompt.ts`

**Edit (core)**
- `packages/core/src/registries/builtin-toolpacks.ts`
- `packages/core/src/registries/tool-phase-labels.ts`
- `packages/core/src/content/glossary.util.ts`
- `packages/core/src/content/faq.util.ts`

**Edit (web)**
- `apps/web/src/utils/portal-stream.util.ts`
- `apps/web/src/components/PortalSession.component.tsx`

**Tests:** the files named in the TDD plan.

## Next step

`docs/ATTACH_VIEWS_FROM_PORTAL.plan.md` slices this into about six TDD commits on this branch:
1. `forgetForRequest` and the `PortalSqlService` key owner.
2. The `StationAttachmentService` extraction, with the routes on it.
3. `StationQueryService`, with the list route on it.
4. The attach and detach tools, registries and guards, including the same-turn integration test.
5. `station_list`.
6. The copy (prompt, pack, help) and the web invalidation.
