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

## Decision — filter entity groups by the granted-entity set, via one shared helper

Both context surfaces already resolve the caller's granted views. Derive `grantedEntityIds = new Set(views.map(v => v.view.connectorEntityId))` and filter the group set through a single pure helper so the two surfaces can't drift (the same single-source discipline #599 used for columns):

```
scopeEntityGroupsToEntities(groups, grantedEntityIds):
  for each group: keep only members whose connectorEntityId ∈ grantedEntityIds
  drop any group left with zero members   // its structure named only ungranted entities
```

- A **mixed** group (some granted, some not) keeps only its granted members — an ungranted member's metadata is dropped even when a sibling is granted. A link to an ungranted entity is unusable to the member anyway (they can't query it), so dropping it loses nothing they could act on.
- **Fail-closed:** no granted entities → `entityGroups` is empty. An admin (resolves all attached views via `*`) sees every group, unchanged.
- The helper lives beside `buildStationContext` and is exported; the tool imports it — no logic is copy-pasted.

*Rejected:* filtering only whole groups (all-or-nothing) — a mixed group would still leak ungranted members' metadata. *Rejected:* redacting fields in place — dropping is simpler and matches how `entities` already handles ungranted entities (absent, not redacted).

## Plan — 1 slice

**Files**
- Edit `apps/api/src/services/portal.service.ts` — add + export `scopeEntityGroupsToEntities`; in `buildStationContext` build `grantedEntityIds` from `grantedViewColumns` and pass `entityGroups` through it (`:1261`).
- Edit `apps/api/src/tools/station-context.tool.ts` — filter `stationData.entityGroups` through the helper using `viewResolution.views` before the `:354` map.

**Tests** (npm scripts, never raw jest)
- `apps/api/src/__tests__/services/portal.service.test.ts` — `buildStationContext` scopes groups: drops the ungranted member of a mixed group; drops a group with no granted member (fail-closed). Runs the real pure helper.
- `apps/api/src/__tests__/tools/station-context.tool.test.ts` — the tool's `entityGroups` section is view-scoped for a member (runs the real helper).
- No bespoke integration test: the single source (`resolveGrantedViewColumns`) is already integration-covered (`portal-sql.service.integration.test.ts:1128`), and the addition is a pure filter over its output + `loadStation`'s groups — both halves are covered above. (Fixtures also reconciled: `ENTITY_GROUPS` member ids `ent-customers`/`ent-orders` → `ent-1`/`ent-2` to match `ENTITIES`.)

## Smoke (manual, against your dev stack)

1. As **admin** on the e2e station, open a portal agent and ask *"what entity groups exist here?"* (or call `station_context` with `sections:["entityGroups"]`). Expect **all** groups.
2. Grant a **member** a curated view over exactly one entity that participates in a group with a second, ungranted entity (Views page → Share; or a `db:studio` grant).
3. As the **member**, ask the agent the same question. **Expect:** only the granted entity's group metadata; the ungranted entity's member row (its `entityKey`/`connectorEntityId`/link-column names) is absent, and any group referencing only ungranted entities is gone.
4. Confirm the member's **entities** roster (already scoped by #599) and the now-scoped **entityGroups** agree — no group names an entity the roster omits.

## Out of scope

- Row-level exposure (already handled — the SQL session only materializes granted views).
- Map-tile / dissolve group scoping (#643) and the double view-resolution perf (#647) — separate tickets.
- Redaction-vs-omission for other `station_context` sections (columnDefinitions is already admin-gated at `station-context.tool.ts:331`).
