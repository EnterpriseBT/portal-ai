# Entity-groups view-scoping — Condensed design (#648)

**Issue:** [EnterpriseBT/portal-ai#648](https://github.com/EnterpriseBT/portal-ai/issues/648) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** #599 scoped a session's `entities` + column inventory to the caller's granted curated views (`resolveGrantedViewColumns`) across the SQL session, the roster, and the `station_context` tool — but the **entity-groups** section of that context is still returned in full. `buildStationContext` and the `station_context` tool expose every station entity group — each member's `entityKey`, `connectorEntityId`, and link-column `key`/`label`/`normalizedKey` — for entities the caller has **not** been granted a view over. It is schema/structure metadata (not row data — the member still can't query those entities), but a residual disclosure gap against #599's stated goal, surfaced sub-threshold by the #599 security review. Single-package: `apps/api`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `buildStationContext` — the roster/context builder | `apps/api/src/services/portal.service.ts:1189` | `entities` scoped to granted views (`:1240`); `entityGroups` is a **raw passthrough** (`:1261`) |
| Granted-view resolution (the single source) | `apps/api/src/services/portal.service.ts:1231` → `PortalSqlService.resolveGrantedViewColumns` | returns `{ set, views: [{ view, columns }] }`; `view.connectorEntityId` is the granted entity id |
| `station_context` tool — its own build path | `apps/api/src/tools/station-context.tool.ts:353` | maps **all** `stationData.entityGroups` (`:354`); already resolves views at `:241` (`viewResolution`) |
| Entity-group member shape | `station-context.tool.ts:357` | `{ entityKey, connectorEntityId, linkColumnKey, linkColumnLabel, linkNormalizedKey, isPrimary }` — `connectorEntityId` is the join key to the granted set |
| Group data load | `AnalyticsService.loadStation` → `stationData.entityGroups` | org/station-scoped, **not** per-user |

## Decision — all-or-nothing group scoping, via one shared util

Both context surfaces already resolve the caller's granted views. A single pure helper in `apps/api/src/utils/entity-group-scope.util.ts` takes the resolved `views` (folding in the id-derivation so both callers stay identical) and keeps a group **only when every member's entity is granted**:

```
scopeEntityGroupsToEntities(groups, grantedViews):
  grantedEntityIds = { v.view.connectorEntityId for v in grantedViews }
  keep a group iff it has members AND every member.connectorEntityId ∈ grantedEntityIds
```

- **Whole group or nothing.** A partially-granted group is unusable for a join (the member can't query the other side), and keeping it "thinned" would leak the ungranted entity's participation — its `entityKey` / link-column names, or the anchoring role of a dropped **primary** member (an anchorless group). Emitting the group intact or not at all avoids all three.
- **Fail-closed:** no granted views → `entityGroups` is empty. An admin (resolves all *attached* views via `*`) sees every fully-attached group — consistent with how the `entities` roster already scopes to attached-granted views (an entity with no attached view is absent from both).
- **One source, no drift.** The util is imported by `buildStationContext` and the `station_context` tool; the tool test exercises the real function (not a re-implemented mock).

*Rejected:* keeping thinned mixed groups (drop only ungranted members) — leaks the ungranted member's metadata and can strand a group with no primary anchor (code-review #5). *Deferred (#651):* a shown group still carries a member's link-column `key`/`label`/`normalizedKey` even when that column is outside the member's view projection — column-level link-metadata scoping is a follow-up.

## Plan — 1 slice

**Files**
- New `apps/api/src/utils/entity-group-scope.util.ts` — `scopeEntityGroupsToEntities(groups, grantedViews)` (the all-or-nothing rule; folds in the id-derivation).
- Edit `apps/api/src/services/portal.service.ts` — `buildStationContext` passes `stationData.entityGroups` + `grantedViewColumns` through the util (`:1261`).
- Edit `apps/api/src/tools/station-context.tool.ts` — add `entityGroups` to `needsViewScope`, then pass `stationData.entityGroups` + `viewResolution?.views ?? []` through the util before the `:354` map.

**Tests** (npm scripts, never raw jest)
- `apps/api/src/__tests__/utils/entity-group-scope.util.test.ts` — direct unit test of the pure helper (keep fully-granted, drop when any member ungranted, empty when no grants).
- `apps/api/src/__tests__/services/portal.service.test.ts` — `buildStationContext` keeps a group only when every member is granted; drops it entirely when any member is ungranted.
- `apps/api/src/__tests__/tools/station-context.tool.test.ts` — the tool's `entityGroups` section is view-scoped for a member (imports the real util, not a mock).
- No bespoke integration test: the single source (`resolveGrantedViewColumns`) is already integration-covered (`portal-sql.service.integration.test.ts:1128`), and the addition is a pure filter over its output + `loadStation`'s groups. (Fixtures also reconciled: `ENTITY_GROUPS` member ids `ent-customers`/`ent-orders` → `ent-1`/`ent-2` to match `ENTITIES`.)

## Smoke (manual, against your dev stack)

1. As **admin** on the e2e station, open a portal agent and ask *"what entity groups exist here?"* (or call `station_context` with `sections:["entityGroups"]`). Expect **all** groups.
2. Grant a **member** a curated view over exactly one entity that participates in a group with a second, ungranted entity (Views page → Share; or a `db:studio` grant).
3. As the **member**, ask the agent the same question. **Expect:** only the granted entity's group metadata; the ungranted entity's member row (its `entityKey`/`connectorEntityId`/link-column names) is absent, and any group referencing only ungranted entities is gone.
4. Confirm the member's **entities** roster (already scoped by #599) and the now-scoped **entityGroups** agree — no group names an entity the roster omits.

## Out of scope

- Row-level exposure (already handled — the SQL session only materializes granted views).
- Map-tile / dissolve group scoping (#643) and the double view-resolution perf (#647) — separate tickets.
- Redaction-vs-omission for other `station_context` sections (columnDefinitions is already admin-gated at `station-context.tool.ts:331`).
