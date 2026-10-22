# View-management toolpack — Spec

**Issue:** [EnterpriseBT/portal-ai#645](https://github.com/EnterpriseBT/portal-ai/issues/645) · **Discovery:** `docs/VIEW_MANAGEMENT_TOOLPACK.discovery.md`

This spec pins the `view_management` built-in toolpack: six agent tools over curated views. It also pins the `CuratedViewService` extracted from `curated-view.router.ts`, which both the routes and the tools call, and the session provenance column on `curated_views`.

## Key decisions (flag for review)

1. **One implementation.** Create, update, get, list and delete logic moves from the router into `CuratedViewService`. The router becomes parse → service → respond with unchanged status codes, error codes and payloads. The existing router integration suite is the parity proof.
2. **Control-plane tool shape** (rbac_management precedent). Capabilities declare `writes:[]`, `locks:[]` and `costHint:"free"`, with no `TOOL_AUTHORIZATION` entry. The service runs the same checks the route runs. The tools stay available on read-only stations and never need a lock target.
3. **Typed refusals.** A tool helper `runViewTool` maps a service **403** to a rethrow, which the permission gate turns into `TOOL_PERMISSION_DENIED`. It maps a **404** to `TOOL_TARGET_NOT_FOUND`, and any other `ApiError` to `{ error: { code, message } }`. Anything else becomes the operation's `CURATED_VIEW_*_FAILED` code with a generic message, never raw error text.
4. **Columns by key.** Tool inputs name projected columns by field-mapping `normalizedKey`. The service resolves the keys **after** its access checks, so an unknown-key error never reveals anything about an entity the caller can't read. Outputs carry both key and id.
5. **No station attachment, ever.** Attachment stays a manual step when creating or updating a station. The prompt says so.
6. **Both filter modes.** `filter` (FilterGroup) or `filterSql`, never both (`oneFilterMode`). SQL runs through `CuratedViewFilterSqlService` with the tier's `advancedViewFilters` entitlement (fail-closed), exactly as on the page.
7. **Share = grant/revoke for one view.** `curated_view_share` wraps `GrantService.share`/`revoke` with `resourceType` fixed to `curated_view`. Passing `access: "none"` revokes. The grantee is `{type:"user", userId}` or `{type:"team"}`, the same contract as `grant_share`. "Share with the org" is the team grantee. "Share with Jane Doe" resolves the name first with `member_list`.
10. **`member_list` is shared by two packs.** It's listed in both `rbac_management` and `view_management`, and is built once when either pack is enabled. This is the first built-in tool in two packs. The registry invariant changes from "tool names are globally unique" to "**a name used by several packs refers to one identical spec object**". Two definitions of one name still fail. The station dialogs' collision warning counts that shared spec as a single owner. The roster read needs only org membership (`SeatService.listMembers`, #621), so the extra pack doesn't widen access.
8. **Provenance.** `curated_views.source_portal_id` (nullable), `sourcePortalId` on the model, the "Created in a portal session" chip on the Views list and detail, and `CuratedViewCreateTool` in `SESSION_CREATING_TOOLS`. `createdBy` is always the prompting user.
9. **Every tier.** `view_management` is added to `standard` and `plus`. `pro` and `enterprise` get it through their spread of all slugs.

## Scope

### In scope

- `CuratedViewService` extraction plus a router refactor onto it.
- The six tools, the `runViewTool` helper, and the `view_management` block in `buildAnalyticsTools`.
- Core registration: slug, pack mirror, capabilities, phase labels, tier entitlement, and a web icon mapping.
- `grant_share` / `grant_revoke` / `grant_list` descriptions extended to curated views, in both the tool file and the mirror.
- `member_list` shared into `view_management`: registry invariant, build-block condition, and web collision detection.
- `source_portal_id` migration, model field, dual-schema type checks, and the web chip.
- A `view_management` system-prompt section.

### Out of scope

- Station attachment of any kind (`POST/DELETE /:id/attach` stay page-only).
- Filter-SQL preview/suggest endpoints, and `GET /:id/records`.
- Any change to the Views page beyond the provenance chip.
- A central audit log (#179).

## Surface

### `CuratedViewService` — `apps/api/src/services/curated-view.service.ts` (new)

```ts
export type CuratedViewCreateInput = CuratedViewCreateRequestBody & {
  /** Tool-only: projected columns by field-mapping normalizedKey. Exclusive with fieldMappingIds. */
  columnKeys?: string[];
};
export type CuratedViewUpdateInput = CuratedViewUpdateRequestBody & { columnKeys?: string[] };

export class CuratedViewService {
  static list(ctx: PermissionContext, query: CuratedViewListRequestQuery): Promise<CuratedViewListResponsePayload>;
  static get(ctx: PermissionContext, id: string): Promise<CuratedViewGetResponsePayload["curatedView"]>;
  static create(ctx: PermissionContext, input: CuratedViewCreateInput,
                opts?: { sourcePortalId?: string | null }): Promise<CuratedViewSelect>;
  static update(ctx: PermissionContext, id: string, input: CuratedViewUpdateInput): Promise<CuratedViewSelect>;
  static delete(ctx: PermissionContext, id: string): Promise<CuratedViewDeleteResponsePayload>;
}
```

- **Moved verbatim from the router (module-private in the service):** `validateFilter`, `fieldMappingCreators`, `assertNoDuplicates`, `sameIdSet`, `assertProjection`, `assertEntityReadable`, `canonicalJson`. The router keeps `SORTABLE_COLUMNS` only if list stays in the router. It moves with `list`.
- **Each method loads its own set** with `PermissionService.loadSet(ctx)`. The order of checks, the transactions, `CuratedViewDependencyService.lockEntities`, `CuratedViewFilterSqlService.beforeWrite` (before the txn) and `validateAndDryRun` (inside it) are unchanged from `curated-view.router.ts:527–870`.
- **`columnKeys` resolution:** a module-private `resolveColumnKeys(entityId, keys, client)`. It runs **after** the create path's entity read check (404 `CONNECTOR_ENTITY_NOT_FOUND`), or after update's `loadForVerb(...,"write")`. It maps each key to the entity's live mapping id, preserving order. Failures:
  - duplicate key → 400 `CURATED_VIEW_INVALID_PAYLOAD` "Duplicate column in projection";
  - unknown key → 400 `CURATED_VIEW_INVALID_PAYLOAD` `Unknown column "<key>" on this entity`;
  - `columnKeys` and `fieldMappingIds` both set → 400 `CURATED_VIEW_INVALID_PAYLOAD`.

  The resolved ids then go through `assertProjection`, unchanged.
- **`get` enriches** the route's payload with `columns: { fieldMappingId: string; key: string | null }[]`. `key` is null for a projected mapping that has since been deleted. The route returns the same object, so the page gains the field harmlessly.
- **`create`** writes `sourcePortalId: opts?.sourcePortalId ?? null`. The router passes nothing.
- **`delete`** = `ObjectAccessService.loadForVerb(...,"delete")` + `CuratedViewDeleteService.deleteByIds`, returning `{ id, cascaded: { fieldMappings, stationViews, grants } }`.

Router `curated-view.router.ts`: list `:290`, get `:442`, create `:527`, update `:694` and delete `:885` each become safeParse → `CuratedViewService.<op>(req.application!.metadata, …)` → `HttpService.success`. `@openapi` blocks are unchanged, except that the get response documents `columns`. The stale "self-exposure" wording at `:518` is corrected to describe `assertProjection`.

### Tool helper — `apps/api/src/tools/curated-views/curated-view-tool.util.ts` (new)

```ts
export async function runViewTool<T>(
  failedCode: ApiCode,           // e.g. ApiCode.CURATED_VIEW_CREATE_FAILED
  fn: () => Promise<T>
): Promise<T | { error: { code: ApiCode; message: string } }>;
```

| Thrown | Result |
|---|---|
| `ApiError` 403, permission (`PERMISSION_DENIED`, a boundary refusal) | rethrown → gate → `{ error: { code: TOOL_PERMISSION_DENIED, message } }` |
| `ApiError` 403, plan (`*_NOT_ENTITLED`) | `{ error: { code: err.code, message } }`, so "your plan lacks this" stays distinct from "you lack permission" (amended in slice 7) |
| `ApiError` 404 | `targetNotFound(message)` (`permission-gate.service.ts:71`) |
| other `ApiError` 4xx | `{ error: { code: err.code, message: err.message } }` |
| `ApiError` 5xx / non-`ApiError` | `{ error: { code: failedCode, message: "The curated view operation failed." } }` + `logger.error` |

### Tools — `apps/api/src/tools/curated-views/*.tool.ts` (new)

Each tool extends `Tool` (`types/tools.ts:3`), and `build(ctx: PermissionContext)` returns ai-sdk `tool({ description, inputSchema, execute })`. `CuratedViewCreateTool.build(ctx, portalId: string | null)`. Inputs compose the exported contract fields (`CuratedViewKeySchema`, `nameField`, `descriptionField`, `filterSqlField`, `FilterExpressionSchema`). `oneFilterMode` is newly **exported** from `curated-view.contract.ts`. All input objects are `.strict()`. *Amended in the smoke walk:* the model-facing `inputSchema` carries **no refines**. The AI SDK checks input with its own zod copy, and a failed refine there kept the schema on the issue, so the error became unprintable ("Converting circular structure to JSON") once the schema held the recursive `FilterExpressionSchema`. Create and update therefore run a second `CheckedSchema` (`CuratedViewKeySchema`, `oneFilterMode`, and update's "at least one change") in `execute`, where a refusal is `CURATED_VIEW_INVALID_PAYLOAD` with the refine's message.

| Tool (file) | Input | Calls | Success result |
|---|---|---|---|
| `curated_view_list` (`curated-view-list.tool.ts`) | `{ search?, connectorEntityId?, limit?: 1–100 = 25, offset?: ≥0 = 0 }` | `CuratedViewService.list` (sort `label` asc) | `{ curatedViews: ListItem[], total, limit, offset }` |
| `curated_view_get` (`curated-view-get.tool.ts`) | `{ curatedViewId }` | `get`, then `GrantService.list` only when `capabilities.share` | `{ curatedView, grants? }` |
| `curated_view_create` (`curated-view-create.tool.ts`) | `{ connectorEntityId, key, label, description?, filter?, filterSql?, columns?: string[] }` | `create(ctx, {…, columnKeys: columns}, { sourcePortalId: portalId })` | `{ success: true, curatedView }` |
| `curated_view_update` (`curated-view-update.tool.ts`) | `{ curatedViewId, label?, description?, filter?, filterSql?, columns? }`; at least one field besides the id | `update` | `{ success: true, curatedView }` |
| `curated_view_delete` (`curated-view-delete.tool.ts`) | `{ curatedViewId }` | `delete` | `{ success: true, id, cascaded }` |
| `curated_view_share` (`curated-view-share.tool.ts`) | `{ curatedViewId, grantee: ShareGranteeSchema, access: "read" \| "read-write" \| "none" }` | `none` → `GrantService.list` + `revoke` of the grantee's grant (no grant → `{ success: true, revoked: false }`); otherwise `GrantService.share` with `AGENT_AUDIT` | `{ success: true, grant }` / `{ success: true, revoked: boolean }` |

- **Non-member grantee.** A `userId` that isn't an active member → 400 `RBAC_GRANTEE_NOT_MEMBER`, from `GrantService.resolvePrincipal`, unchanged.
- **Not found.** `get`, `update`, `delete` and `share` on a missing, cross-org or unreadable view give `TOOL_TARGET_NOT_FOUND`. `create` on an unreadable entity does too.
- **Wiring.** `ToolService.buildAnalyticsTools` (`tools.service.ts:455`) gets an `if (enabledPacks.has("view_management"))` block after the rbac block (`:818`). All six names are added to `BUILTIN_TOOL_NAMES` (`:205–264`).

### Shared `member_list`

- `builtin-toolpacks.ts`: the `member_list` mirror is lifted to a module constant `MEMBER_LIST_TOOL` and referenced by both `RBAC_MANAGEMENT_PACK.tools` and `VIEW_MANAGEMENT_PACK.tools`. Its description is broadened from "assigning roles/groups or sharing" to cover sharing views. `attachCapabilities` (`:1885`) spreads a new object per tool per pack today, so it gains a module-level `Map<string, ToolpackTool>` memo keyed by the source spec object. The same `MEMBER_LIST_TOOL` therefore comes out as the **same object** in both packs. `ALL_TOOL_CAPABILITIES` (keyed by name) is unaffected.
- `apps/api/src/tools/rbac/member.tool.ts`: `MemberListTool.description` gets the same wording. The class stays put.
- `tools.service.ts`: `tools.member_list` moves out of the rbac block into `if (enabledPacks.has("rbac_management") || enabledPacks.has("view_management"))`.
- `apps/web/src/utils/toolpack-collisions.util.ts` `detectToolpackCollisions`: an owner is keyed by **definition**, not pack. For a built-in tool the definition is the registry spec, so two built-in packs sharing `member_list` record one owner. A custom pack defining `member_list` is a different definition and still collides.
- `system.prompt.ts`: the rbac section's `member_list` guidance is unchanged. The view section repeats the name→`userId` step for sharing.

### Existing share tools — `apps/api/src/tools/rbac/grant.tool.ts`

`grant_share`, `grant_revoke` and `grant_list` descriptions change "station or pin" → "station, pin, or curated view" (and the mirror in `builtin-toolpacks.ts`). No behavior change: `ShareResourceTypeSchema` already includes `curated_view`.

### Core registry — `packages/core/src/registries/`

- `builtin-toolpacks.ts`:
  - `BuiltinToolpackSlugSchema` (`:33`) adds `"view_management"`.
  - New `VIEW_MANAGEMENT_PACK`: `name: "Curated Views"`, `iconSlug: "Layers"` (the Views nav item's icon), description *"Manage curated views in a session: list and inspect views, create and edit a view's columns and row filter, delete views, and share them. Changes follow the caller's own permissions on each view. Attaching a view to a station is done when creating or editing the station."* It holds six tool mirrors with `parameterSchema` and at least one example on the first tool.
  - It goes into `BUILTIN_TOOLPACKS` (`:1902`).
  - `CAPABILITIES` gets: list/get → `rbacRead()`; create/update/delete/share → `rbacWrite()`. Both helpers' JSDoc is generalized to "control-plane (RBAC, curated views)".
- `tool-phase-labels.ts`:
  - `curated_view_list` "Listing views"
  - `curated_view_get` "Reading the view"
  - `curated_view_create` "Creating the view"
  - `curated_view_update` "Updating the view"
  - `curated_view_delete` "Deleting the view"
  - `curated_view_share` "Sharing the view"
- `tier-catalog.ts`: `"view_management"` added to `standard` (`:131`) and `plus` (`:166`) `builtinToolpacks`.
- `apps/web/src/utils/tool-pack-icons.util.ts`: `Layers: LayersOutlined`.

### Model + table

- `packages/core/src/models/curated-view.model.ts`: `sourcePortalId: SourcePortalIdSchema` (nullable, default null, so existing creation sites are unaffected).
- `apps/api/src/db/schema/curated-views.table.ts`: `sourcePortalId: text("source_portal_id")` with the #641 JSDoc. drizzle-zod (`zod.ts`) and `type-checks.ts` follow automatically. Verify both compile.

### Web

- `CuratedViews.view.tsx` (list rows) and `CuratedViewDetail.view.tsx` (header) render `SessionGeneratedChipUI` when `isSessionGenerated(view)`, matching `EntityDetail.view.tsx`.

### System prompt — `apps/api/src/prompts/system.prompt.ts`

`PACK_PROMPT_SECTIONS.view_management` has:

- `capability: "manage curated views"`
- `requestShapes: ["a curated view change"]`
- `markers: ["manage curated views", "## Curated Views Notes"]`

The section says:

1. The tools act on the caller's own authority. Relay `TOOL_PERMISSION_DENIED` plainly and don't retry. `TOOL_TARGET_NOT_FOUND` means the view or entity doesn't exist for this user.
2. Find a view's id with `curated_view_list` before acting. Use column keys exactly as they appear in the entity's columns. Never invent ids or keys.
3. Use a structured `filter` or a `filterSql`, not both. A SQL filter needs a plan with advanced view filters; if refused, offer the structured filter.
4. **The agent cannot attach views to stations.** A new view shows up in a session only after someone attaches it while creating or editing a station. Say so after creating one.
5. Deleting a view detaches it from every station and removes its shares. Name the cascade counts from the result.
6. To share with a person, resolve their name or email to a `userId` with `member_list`. If several members match, ask which one. "The org" or "the team" is the team grantee. Never guess a `userId`.

## Migration

`npm run db:generate -- --name add-curated-view-source-portal-id` (expected `0131`): `ALTER TABLE "curated_views" ADD COLUMN "source_portal_id" text;`. It is expand-only, with no backfill (no existing view was session-created) and no index (provenance is never queried by authorization). Commit the `.sql` with `meta/_journal.json` and the snapshot. `npm run lint:migrations` passes (not destructive).

## Seed

None. No per-org seeded rows; the tier catalog is code (`tier apply` reprovisions entitlements).

## TDD test plan

Run per package: `npm run test:unit -- --testPathPattern <file>` and `npm run test:integration -- --testPathPattern <file>`, from `apps/api`, `packages/core` and `apps/web`.

### packages/core

- `__tests__/registries/builtin-toolpacks.test.ts`: pack count 10; `view_management` has seven tools (six `curated_view_*` + `member_list`) whose schemas are valid JSON schema; first tool has an example; capabilities coherent. Case 7 is rewritten: a tool name used by several packs is the **same object** (`toBe`) in each, and a fixture with two distinct specs under one name fails the check. ≈6
- `__tests__/registries/tier-catalog.test.ts`: `view_management` on every tier. ≈2
- `__tests__/registries/tool-capabilities.test.ts`: new cost pins (`free` ×6); none write-gated. ≈2
- `__tests__/registries/tool-phase-labels.test.ts`: key set includes the six (existing assertion). ≈0 new

### apps/api — service + router (integration)

- `__integration__/routes/curated-view.router.integration.test.ts`: **existing suite unchanged and green** (parity). New: get returns `columns` with keys; a deleted projected mapping's key is null. ≈2
- `__integration__/services/curated-view.service.integration.test.ts` (new): `columnKeys` resolve in order; unknown key → 400 naming it; duplicate key → 400; both `columnKeys` and `fieldMappingIds` → 400; unknown key on an **unreadable** entity → 404, not the key error; `sourcePortalId` stored by `create` opts, null from the route. ≈7

### apps/api — tools

- `__tests__/tools/curated-views/curated-view-tools.test.ts` (new, service mocked): `runViewTool` 403 rethrows / 404 → `TOOL_TARGET_NOT_FOUND` / 409 keeps `CURATED_VIEW_DUPLICATE_KEY` / 500 and non-ApiError → failed code with generic message; input schemas reject both filter modes, unknown keys and empty update; share `none` with no grant → `revoked:false`; share input rejects an `email` grantee. ≈12
- `__integration__/tools/curated-view-tools.integration.test.ts` (new, real DB, built through `buildAnalyticsTools` so the gates are real):
  - admin creates a view via the tool, and `GET /api/curated-views` lists it with `sourcePortalId` = portal id and `createdBy` = admin;
  - admin updates the label, columns and filter;
  - member `create` → `TOOL_PERMISSION_DENIED`;
  - member `get` on an unshared view → `TOOL_TARGET_NOT_FOUND`;
  - member with read share `update` → `TOOL_PERMISSION_DENIED`;
  - member with read share `get` sees `filter: null` and no `grants`;
  - SQL filter on `standard` → `CURATED_VIEW_FILTER_SQL_NOT_ENTITLED`, and the structured filter succeeds;
  - SQL filter on `pro` succeeds;
  - delete detaches from a station (cascade counts);
  - share with a user (`userId` from `member_list`) then `none` revokes; share with the team;
  - share widening beyond the caller's own access → `TOOL_PERMISSION_DENIED`;
  - duplicate key → `CURATED_VIEW_DUPLICATE_KEY`;
  - cross-org view id → `TOOL_TARGET_NOT_FOUND`;
  - tools present on a read-only station.

  ≈14
- `__tests__/services/tools.service.test.ts`: existing guards cover the new tools (cost wrap, NUL refusal, `BUILTIN_TOOL_NAMES` parity, every pack builds ≥1 tool). New: `view_management` tools absent when the pack isn't enabled; `member_list` built with only `view_management` enabled, with only `rbac_management`, and once with both. ≈4
- `__tests__/system-principal.guard.test.ts`: `CuratedViewCreateTool` added to `SESSION_CREATING_TOOLS` (guard asserts `portalId` threading). ≈0 new
- `__tests__/prompts/system.prompt.test.ts`: markers present if and only if the pack is active; capability phrase listed; the "cannot attach" sentence present. ≈3

### apps/web

- `__tests__/CuratedViewsView.test.tsx` and `__tests__/CuratedViewDetailView.test.tsx`: chip renders for `sourcePortalId` set, absent otherwise. ≈4
- `__tests__/toolpack-collisions.util.test.ts`: `rbac_management` + `view_management` → no collision; a custom pack defining `member_list` alongside either → collision naming both labels. ≈2
- The `Layers` icon mapping has no test file today; it's covered by type-check (the slug is a plain string key), so none is added.

**Totals ≈ 58 new cases**, plus the unchanged router suite as the refactor's regression net.

## Acceptance criteria

- [ ] In a portal session, an owner/admin creates a curated view with the tools, then edits its columns and filter. It appears on the Views page with the "Created in a portal session" chip, and resolves in a session once attached to a station on station create/update.
- [ ] A member without `create` on curated views calling `curated_view_create` gets `TOOL_PERMISSION_DENIED`. A view they can't read answers `TOOL_TARGET_NOT_FOUND` on get/update/delete/share. A view they can read but not write answers `TOOL_PERMISSION_DENIED` on update/delete/share.
- [ ] `curated_view_list`/`get` return only views the caller can read, with filters blanked for callers without write.
- [ ] A `filterSql` from an org whose tier lacks `advancedViewFilters` is refused with `CURATED_VIEW_FILTER_SQL_NOT_ENTITLED`; the structured filter works on every tier.
- [ ] Deleting a view via the tool detaches it from stations and removes its shares, matching the page.
- [ ] "Share this with Jane Doe" resolves Jane through `member_list` and grants read / read-write; "share with the org" grants the team; `access: "none"` revokes.
- [ ] Enabling both `rbac_management` and `view_management` on a station shows no tool-collision warning, and the session has one `member_list`.
- [ ] The pack is available on all four tiers, and its tools are present on read-only stations.
- [ ] No agent tool attaches a view to a station.

## Risks & rollback

- **Router refactor regression.** This is the largest risk, since 500+ lines move. Detected by the unchanged router integration suite (status, codes, payloads) plus the web view tests. Rollback is a revert of the extraction commit; the tools depend on it, so they revert with it.
- **A refusal leaking as a raw error.** A non-403 thrown out of a tool would end the turn. `runViewTool` catches everything, and the unit matrix pins each branch. Fail-closed: the 500 branch never echoes the original message (#687 parity).
- **Over-granting through share.** `GrantService.share` keeps `resource.share` + `assertWithinBoundary`, so the tool can't grant beyond the caller's own access. An integration case pins it.
- **Migration.** An additive nullable column. Rollback needs no migration revert; the column is simply unused.
- **Shared-tool invariant.** Relaxing global name uniqueness could let two different `member_list` definitions coexist. The rewritten registry test fails on any same-name pair that isn't one object, and the session-build collision check for custom packs is unchanged.
- **Tier drift.** `tier apply` must run per env for standard/plus to pick up the pack; until then those orgs just lack it (fail-closed, no error).

## Files touched

**New:**
- `apps/api/src/services/curated-view.service.ts`
- `apps/api/src/tools/curated-views/{curated-view-tool.util,curated-view-list.tool,curated-view-get.tool,curated-view-create.tool,curated-view-update.tool,curated-view-delete.tool,curated-view-share.tool}.ts`
- `apps/api/drizzle/0131_add-curated-view-source-portal-id.sql` + journal/snapshot
- Tests:
  - `apps/api/src/__tests__/tools/curated-views/curated-view-tools.test.ts`
  - `apps/api/src/__tests__/__integration__/tools/curated-view-tools.integration.test.ts`
  - `apps/api/src/__tests__/__integration__/services/curated-view.service.integration.test.ts`

**Edit:**
- `apps/api/src/routes/curated-view.router.ts`
- `apps/api/src/services/tools.service.ts`
- `apps/api/src/tools/rbac/grant.tool.ts`
- `apps/api/src/tools/rbac/member.tool.ts`
- `apps/web/src/utils/toolpack-collisions.util.ts`
- `apps/api/src/prompts/system.prompt.ts`
- `apps/api/src/db/schema/curated-views.table.ts`
- `apps/api/src/__tests__/system-principal.guard.test.ts`
- `packages/core/src/contracts/curated-view.contract.ts` (export `oneFilterMode`; get payload `columns`)
- `packages/core/src/models/curated-view.model.ts`
- `packages/core/src/registries/{builtin-toolpacks,tool-phase-labels,tier-catalog}.ts`
- `apps/web/src/utils/tool-pack-icons.util.ts`
- `apps/web/src/views/{CuratedViews,CuratedViewDetail}.view.tsx`
- The core/api/web tests listed above.

## Next step

`/plan 645` writes `docs/VIEW_MANAGEMENT_TOOLPACK.plan.md`. Expected slices, each a green commit on this branch:

1. Extract `CuratedViewService` (router onto it, `get.columns`, router suite green).
2. Add `columnKeys` resolution plus service integration tests.
3. `source_portal_id` migration, model and web chip.
4. Core registration (slug, mirror, capabilities, labels, tiers, icon).
5. `runViewTool` plus read tools.
6. Create/update/delete tools plus the `SESSION_CREATING_TOOLS` entry.
7. Share tool, the `grant_*` description updates, and `member_list` shared into the pack (registry invariant, build block, collision util).
8. Prompt section and the tools integration suite.
