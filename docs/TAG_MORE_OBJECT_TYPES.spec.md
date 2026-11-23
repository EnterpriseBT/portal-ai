# Tagging stations, pins, connectors and views — Spec

**Issue:** [EnterpriseBT/portal-ai#1070](https://github.com/EnterpriseBT/portal-ai/issues/1070) · **Discovery:** `docs/TAG_MORE_OBJECT_TYPES.discovery.md`

This spec pins the contract for assigning the existing org tag catalog to stations, pins (`portal_results`), connector instances and curated views alongside connector entities. It covers one shared assignment service, nested per-type routes, `tagIds` filtering and `include=tags` on the four list endpoints, tombstone sweeps, readable-only usage counts on the Tags page, and shared web tag components.

## Key decisions (flag for review)

1. **Exclusive arc on the existing table** (D1): `entity_tag_assignments` gains four nullable FK columns plus `CHECK (num_nonnulls(…) = 1)`. The migration is additive and existing rows are untouched.
2. **Storage and route names stay** (D2): `entity_tags`, `entity_tag_assignments` and `/api/entity-tags` keep their names. New shared code is `Tag…`, and user copy says "Tag".
3. **Nested routes from one factory** (D3): `/<type>/:id/tags`, the entity routes included, all on `createTagAssignmentRouter(descriptor)`.
4. **Race-safe 409** (D4): `ON CONFLICT DO NOTHING`, and nothing inserted → 409 `ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS`. The service returns `{assignment, created}` for #1071.
5. **Locks: `none`** for every assignment route, the rule entity tagging already follows (tagging under a running sync is allowed).
6. **Any-match `tagIds`**. A tag the caller can't read, or one from another org, matches nothing.
7. **`include=tags` returns only readable tags** on all five list types, which also closes the entity gap.
8. **Usage counts cover readable objects only** (D5A), per type, through `include=usage` on `GET /api/entity-tags`. There's no tag detail page.
9. **A pin keeps its tags when its station is deleted**, because the pin survives (OQ1).

## Scope

### In scope

- Schema + migration; core model + contracts; the `TagAssignmentsRepository` generalisation; `TagAssignmentService`; the router factory with five mounts; list `tagIds`/`include=tags` × 4 (and a readable-only fix on entities); tombstone sweeps × 4; tag-usage counts.
- Web: the SDK + keys, `TagChip`/`TagChipList`/`TagAssignSelect`/`TagsSection`, four list filters + card tag rows, four detail Tags sections, the Tags page counts, `DeleteTagDialog` copy, and invalidation helpers.
- Docs: glossary, FAQ, troubleshooting and empty-list help.

### Out of scope

- Agent tools (#1071), URL-addressable list filters, a tag detail page, ALL-match filtering, favorites, other taggable types, and a CLI.

## Surface

### Schema — `apps/api/src/db/schema/entity-tag-assignments.table.ts`

```ts
connectorEntityId:   text("connector_entity_id").references(() => connectorEntities.id),   // NOT NULL dropped
stationId:           text("station_id").references(() => stations.id),
portalResultId:      text("portal_result_id").references(() => portalResults.id),
connectorInstanceId: text("connector_instance_id").references(() => connectorInstances.id),
curatedViewId:       text("curated_view_id").references(() => curatedViews.id),
```

Table extras:

- `check("entity_tag_assignments_one_target", sql\`num_nonnulls(connector_entity_id, station_id, portal_result_id, connector_instance_id, curated_view_id) = 1\`)`.
- The existing `entity_tag_assignments_entity_tag_unique` stays.
- New partial unique indexes `entity_tag_assignments_<station|portal_result|connector_instance|curated_view>_tag_unique` on `(<col>, entity_tag_id) WHERE deleted IS NULL`.
- `index("entity_tag_assignments_tag_idx").on(entity_tag_id).where(deleted IS NULL)`.
- The doc comment records that the table now holds assignments for every taggable type, with the name kept so the migration stays expand-only.

### Core

- **`packages/core/src/models/tag-target.model.ts`** (new):
  - `TagTargetTypeSchema = z.enum(["entity", "station", "pin", "connector_instance", "curated_view"])`
  - `TagTargetSchema = z.object({ type: TagTargetTypeSchema, id: z.string() })`
  - `TAG_TARGET_PERMISSION_TYPE: Record<TagTargetType, PermissionResourceType>`, an identity map except `entity`, which is already the permission type's name.
- **`entity-tag-assignment.model.ts`:** `connectorEntityId` becomes `z.string().nullable()`. Add `stationId`, `portalResultId`, `connectorInstanceId` and `curatedViewId` as `z.string().nullable()`, with `.refine` exactly one non-null. `type-checks.ts` stays bidirectional.
- **`entity-tag-assignment.contract.ts`:**
  - `EntityTagAssignmentCreateRequestBodySchema` is unchanged (`{entityTagId}`, strict).
  - `AssignedEntityTagSchema` and the list payload `{tags}` are reused by every type.
  - Add `StationWithTagsSchema`, `PortalResultWithTagsSchema`, `ConnectorInstanceWithTagsSchema` and `CuratedViewWithTagsSchema` (`X.extend({ tags: z.array(EntityTagSchema).optional() })`).
- **List query schemas** gain `tagIds: z.string().optional()` (comma-separated ids): `StationListRequestQuerySchema` (`station.contract.ts:19`), `PortalResultListRequestQuerySchema` (`portal.contract.ts`), `ConnectorInstanceListRequestQuerySchema` (`connector-instance.contract.ts:72`) and `CuratedViewListRequestQuerySchema` (`curated-view.contract.ts:43`). Each list response's row schema becomes its `…WithTags` variant.
- **`entity-tag.contract.ts`:**
  - `EntityTagListRequestQuerySchema` gains `include: z.string().optional()`.
  - `EntityTagWithAssignmentCountSchema` is replaced by `EntityTagWithUsageSchema = EntityTagSchema.extend({ usage: z.record(TagTargetTypeSchema, z.number().int().min(0)) })`. Every key is present, zero included.
  - The list row is `withCapabilities(EntityTagSchema.extend({ usage: … .optional() }))`.
- **`builtin`/content:**
  - Glossary term "Entity Tag" becomes **"Tag"**, defined over all five types, with `relatedTerms` adding "Station", "Pinned Result", "Connector Instance" and "Curated View".
  - FAQ "How do tags work?" names the five types, the any-match filter, and the rule that tagging needs write on the object.
  - New troubleshooting entry: "I can't add or remove a tag", naming write on the object and read on the tag.

### Repository — `entity-tag-assignments.repository.ts`

All methods take a `TagTargetType` and resolve the column through one private `targetColumn(type)` map. The entity-specific methods are **removed**, with no aliases.

```ts
findByTarget(type: TagTargetType, id: string, client?): Promise<(EntityTagSelect & { assignmentId: string })[]>
findByTargetIds(type, ids: string[], client?): Promise<Map<string, EntityTagSelect[]>>  // one query, never per id
insertIfAbsent(target: TagTarget, tagId: string, orgId: string, createdBy: string, client?): Promise<{ row: EntityTagAssignmentSelect; created: boolean }>
findAssignment(target: TagTarget, assignmentId: string, client?): Promise<EntityTagAssignmentSelect | undefined>
softDeleteByTargets(type, ids: string[], deletedBy: string, client?): Promise<number>
countByTargetIds(type, ids: string[], client?): Promise<number>   // impact endpoints
taggedWithAny(type, idCol: AnyPgColumn, tagIds: string[]): SQL     // `idCol IN (SELECT <col> … WHERE entity_tag_id IN (…) AND deleted IS NULL)`
```

`insertIfAbsent` is `INSERT … ON CONFLICT (<col>, entity_tag_id) WHERE deleted IS NULL DO NOTHING RETURNING *`. On no row it re-reads the live one and returns `created: false`.

### Service — `apps/api/src/services/tag-assignment.service.ts` (new)

```ts
class TagAssignmentService {
  static loadTarget(ctx, target: TagTarget, verb: "read" | "write"): Promise<void>
  static list(ctx, target): Promise<AssignedEntityTag[]>
  static assign(ctx, target, entityTagId): Promise<{ assignment: EntityTagAssignment; created: boolean }>
  static unassign(ctx, target, assignmentId): Promise<void>
  static readableTagFilter(ctx): Promise<(tags: EntityTagSelect[]) => EntityTagSelect[]>
}
```

- **`loadTarget`** loads the target org-scoped and checks it's readable, else 404 `<TYPE>_NOT_FOUND` (the existing per-type code). For `"write"` it then checks `resource.write` on `TAG_TARGET_PERMISSION_TYPE[type]`, else 403 `PERMISSION_DENIED`. The read path is `ObjectAccessService.readableInOrg`, and the write path is `ObjectAccessService.loadForVerb(set, orgId, type, row, "write", notFound)`. Each descriptor supplies the row loader and the `notFound` error.
- **`assign`** runs `loadTarget(write)`. The tag must be readable in the org, else 404 `ENTITY_TAG_NOT_FOUND`. Then it calls `insertIfAbsent`.
- **`unassign`** runs `loadTarget(write)`. The assignment must be on this target, else 404 `ENTITY_TAG_ASSIGNMENT_NOT_FOUND`. Then it soft-deletes the row.
- **`list`** returns only tags readable by the caller.

### Routes — `apps/api/src/routes/tag-assignment.router.ts` (new, replaces `entity-tag-assignment.router.ts`)

`createTagAssignmentRouter(type: TagTargetType): Router` (`mergeParams`, param `:targetId`) serves:

| Method + path | 2xx | Errors |
|---|---|---|
| `GET /` | 200 `{tags}` | 404 target |
| `POST /` body `{entityTagId}` | 201 `{entityTagAssignment}` | 400 `ENTITY_TAG_ASSIGNMENT_INVALID_PAYLOAD`, 404 target/tag, 403, 409 `ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS` when `created: false` |
| `DELETE /:assignmentId` | 200 `{id}` (the entity route's existing contract) | 404 target/assignment, 403 |

It's mounted at `/connector-entities/:targetId/tags` (replacing the current mount, same URL), `/stations/:targetId/tags`, `/portal-results/:targetId/tags`, `/connector-instances/:targetId/tags` and `/curated-views/:targetId/tags`.

Each of the 15 routes gets an `@openapi` block, referencing the registered `EntityTagAssignmentCreateRequestBody`, `EntityTagAssignmentCreateResponsePayload` and `EntityTagAssignmentListResponsePayload` components. The route map uses the URL path param names (`{stationId}`, `{portalResultId}` …, whatever the guard's path normaliser reports). Each entry reads `by: "<type> in org + readable, else 404; write <type> (POST/DELETE); tag readable"` and `locks: { none: "tag assignments; no job reads or writes them" }`.

### List endpoints

| Endpoint | Change |
|---|---|
| `GET /api/stations` (`StationQueryService.listForCaller`) | Add `tagIds` to `where`. Read `include`, and `tags` attaches readable tags |
| `GET /api/portal-results` (`portal-results.router.ts:452`) | Add `tagIds` to `filters`. `tags` joins the existing `include` list |
| `GET /api/connector-instances` | Same |
| `GET /api/curated-views` (`CuratedViewService.list`) | Add `tagIds`. Read `include`, and `tags` |
| `GET /api/connector-entities` | `include=tags` filtered to readable tags. `tagIds` intersected with readable tags |

How `tagIds` is applied:

- It's split on commas, trimmed and deduped, then intersected with `readableTagFilter`.
- An empty intersection pushes `sql\`false\`` (an empty page, `total: 0`).
- It sits in the same `where` as `visibilityPredicate`, so `count` agrees.

### Tag usage — `GET /api/entity-tags?include=usage`

For the page of tags, one grouped query per target type runs:

```sql
SELECT entity_tag_id, count(*)
FROM entity_tag_assignments a
JOIN <type table> t ON t.id = a.<col>
WHERE a.entity_tag_id IN (…)
  AND a.deleted IS NULL
  AND t.deleted IS NULL
  AND <visibilityPredicate(type)>
GROUP BY 1
```

Any type missing from the result gets 0. Nothing else is computed without `include=usage`.

### Tombstone sweeps

`softDeleteByTargets` runs in the same transaction as each delete:

| Path | Call |
|---|---|
| `station.router.ts:1106` | `("station", [id])` |
| `portal-results.router.ts:801` | `("pin", [id])`, inside a new tx with the pin's `softDelete` |
| `connector-instance.router.ts:1429` | `("connector_instance", [id])`, beside the existing entity sweep (:1516) |
| `CuratedViewDeleteService.deleteByIds` | `("curated_view", ids)` |
| `ConnectorEntityValidationService.executeDelete` (:134) | `("entity", ids)`, the existing behaviour on the new signature |

Tag delete (`entity-tag.router.ts:656-700`) is unchanged: it already soft-deletes every assignment for the tag, whatever its target.

### Web — `apps/web/src`

- **`api/tag-assignments.api.ts`** (new, replaces `entity-tag-assignments.api.ts`): `sdk.tagAssignments.list(target)` (`useAuthQuery`, key `queryKeys.tagAssignments.listByTarget(type, id)`), `.assign(target)` and `.unassign(target)`. Both mutations declare `onPermissionDenied: { invalidate: () => [tagAssignmentTargetRootKey(type), queryKeys.tagAssignments.root] }`.
- **`TAG_TARGET_PATH`:** `{entity: "connector-entities", station: "stations", pin: "portal-results", connector_instance: "connector-instances", curated_view: "curated-views"}`.
- **`api/keys.ts`:** `tagAssignments: { root, listByTarget(type, id) }`, replacing `entityTagAssignments`.
- **`utils/tag-invalidation.util.ts`** (new):
  - `tagAssignmentKeys(type)` = `[tagAssignments.root, <type>.root]`, used by assign and unassign.
  - `tagCatalogChangeKeys()` = `[entityTags.root, tagAssignments.root, connectorEntities.root, stations.root, portalResults.root, connectorInstances.root, curatedViews.root]`, used by tag update and delete.
  - The four `delete-invalidation.util.ts` helpers add `tagAssignments.root`.
- **`components/TagChip.component.tsx`** `TagChipUI {tag, onDelete?}`. **`TagChipList.component.tsx`** `TagChipListUI {tags, onDelete?}` renders nothing for `[]`. **`TagAssignSelect.component.tsx`** `TagAssignSelectUI` is lifted from `EntityDetail.view.tsx:84-124`.
- **`components/TagsSection.component.tsx`:**
  - `TagsSectionUI {tags, gate: ActionGate, onAssign, onUnassign, onSearch, labelMap, pending}`. On a `hide` gate it renders chips without `onDelete` and no select. With no tags and a `hide` gate it renders nothing.
  - `TagsSection {target, capabilities}` wires `sdk.tagAssignments.*`, `sdk.entityTags.search()` and `decideActionGate({allowed: capabilities.write})`.
- **Detail views:** `EntityDetail`, `StationDetail`, `PinnedResultDetail`, `ConnectorInstance` and `CuratedViewDetail` render `<TagsSection>` between `PageHeader` and the first `PageSection`.
- **List views:**
  - `Stations`, `PinnedResultsListView`, `Connector` (instances tab) and `CuratedViews` add `{type: "multi-select", field: "tagIds", label: "Tags", onSearch, labelMap}` to `usePagination` filters, and pass `include` with `tags`.
  - Their cards (`StationList`, `PinnedResultsList`, `ConnectorInstance`, `CuratedViews`) add a "Tags" `MetadataList` chip row via `TagChipListUI`, omitted when empty.
  - `Entities` switches to `TagChipListUI`.
- **Tags page:** `Tags.view.tsx` passes `include: "usage"`. `TagCardUI` gains `usage?: Record<TagTargetType, number>` and renders the non-zero counts ("4 entities · 2 views"), or "Not used" when all are zero. `DeleteTagDialog` copy says it's removed "from every object it's on".
- **`utils/glossary-routes.util.ts:38`:** the key "Entity Tag" becomes "Tag". `empty-list-help.util.ts` gains tag mentions for stations, connectors, views and pinnedResults, and its tags entry now says "attach to entities, stations, connectors, views and pinned results".

## Migration

`npm run db:generate -- --name tag-assignment-targets` produces the SQL, the journal and the snapshot, committed together.

- **Contents:** `ALTER COLUMN connector_entity_id DROP NOT NULL`, four `ADD COLUMN … REFERENCES`, `ADD CONSTRAINT … CHECK (num_nonnulls(…) = 1)`, four `CREATE UNIQUE INDEX … WHERE deleted IS NULL`, and one `CREATE INDEX entity_tag_assignments_tag_idx`.
- **Why it's safe:** existing rows all have `connector_entity_id`, so the CHECK validates in place. The migration is additive only and carries no `destructive-ok`.

## Seed

None. Tags aren't seeded, per org or globally.

## TDD test plan

Run per package: `npm run test:unit` / `npm run test:integration` (with `--testPathPattern`), never raw jest.

### Core: `packages/core/src/__tests__/`

- `models/entity-tag-assignment.model.test.ts`: exactly one target required, zero or two rejected.
- `models/tag-target.model.test.ts`: the permission-type map covers every target.
- `contracts/*` list query `tagIds`: accepted, unknown keys still rejected.
- Glossary/FAQ pins renamed ("Tag").

≈ 8 cases.

### API integration: `apps/api/src/__tests__/__integration__/`

- **`routes/tag-assignment.router.integration.test.ts`**, table-driven over the five types:
  - GET lists readable tags;
  - POST 201;
  - POST again gives 409;
  - two concurrent POSTs give one 201 and one 409, never a 500;
  - a read-only caller gets 403;
  - an unreadable target gets 404;
  - a foreign-org target gets 404;
  - a foreign-org tag gets 404;
  - an unreadable tag gets 404;
  - DELETE 200;
  - DELETE of an assignment on another target gets 404;
  - a strict body rejects unknown keys.
  ≈ 12 × 5 = 60.
- **`routes/tag-list-filter.integration.test.ts`**, per type:
  - `tagIds` any-match;
  - composes with search and pagination (`total` is correct);
  - never returns an unreadable object;
  - an unreadable tag id gives an empty page;
  - `include=tags` omits unreadable tags.
  ≈ 5 × 5 = 25.
- **`services/tag-tombstone.integration.test.ts`:**
  - each delete path soft-deletes its type's assignments;
  - connector delete sweeps instance + entity + view assignments;
  - station delete leaves its pins' tags;
  - tag delete removes it from all five types.
  ≈ 8.
- **`routes/entity-tag.router.integration.test.ts`:** `include=usage` counts per type, excludes unreadable and tombstoned objects, and gives zeros for unused. ≈ 4.
- **Migration:** a pre-existing entity row survives and satisfies the CHECK, and an insert with two targets fails. ≈ 2.
- **Route-map guard:** passes with the new entries (existing test).

### Web unit: `apps/web/src/__tests__/`

- `TagChip`, `TagChipList` (empty renders nothing), `TagAssignSelect` and `TagsSection` (allow gives select + deletable chips; hide gives read-only chips; hide + empty gives nothing; assign/unassign callbacks fire). Each has an axe check. ≈ 12.
- `Tags.view` / `TagCard` usage line, including "Not used". ≈ 3.
- The four list views: the filter is present, and `tagIds` is passed in `queryParams`. The four cards: the tag row is shown and omitted when empty. ≈ 8.
- The `tag-invalidation.util` keys, and the delete-key helpers including `tagAssignments.root`. ≈ 4.

**Totals ≈ 134 cases.**

## Acceptance criteria

- [ ] A caller with write on a station, pin, connector or view can add or remove a tag on its detail page, and the change shows on the list and detail pages without a reload.
- [ ] A read-only caller sees an object's tags but no tag editing. The API answers 403, and 404 for an unreadable object.
- [ ] Each of the four list pages filters by tag (any-match). The filter composes with search, sort and pagination, never shows an unreadable object, and a filter with no matches shows the page's empty state.
- [ ] A tag from another org, or one the caller can't read, can't be assigned (404).
- [ ] Assigning a tag twice gives a 409, including under concurrent requests, never a 500.
- [ ] Deleting a tag removes it from every object type. Deleting a tagged station, pin, connector or view removes its assignments.
- [ ] Tagging a connector during a running sync or import succeeds (`locks: none`).
- [ ] The Tags page shows per-type usage counting only objects the caller can read.
- [ ] Entity tagging behaves as before at the same URLs.
- [ ] The glossary, FAQ, troubleshooting and empty-list help describe tags across all five types.

## Risks & rollback

- **The CHECK on existing data.** Every live row has `connector_entity_id`, so the CHECK validates. Fail-closed: the migration aborts under `db:upgrade`'s lock, and the schema stays valid.
- **Usage-count cost.** Five grouped queries per Tags page, each over the indexed tag id and bounded by the page's tags. Measured during smoke.
- **Leaking tags through include.** Fixed by filtering to readable tags. Integration tests cover each type.
- **Rollback.** The columns are additive, so reverting the code leaves new-type rows unread and harmless. Entity rows are unchanged.

## Files touched

- **New:**
  - `packages/core/src/models/tag-target.model.ts`
  - `apps/api/src/services/tag-assignment.service.ts`
  - `apps/api/src/routes/tag-assignment.router.ts`
  - `apps/api/drizzle/<n>_tag-assignment-targets.sql` + meta
  - `apps/web/src/api/tag-assignments.api.ts`
  - `apps/web/src/utils/tag-invalidation.util.ts`
  - `apps/web/src/components/{TagChip,TagChipList,TagAssignSelect,TagsSection}.component.tsx` + tests
  - the API integration tests above
- **Deleted:** `apps/api/src/routes/entity-tag-assignment.router.ts`, `apps/web/src/api/entity-tag-assignments.api.ts`.
- **Edited:**
  - **Core:** `entity-tag-assignment.model.ts`, `entity-tag-assignment.contract.ts`, `entity-tag.contract.ts`, `station.contract.ts`, `portal.contract.ts`, `connector-instance.contract.ts`, `curated-view.contract.ts`, `glossary.util.ts`, `faq.util.ts`, `troubleshooting.util.ts`.
  - **API schema and data:** `entity-tag-assignments.table.ts`, `zod.ts`, `type-checks.ts`, `entity-tag-assignments.repository.ts`.
  - **API routes and services:** `connector-entity.router.ts`, `connector-entities.repository.ts`, `station.router.ts`, `station-query.service.ts`, `portal-results.router.ts`, `connector-instance.router.ts`, `curated-view.router.ts`, `curated-view.service.ts`, `curated-view-delete.service.ts`, `connector-entity-validation.service.ts`, `entity-tag.router.ts`, `protected.router.ts`, `swagger.config.ts`, `api-codes.constants.ts` (if a target-type code is missing).
  - **API tests:** `route-authorization.map.ts`.
  - **Web:** `api/keys.ts`, `api/sdk.ts`, `delete-invalidation.util.ts`, `glossary-routes.util.ts`, `empty-list-help.util.ts`, `Entities.view.tsx`, `EntityDetail.view.tsx`, `Stations.view.tsx`, `StationDetail.view.tsx`, `StationList.component.tsx`, `PinnedResultsListView.view.tsx`, `PinnedResultDetail.view.tsx`, `PinnedResultsList.component.tsx`, `Connector.view.tsx`, `ConnectorInstance.view.tsx`, `ConnectorInstance.component.tsx`, `CuratedViews.view.tsx`, `CuratedViewDetail.view.tsx`, `Tags.view.tsx`, `TagCard.component.tsx`, `DeleteTagDialog.component.tsx`.

## Next step

`docs/TAG_MORE_OBJECT_TYPES.plan.md` sequences this into about nine TDD slices, each a commit on this branch:

1. Schema, migration and core model.
2. Repository + service, with entity routes moved onto the factory (no behaviour change except the race-safe 409).
3. The four new assignment mounts and route map.
4. List `tagIds`/`include=tags` × 4, plus the entity readable fix.
5. Tombstone sweeps.
6. Usage counts.
7. Web SDK, keys and shared components.
8. The four list and detail views, the Tags page and EntityDetail/Entities refactor.
9. Docs copy.
