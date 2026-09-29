# resolve_identity view scoping — Spec

This spec pins the contract that makes identity resolution unable to return a row or column the caller couldn't read elsewhere. The agent tool reads through the caller's granted curated views; the REST twin reads through the raw-record RBAC predicate of the surface it serves. It also folds in #651's link-column rule. Builds on [`RESOLVE_IDENTITY_VIEW_SCOPING.discovery.md`](./RESOLVE_IDENTITY_VIEW_SCOPING.discovery.md) and [`ENTITY_GROUP_LINK_COLUMN_SCOPE.condensed.md`](./ENTITY_GROUP_LINK_COLUMN_SCOPE.condensed.md). Issues: [#658](https://github.com/EnterpriseBT/portal-ai/issues/658), [#651](https://github.com/EnterpriseBT/portal-ai/issues/651).

## Key decisions (flag for review)

1. **The REST twin is RBAC-scoped, not view-scoped. This supersedes discovery D5 and OQ2.** `GET /entity-groups/:id/resolve` serves `EntityRecordDetail.view.tsx`, which sits on the raw-entity surface (`/entities/:id/records/:id`). Its sibling routes were closed against the "curated-views bypass" in #599 with `visibilityPredicate("entity_record")` (`apps/api/src/routes/entity-record.router.ts:269-279`); `/resolve` never got it. The fix is that predicate: same payload, no station-less view resolution, no new helper.
2. **The agent tool reads through `resolveGrantedViewColumns`**, with one match per (member, granted view), keyed by `viewKey` (discovery D1-B, D2-A).
3. **Fail closed.** A view whose readable columns lack the link column is skipped, because filtering on a hidden column is an oracle (D3). A resolution error yields no match, never a raw read.
4. **Groups are the display-scoped groups** (#648 plus #651). A group the caller isn't shown answers "Entity group not found". The tool registers only when the caller has at least one scoped group (D4).
5. **Records use the SQL session's column names** (`_record_id`, `source_id`, `c_<normalizedKey>`), not `normalizedKey`s, so a match can be joined to a `sql_query` on `viewKey` directly. This is a tool-result contract change; the copy updates with it.
6. **Row cap: 100 per match**, `ORDER BY _record_id`, with `truncated: true` beyond the cap (OQ3).
7. **Recurrence guard.** Every tool declaring `reads: ["entity_records"]` must be classified in an explicit table (D6).
8. **#651 folded in** as slice 1 (OQ1). OQ4 is resolved as out of scope: `/overlap` (`entity-group-member.router.ts`) returns only counts, and bidirectional validation (`field-mapping.router.ts`) returns `isConsistent` / `inconsistentRecordIds` / `totalChecked`. Neither returns row values. OQ5 (memoization) stays out of scope.

## Scope

### In scope
- `scopeEntityGroupsToEntities` requires a readable link column (#651).
- New `PortalSqlService.queryViewRowsByColumn`.
- `resolve_identity` rewired, with its result shape and copy (the tool `description`, the `builtin-toolpacks.ts` mirror and the `system.prompt.ts` guidance).
- The REST `/resolve` RBAC predicate.
- The read-scoping guard test.

### Out of scope
- Read-audit logging.
- Memoizing `resolveGrantedViewColumns` across tools in a turn.
- Any web change: the REST payload shape is unchanged.
- A generic view-scoped hook in `wrapWithPermissionGate`.

## Surface

### `scopeEntityGroupsToEntities` — `apps/api/src/utils/entity-group-scope.util.ts`

```ts
interface GrantedViewRef {
  view: { connectorEntityId: string };
  columns: ReadonlyArray<{ normalizedKey: string }>; // NEW
}
export function scopeEntityGroupsToEntities(
  entityGroups: EntityGroupContext[],
  grantedViews: readonly GrantedViewRef[]
): EntityGroupContext[];
```

A group is kept iff it has at least one member **and every member** satisfies both of these:
- the member's `connectorEntityId` has at least one granted view, and
- some granted view over that entity has a column with `normalizedKey === member.linkNormalizedKey`. Views over the same entity are unioned.

The function stays pure and fail-closed (no views → `[]`). Both call sites are unchanged, because they already pass `{ view, columns }`:
- `portal.service.ts:1265` passes `grantedViewColumns`;
- `station-context.tool.ts:360` passes `viewResolution?.views ?? []`.

The `NOTE (#651)` comment is removed.

### `PortalSqlService.queryViewRowsByColumn` — `apps/api/src/services/portal-sql.service.ts`

```ts
async queryViewRowsByColumn(
  resolved: { view: CuratedViewSelect; columns: WideTableCachedColumn[] },
  organizationId: string,
  match: { normalizedKey: string; value: string },
  opts: { limit: number },
  client: DbClient = db
): Promise<{ records: Record<string, unknown>[]; truncated: boolean } | null>
```

- **Returns `null`** when `match.normalizedKey` is not among `resolved.columns`. This is the fail-closed oracle guard.
- **The query is:** `SELECT w."entity_record_id" AS "_record_id", w."source_id" AS "source_id", <each readable column as quoteIdent(columnName)> FROM er__<entityId> w WHERE w."organization_id" = <org> AND w."deleted" IS NULL [AND (<rendered view.filter>)] AND w.<match col> = <quoteLiteral(value)> ORDER BY w."entity_record_id" LIMIT <limit + 1>`.
- **Identifiers and literals:** identifiers come from the statement cache and literals go through `quoteLiteral`, the same injection discipline as `queryCuratedViewRecords` (`:391`).
- **`truncated`** is `rows.length > limit`, and `records` is the first `limit` rows.
- **Filter rendering** is extracted into a private `renderViewFilterWhere(view, client): Promise<string | null>`, shared by `buildViewsForSession` (`:559`), `queryCuratedViewRecords` and this helper, so the three can't drift. A render failure throws `ApiError(500, PORTAL_SQL_FORBIDDEN)`. `queryCuratedViewRecords` keeps its `CURATED_VIEW_INVALID_FILTER` by mapping the render result.

### `AnalyticsService.resolveIdentity` — `apps/api/src/services/analytics.service.ts:481`

```ts
static async resolveIdentity(params: {
  stationId: string;
  organizationId: string;
  userId: string;
  entityGroupName: string;
  linkValue: string;
  entityGroups: EntityGroupContext[]; // unscoped station groups; scoped here
}): Promise<ResolveIdentityResult>;

export interface ResolveIdentityResult {
  entityGroupName: string;
  linkValue: string;
  matches: {
    viewKey: string;      // NEW — the queryable relation name (sql_query)
    entityKey: string;    // kept (connector-entity key)
    isPrimary: boolean;
    records: Record<string, unknown>[]; // keys: _record_id, source_id, c_<nk>
    truncated: boolean;   // NEW
  }[];
}
export const RESOLVE_IDENTITY_MATCH_LIMIT = 100;
```

The call runs in this order:
1. `const { views } = await PortalSqlService.resolveGrantedViewColumns(stationId, organizationId, userId)`. This happens on **every call**, so a revoked grant applies on the next call.
2. `scopeEntityGroupsToEntities(entityGroups, views)`, then find the group by name. If it's missing, throw `Error("Entity group not found: <name>")`, the existing message.
3. For each member, and each granted view over `member.connectorEntityId`, call `queryViewRowsByColumn(view, org, { normalizedKey: member.linkNormalizedKey, value: linkValue }, { limit: RESOLVE_IDENTITY_MATCH_LIMIT })`. A `null` result is skipped. A thrown error is logged, and that member-view is omitted (fail closed; no raw read).
4. Sort: primary first, then `viewKey` ascending.

`fetchProjectedRows` is no longer called from this path.

### `ResolveIdentityTool` — `apps/api/src/tools/resolve-identity.tool.ts`

- `build(stationId: string, organizationId: string, userId: string, entityGroups: EntityGroupContext[])`.
- The `description` becomes: *"Find the records across an Entity Group's member entities that share a link value, as the current user can see them. Returns one match per curated view (`viewKey`, the name to use in `sql_query`), primary entity first. Records use the same column names as `sql_query` (`c_<key>`), are capped at 100 per match (`truncated: true` means more exist — narrow with `sql_query`). Only groups listed in `station_context` resolve."*
- The same text is mirrored in `packages/core/src/registries/builtin-toolpacks.ts:208`.

### Registration — `apps/api/src/services/tools.service.ts:595`

Inside `enabledPacks.has("data_query")`, resolve `PortalSqlService.resolveGrantedViewColumns(stationId, organizationId, userId)`, and register `resolve_identity` only when `scopeEntityGroupsToEntities(stationData.entityGroups, views).length > 0`. Build it with `(stationId, organizationId, userId, stationData.entityGroups)`. Scoping repeats per call, as in step 1 above.

### Prompt — `apps/api/src/prompts/system.prompt.ts` (data_query section, `:150-160`)

Add one line: `resolve_identity` returns one match per curated view; its `viewKey` is the `sql_query` relation name; `truncated` means narrow with `sql_query`. `interpretiveTools` and `markers` are unchanged.

### REST `GET /entity-groups/:id/resolve` — `apps/api/src/routes/entity-group.router.ts:963-1075`

After the existing `read entity_group` gate:
- load the caller's set **once**;
- per member, AND `set.visibilityPredicate("entity_record", { createdByCol: entityRecords.createdBy, idCol: entityRecords.id })` into `where` (when non-null), exactly as `entity-record.router.ts:269-279` does.

The payload (`EntityGroupResolveResponsePayloadSchema`, `packages/core/src/contracts/entity-group-member.contract.ts:81`) is **unchanged**. Admins (`*`) see identical results. A caller without `read entity_record` gets `records: []` per member. The `@openapi` block's 200 description gains *"records are limited to those the caller may read (entity_record visibility)"*.

### Read-scoping guard — `apps/api/src/__tests__/services/tools.service.test.ts`

This is a new `describe` next to the #629 descriptor guard (`:873`). It has two assertions:
- Every entry of `ALL_TOOL_CAPABILITIES` whose `reads` includes `"entity_records"` has a key in a `READ_SCOPING` table.
- The table has no stale keys.

The table is local to the test, and each row records **why** the tool can't bypass views:

| Tool | Class | Reason |
|---|---|---|
| `sql_query`, `display_entity_records` | `view-session` | `runSqlQuery` temp views |
| `visualize_d3`, `visualize_map`, `hypothesis_test`, `regression`, `var_cvar` | `view-handle` | a `queryHandle` re-runs through `runSqlQuery` with its `_userId` (`portal-sql-handle.service.ts:102-143`) |
| `resolve_identity` | `view-helper` | `queryViewRowsByColumn` over `resolveGrantedViewColumns` |
| `station_context`, `platform_help` | `metadata` | view-scoped schema only (#599/#648/#651); `platform_help` never reads records |
| `transform_entity_records`, `bulk_geocode_records` | `admin-bulk` | `TOOL_AUTHORIZATION` `mode: "bulk"` needs an unconditional class write |

## Migration
None. No schema change.

## Seed
None.

## TDD test plan

The api integration tests run with `npm run test:integration -- --testPathPattern <file>` from `apps/api`, and the unit tests with `npm run test:unit -- --testPathPattern <file>`. Core runs `npm run test:unit` from `packages/core`.

### Layer 1 — group scoping (unit): `apps/api/src/__tests__/utils/entity-group-scope.util.test.ts`
1. The link column is projected out of the only view, so the group is dropped.
2. Two views over one entity, only one with the link column: the group is kept (union).
3. A readable non-link column doesn't count.
4. The existing #648 cases stay green, with fixtures updated to carry `columns`.

### Layer 2 — `queryViewRowsByColumn` (integration): `apps/api/src/__tests__/__integration__/services/portal-sql.service.integration.test.ts`
5. Returns only `_record_id`, `source_id` and the readable `c_*` columns.
6. Applies the view's `filter`: a row outside it is absent.
7. Returns `null` when the match column isn't readable.
8. `limit` gives `truncated: true` and exactly `limit` records, ordered by `_record_id`.
9. The org guard and soft-delete exclusion.
10. A hostile value (`' OR 1=1 --`) matches nothing, with no error.

### Layer 3 — `resolve_identity` end to end (integration): new `apps/api/src/__tests__/__integration__/tools/resolve-identity-view-scoping.integration.test.ts`

This file turns the saved repro into a regression test, running as a member through `ToolService.buildAnalyticsTools`.
11. A column projected out (`name`) is absent from the `customers` records.
12. An entity with no granted view (`orders`) has no match.
13. The view's row filter is applied.
14. Two granted views over one entity give two matches with distinct `viewKey`s.
15. A view without the link column is skipped. When that leaves an unresolvable group, "Entity group not found".
16. A revoked grant between two calls: the second call omits that view.
17. An admin gets every attached view's rows (no regression).
18. A member with no scoped group: `resolve_identity` is not registered.

Updated: `analytics-resolve-identity.integration.test.ts` — its 3 cases move to the new signature (an owner caller with a full view per entity).

### Layer 4 — REST twin (integration): `apps/api/src/__tests__/__integration__/routes/entity-group.router.integration.test.ts`
19. A custom role with `read entity_group` and no `read entity_record` gets 200 with `records: []` per member.
20. `created_by_caller` entity_record read: only the caller's own records.
21. An owner sees all records (unchanged).

### Layer 5 — registration + guard (unit): `apps/api/src/__tests__/services/tools.service.test.ts`
22. Registration follows the scoped count; this updates the `:415-502` cases.
23. Every `reads: ["entity_records"]` tool is classified.
24. `READ_SCOPING` has no stale keys.

### Layer 6 — copy pins + #651 display (unit)
25. `packages/core/src/__tests__/registries/builtin-toolpacks.test.ts`: the `resolve_identity` description mentions `viewKey` and `truncated` and matches the tool file.
26. `apps/api/src/__tests__/prompts/system.prompt.test.ts`: the data_query section mentions `viewKey`.
27. `apps/api/src/__tests__/tools/station-context.tool.test.ts`: a member whose view excludes the join column gets no `entityGroups` entry (#651 acceptance).

**Totals:** 4 unit (L1) + 6 integration (L2) + 8 + 3 updated integration (L3) + 3 integration (L4) + 3 unit (L5) + 3 unit (L6) ≈ **30 cases**.

## Acceptance criteria

- [ ] A member granted only a view over `customers` projecting `customer_id` gets no `name`, and no `orders` match, from `resolve_identity`.
- [ ] Every record `resolve_identity` returns is a row and a column set the same member could read through `sql_query` on that `viewKey`.
- [ ] A link value is never matched through a view in which the link column is unreadable.
- [ ] A group hidden from `station_context` resolves as "Entity group not found", and the tool is absent when no group is visible.
- [ ] `GET /entity-groups/:id/resolve` returns only records the caller may read under `visibilityPredicate("entity_record")`; the owner's response is unchanged.
- [ ] #651: a member whose view excludes an entity's join column never sees that column's `key`/`label`/`normalizedKey` in `station_context` / roster entity groups.
- [ ] CI fails if a new tool declares `reads: ["entity_records"]` without a `READ_SCOPING` classification.

## Risks & rollback

- **Fail mode: closed.** A resolution or render error yields no match (tool) or `records: []` (REST). That costs the member an incomplete answer, never a disclosure. Today's path fails *open*.
- **Contract change for the agent.** Record keys become `c_*`, and matches become per view. Mitigated by the updated description and prompt, and pinned by tests 25 and 26. A stale agent turn at most mis-names a column, which is safe.
- **Behaviour change for custom roles on the REST route.** A role that could read `entity_group` but not `entity_record` loses resolved records it should never have had. The owner's view is unchanged. No web change is needed (empty results render as "no matches").
- **Cost.** One `resolveGrantedViewColumns` per call plus one `SELECT … LIMIT 101` per member-view, the same order as a `station_context` call. There is no memoization regression, since nothing is memoized today.
- **Rollback.** Revert the PR. There is no schema or data change. Reverting restores the bypass, so a revert must be treated as re-opening #658.

## Files touched

- **Edit:**
  - `apps/api/src/utils/entity-group-scope.util.ts`
  - `apps/api/src/services/portal-sql.service.ts` (new helper plus the extracted `renderViewFilterWhere`)
  - `apps/api/src/services/analytics.service.ts`
  - `apps/api/src/tools/resolve-identity.tool.ts`
  - `apps/api/src/services/tools.service.ts`
  - `apps/api/src/prompts/system.prompt.ts`
  - `apps/api/src/routes/entity-group.router.ts`
  - `packages/core/src/registries/builtin-toolpacks.ts`
- **Tests, edit:** `entity-group-scope.util.test.ts`, `portal-sql.service.integration.test.ts`, `analytics-resolve-identity.integration.test.ts`, `entity-group.router.integration.test.ts`, `tools.service.test.ts`, `builtin-toolpacks.test.ts`, `system.prompt.test.ts`, `station-context.tool.test.ts`.
- **Tests, new:** `apps/api/src/__tests__/__integration__/tools/resolve-identity-view-scoping.integration.test.ts`, from the saved repro.

## Next step

`docs/RESOLVE_IDENTITY_VIEW_SCOPING.plan.md` will carve about **5 TDD slices** on this branch, each a green commit:

1. #651 group scoping (L1, test 27).
2. `queryViewRowsByColumn` plus the `renderViewFilterWhere` extraction (L2).
3. The `resolve_identity` rewire, registration and copy (L3, 22, 25, 26).
4. The REST twin predicate (L4).
5. The read-scoping guard (23, 24).
