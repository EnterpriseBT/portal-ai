# View-only station write scope — Condensed design (#827)

**Issue:** [EnterpriseBT/portal-ai#827](https://github.com/EnterpriseBT/portal-ai/issues/827) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The station's write gate and the tools' per-item scope check disagree about what a station reaches.
- **The gate** (`resolveStationCapabilities`, since #824) counts the connectors attached directly **and** the connectors behind the station's views.
- **The per-item checks** count only the directly attached connectors: `assertStationScope` in every entity, mapping and record tool, and the inline check in `connector_entity_create`.

So on a station that reaches an entity only through a view, the agent is offered write tools that every call refuses with `STATION_SCOPE_VIOLATION`. The fix is one definition of station reach, used by both. API only.

(#827's comment asked for a write-capability check on `connector_entity_delete`. It already has one: the tool calls `ConnectorEntityValidationService.validateDelete`, which runs `assertWriteCapability`. Nothing changes there.)

## Current shape

| Piece | Location | Note |
|---|---|---|
| Gate's reach | `apps/api/src/utils/resolve-capabilities.util.ts` `resolveStationCapabilities` | `station_instances` ∪ `instanceIdsForStation` (views → entities → instances) |
| Per-item entity scope | `assertStationScope` (same file) | The entity's instance must be in `station_instances`. Used by entity update/delete, field-mapping create/update/delete, record create/update/delete and bulk geocode (`tools/*.tool.ts`) |
| Entity-create scope | `tools/connector-entity-create.tool.ts:76` | Inline `station_instances` check on `connectorInstanceId` |
| View → entity reach | `entityIdsForStation` (same file) | station_views → curated_view → `connectorEntityId` |
| Delete capability | `tools/connector-entity-delete.tool.ts` → `ConnectorEntityValidationService.validateDelete` | Already calls `assertWriteCapability` |

## Decision — one definition of "the station reaches it"

- **A. Writes reach what the gate reaches.**
  - An entity is in scope when its connector is attached directly **or** it sits behind one of the station's views.
  - A connector is in scope for entity create when it's attached directly **or** behind one of the station's views.
- **B. Writes need a directly attached connector.** Revert the gate to `station_instances` for write tools, so view-only reach stays read-only.

**Decision: A.**
- **It matches what the station shows.** A view attached to a station is how #599 makes an entity part of it, and the agent sees it there.
- **Permission is checked separately.** Station scope is a *which-station* guard, not a permission. Every write is still authorized per call by `wrapWithPermissionGate`, which since #829 (objects and parts) needs write on the record's or mapping's entity, and write on the connector to create or delete an entity. A view on a station never grants write on its entity.
- **No contradiction left.** It removes the gate/tool mismatch without taking writes away from stations that have them today.
- **Why not B:** a station built purely from views (the #599 model) could never be written to through the agent, though the UI presents its entities as part of the station.

**Shape:**
- New `stationReach(stationId)` returns `{ directInstanceIds, entityIds, instanceIds }` from two queries:
  - `directInstanceIds` = `station_instances`;
  - `entityIds` = the entities behind the station's live views, read with one join (`stationViewsRepo.findReachByStationId`, skipping deleted attachments, views and entities);
  - `instanceIds` = the direct connectors ∪ the connectors of those entities.
- `resolveStationCapabilities` uses `instanceIds`.
- `assertStationScope(stationId, entityId)` passes when the entity's connector is in `directInstanceIds` **or** the entity is in `entityIds`. A view on one entity doesn't put that connector's other entities in reach. The 404 and 403 messages are unchanged.
- `connector_entity_create` checks `connectorInstanceId` against `instanceIds` (confirmed: creating an entity under a view's connector is in reach, as the write gate has counted since #824; creating one still needs write on the connector, #829).

## Plan — one slice

**Files**
- Edit: `apps/api/src/utils/resolve-capabilities.util.ts`: add `stationReach`; `resolveStationCapabilities` and `assertStationScope` use it.
- Edit: `apps/api/src/tools/connector-entity-create.tool.ts`: scope by `stationReach().instanceIds`.
- Edit: `apps/api/src/db/repositories/station-views.repository.ts`: add `findReachByStationId`.

**Tests** (`npm run test:unit` / `npm run test:integration` from `apps/api`)
- `src/__tests__/utils/resolve-capabilities.util.test.ts`:
  - `assertStationScope` passes for an entity reached only through a view
  - and for one reached only through a directly attached connector
  - and fails for one reached neither way (`STATION_SCOPE_VIOLATION`)
- `src/__tests__/tools/connector-entity-create.tool.test.ts`: a connector reached only through a view is in scope.
- Extend `src/__tests__/__integration__/tools/station-write-scope.integration.test.ts`. On a view-only station (no `station_instances`), `entity_record_create` for the view's entity succeeds and stores the record. On a station reaching neither the entity nor its connector, the same call still refuses.

## Smoke (manual, against your dev stack)

1. **View-only station:** a station with no attached connector and one view on `smoke_widgets` (the #824 smoke left "View-only station" `38833ef1…`). As the owner, `entity_record_create` for `smoke_widgets` (prompt **"Add a record with name Probe to smoke_widgets"**, or a direct tool call). The record is stored and there's no `STATION_SCOPE_VIOLATION`.
2. **Scope isn't permission:** on the same station, as a member with only **read** on `smoke_widgets` (or none), the same prompt is refused with `TOOL_PERMISSION_DENIED` (or `TOOL_TARGET_NOT_FOUND`), not a scope error. The view reaches the entity; it doesn't grant write.
3. **Unreached entity still refused:** on the same station, target an entity of a connector it neither attaches nor views (e.g. `smoke_manual` if it exists, or any other). Refused with the scope message.
4. **Read-only delete:** set Sandbox `write: false`, then ask the agent to delete an entity on it. Refused, citing write capability, and the entity is still present. Restore `write: true`.

## Out of scope

- Who may write: #829 (merged) settled that, and the permission gate enforces it independently of station scope. This ticket changes only *which station* scope applies.
- Listing view-reached entities by id in `station_context`, so the agent can address them. That's the read-scope gap seen in #825's smoke, and a separate decision.
