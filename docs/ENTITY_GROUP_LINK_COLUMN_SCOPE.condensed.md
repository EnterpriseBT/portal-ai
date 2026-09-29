# Entity-group link-column scoping — Condensed design (#651)

**Issue:** [EnterpriseBT/portal-ai#651](https://github.com/EnterpriseBT/portal-ai/issues/651) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** #648 scopes the entity-group section of `station_context` and the roster at the **entity** level: a group is emitted only when every member's entity is granted. A shown group still carries each member's link-column identifiers (`linkColumnKey` / `linkColumnLabel` / `linkNormalizedKey`), even when the caller's granted view over that entity **projects the link column out**. That is the same column-metadata disclosure #599 closed for the `entities` section (filtered to readable field mappings), one level down. Package: `apps/api`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Group scoping | `apps/api/src/utils/entity-group-scope.util.ts:25-37` | `scopeEntityGroupsToEntities(groups, grantedViews)`: keep a group iff every member's `connectorEntityId` is granted. Its `NOTE (#651)` marks this gap |
| Member shape | `apps/api/src/services/analytics.service.ts:65-79` | `EntityGroupMemberContext`: `linkNormalizedKey` is the field-mapping `normalized_key` (wide column `c_<key>`) |
| Granted-view resolution | `apps/api/src/services/portal-sql.service.ts:207-289` | `resolveGrantedViewColumns` → `views: [{ view, columns: WideTableCachedColumn[] }]`; columns = projection ∩ non-hidden ∩ `read field_mapping` (deny-wins) |
| Column identity | `apps/api/src/services/wide-table-statement.cache.ts:17-30` | `WideTableCachedColumn.normalizedKey` matches a member's `linkNormalizedKey` directly, so no `c_` round-trip is needed |
| Call site: roster | `apps/api/src/services/portal.service.ts:1265` | passes `grantedViewColumns`, which **already carry `columns`** |
| Call site: tool | `apps/api/src/tools/station-context.tool.ts:360-373` | passes `viewResolution?.views`, which also carry `columns` |
| Tests | `apps/api/src/__tests__/utils/entity-group-scope.util.test.ts`, `apps/api/src/__tests__/tools/station-context.tool.test.ts` | |

## Decision — drop the group when any member's link column isn't readable

The issue asks for one of three shapes:

- **Redact the member's link fields** (null or omit them). The group stays listed but is useless for a join, and it changes a string contract the agent and `resolve_identity` rely on.
- **Drop just that member.** This leaks a partial group whose remaining shape implies the missing member, and it breaks #648's rule that a group is emitted intact or not at all.
- **Drop the whole group.** A join needs every member's link column, so a group with an unreadable link column is unusable for this caller either way.

**Decision: drop the group.** It keeps #648's all-or-nothing rule, fails closed, and needs no contract change.

**Readable is per entity, as a union across views.** A member's link column counts as readable if **any** granted view over that member's entity has a readable column whose `normalizedKey === linkNormalizedKey`. The caller can join through that view. Owners and admins resolve every attached view with every column (via `*`), so their output doesn't change.

The existing function is extended rather than joined by a second one. `GrantedViewRef` gains `columns: { normalizedKey: string }[]`, and both call sites already pass that shape. The name `scopeEntityGroupsToEntities` stays; its doc comment is updated and the `NOTE (#651)` removed.

## Adjacent finding — `resolve_identity` bypasses view scoping ([#658](https://github.com/EnterpriseBT/portal-ai/issues/658), high)

While tracing who consumes group link metadata, I found that `resolve_identity` is built from the **unscoped** `stationData.entityGroups` (`apps/api/src/services/tools.service.ts:595-598`). `AnalyticsService.resolveIdentity` (`apps/api/src/services/analytics.service.ts:481-545`) then calls `wideTableRepo.fetchProjectedRows(member.connectorEntityId, <every live column>, { where: link = value })` for **every** member.

It applies no curated-view row filter, no projection and no `read field_mapping` check. `resolve_identity` also has no `TOOL_AUTHORIZATION` descriptor (`packages/core/src/registries/builtin-toolpacks.ts:1746`), so the #629 gate skips it as a read tool. A member with the `data_query` pack on a station that has an entity group can therefore read full rows of member entities outside their granted views.

That is a **data-plane** read bypass, not metadata, and fixing it properly means routing the read through the view-scoped path. It was reproduced with an integration test and filed as the full-sized Bug **#658**. **This ticket does not fix it**; #651 only scopes the metadata the tool and roster *display*.

## Plan — one slice

**Files**
- Edit: `apps/api/src/utils/entity-group-scope.util.ts`. `GrantedViewRef` adds `columns: ReadonlyArray<{ normalizedKey: string }>`. The function builds `readableLinkKeys: Map<entityId, Set<normalizedKey>>` as the union over the views of each entity, and keeps a group iff every member's entity is granted **and** its `linkNormalizedKey` is in that set.
- Call sites: no signature change is needed; both already pass `{ view, columns }`.

**Tests** (written first)
- `entity-group-scope.util.test.ts`:
  - The link column is projected out of the only view over an entity, so the group is dropped.
  - Two views over the same entity, one including the link column, so the group is kept (union).
  - A column that's readable but isn't the link column doesn't count.
  - Existing #648 cases stay green.
- `station-context.tool.test.ts`: a member session whose view excludes the join column gets no `entityGroups` entry, so the column's `key`/`label`/`normalizedKey` never appears.
- Run `npm run test:unit -- --testPathPattern "entity-group-scope|station-context"` (api), then `type-check`, `lint`, `format:check`.

## Smoke (manual, against your dev stack)

1. In the e2e org, set up (or reuse) a station with an entity group joining entities A and B on a link column. Attach a curated view over A whose projection **excludes** A's link column, plus a full view over B. Grant both to e2e-member.
2. As the member, open a portal session on that station and ask the agent for station context with entity groups. The group is **absent**, and A's link column name and label appear nowhere in the response.
3. Edit A's view to include the link column, then ask again. The group appears with both members' link columns.
4. As the owner, run the same session. The group appears (unchanged for admins).
5. Cleanup: restore the views, grants and group to their prior state.

## Out of scope

- The `resolve_identity` data-plane bypass above. It's tracked as #658.
- The roster naming members by `entityKey` rather than the queryable view key. That's a separate consistency question.
