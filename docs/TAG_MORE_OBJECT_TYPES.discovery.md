# Tagging stations, pins, connectors and views — Discovery

**Issue:** [EnterpriseBT/portal-ai#1070](https://github.com/EnterpriseBT/portal-ai/issues/1070)

**Why this exists.** Tags are the org's one organising tool, but an assignment can only point at a connector entity (`entity_tag_assignments.connector_entity_id`). Stations, pinned results, connector instances and curated views are the other objects users manage in volume, and their list pages can only be searched. The ticket keeps the tag catalog exactly as it is and widens the set of things a tag can be assigned to, with the same write-on-object rule, the same list filter (`tagIds`) the Entities page has, and tag editing on each detail page.

So this is the change that turns entity tagging into **object tagging**, on one assignment table and one shared assignment path that #1071's agent tools can call as well.

## The current shape

### Schema and models

| Piece | Location | Note |
|---|---|---|
| Catalog | `apps/api/src/db/schema/entity-tags.table.ts:9-17` | Org-scoped, soft-deleted. No unique index on name (the app checks duplicates through `findByName`, then answers 409) |
| Assignments | `apps/api/src/db/schema/entity-tag-assignments.table.ts:29-48` | `connector_entity_id` NOT NULL FK, `entity_tag_id` FK, soft-deleted. Partial unique `(connector_entity_id, entity_tag_id) WHERE deleted IS NULL` |
| Core models | `packages/core/src/models/entity-tag.model.ts:4`, `entity-tag-assignment.model.ts:4-7` | Assignment fields: `connectorEntityId`, `entityTagId` |
| Contracts | `packages/core/src/contracts/entity-tag.contract.ts:15,36`, `entity-tag-assignment.contract.ts:13` | `EntityTagWithAssignmentCountSchema` (:36) is defined but nothing uses it |
| Repository | `apps/api/src/db/repositories/entity-tag-assignments.repository.ts:30-164` | Every method is keyed by entity: `findByConnectorEntityIds` (powers `include=tags`), `findExisting`, `softDeleteByConnectorEntityIds` |

### Routes and authorization

- **Assignment routes:** `/api/connector-entities/:connectorEntityId/tags` (GET, POST, DELETE `/:assignmentId`), at `entity-tag-assignment.router.ts:125,261,431`. They're mounted at `connector-entity.router.ts:60-63`.
- **Write check:** `assertEntityWritable` (:61-82) does `readableInOrg` (404 if it fails), then `resource.write` on the entity. A POST also needs the tag to be readable in the org (:289-304). The GET returns only tags the caller may read (:156-169).
- **Duplicates:** checked before the insert (`findExisting`, then 409 `ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS`, :306-320). Two concurrent POSTs both pass the check, and the second hits the unique index as a **500**.
- **Tag delete** (`entity-tag.router.ts:656-700`): `loadForVerb(…, "tag", …, "delete")`, then, in one transaction, the tag's assignments are soft-deleted followed by the tag itself.
- **Route map:** assignment POST and DELETE declare `locks: { none: "tag assignments; no job reads or writes them" }` (`route-authorization.map.ts:51,638`). Tag CRUD declares `none` too. Entity tagging doesn't go through `JobLockService`.

### List filtering and include

- **`tagIds` filter** (`connector-entity.router.ts:195-213`): turns into `id IN (SELECT connector_entity_id FROM assignments WHERE entity_tag_id IN (…) AND deleted IS NULL)`, which matches entities carrying **any** of the tags. It sits in the same `filters[]` as the org, search and `visibilityPredicate("entity")` predicates, so `count` and offset paging agree.
- **`include=tags`** goes through `connector-entities.repository.ts:96-125`. It does **not** filter tags by tag-read visibility (the assignment GET does).

### The four target types

| Type (permission type) | Table | List route | Reads `include`? | Delete path |
|---|---|---|---|---|
| Station (`station`) | `stations.table.ts:13` | `station.router.ts:391` → `StationQueryService.listForCaller` | No (only `GET /:id`, :517) | `station.router.ts:1106-1215`: one tx tombstoning portals, station views, instances and toolpacks. Pins survive, with `portalId` nulled |
| Pin (`pin`) | `portal-results.table.ts` | `portal-results.router.ts:452` | Yes, `portal` (:493) | `:801-827`, a bare `softDelete` |
| Connector instance (`connector_instance`) | `connector-instances.table.ts:23` | `connector-instance.router.ts:155` | Yes, `connectorDefinition` | `:1429-1550` under `withUnlocked`. Already soft-deletes its **entities'** tag assignments (:1516) |
| Curated view (`curated_view`) | `curated-views.table.ts:26` | `curated-view.router.ts:77` → `CuratedViewService.list` | No (in the contract, :47, but unread) | `CuratedViewDeleteService.deleteByIds` (`curated-view-delete.service.ts:44-100`), the one path that every view delete takes, entity and connector cascades included |

All four lists page by offset and filter through `visibilityPredicate(<type>)`. Entity delete (`connector-entity-validation.service.ts:82-160`) tombstones its tag assignments at :134. Org delete and reset hard-delete by org (`organization-delete.service.ts:194`, `reset.service.ts:145-150`), so they cover new rows for free.

### Web

- **Entities list** (`Entities.view.tsx`): `DetailCard`s with a "Tags" `MetadataList` row of inline colour-dot `Chip`s (:84-111, hidden when there are none). The filter is `{type: "multi-select", field: "tagIds"}` over `sdk.entityTags.search()` (:138, :157-163). Filter state is React state, not URL state.
- **EntityDetail:** a "Tags" `PageSection` sits under the header (:386-425). It holds a local `TagAssignSelect` (:84-124, over `AsyncSearchableSelect`) and removable chips, gated by `entityDetailActionGates(...).canEditTags` (`entity-actions.util.ts:79`, i.e. `capabilities.write`). It invalidates only `entityTagAssignments.listByEntity` (:804, :816).
- **The chip markup is duplicated** across those two views. No `TagChip` component exists.
- **SDK:** `entity-tag-assignments.api.ts:11` is hard-wired to `/api/connector-entities/:id/tags`. Keys live at `api/keys.ts:174-196`.
- **Delete invalidation:** none of the helpers in `delete-invalidation.util.ts` refreshes tag lists, so today a deleted tag stays on detail pages until their next refetch.
- **Tags page** (`Tags.view.tsx`, `TagCard.component.tsx:43-68`): shows no usage and has no detail route. `DeleteTagDialog.component.tsx:69-70` talks about entities only.
- **Target views:** all four lists (Stations, PinnedResultsList, Connector, CuratedViews) are `CardList` + `DetailCard` + `MetadataList`. Only Connectors already has a filter (`status`, :134-157). Each detail view has a `PageHeader`, then its first `PageSection`, where a Tags section would slot in as it does on EntityDetail.
- **Copy:** glossary "Entity Tag" (`glossary.util.ts:223-231`), FAQ "How do tags work?" (`faq.util.ts:221-225`), `glossary-routes.util.ts:38`, and `empty-list-help.util.ts:34,39,54,64,74`.

## The design space

### Decision 1 — Assignment schema shape

**A. One table per type** (`station_tag_assignments`, …). This mirrors today's table four more times: real FKs and simple indexes, but five copies of every repository method, and usage counts or tag delete fan out over five tables.

**B. Polymorphic** `target_type` + `target_id` on one table, with no FK. A new type costs nothing, but there's no referential integrity, and a typo in `target_type` is a silent orphan.

**C. Exclusive arc.** Keep the one table, add nullable FK columns `station_id`, `portal_result_id`, `connector_instance_id` and `curated_view_id`, relax `connector_entity_id` to nullable, and add `CHECK (num_nonnulls(…) = 1)` plus one partial unique `(<target>, entity_tag_id) WHERE deleted IS NULL` per column.

| | A | B | C |
|---|---|---|---|
| Referential integrity | FK | none | FK |
| Tag delete / usage | 5 tables | 1 query | 1 query |
| Duplicate guard | per table | one composite index | per column |
| Migration | 4 new tables | rewrite existing rows | additive columns + CHECK |
| Adding a type later | new table | free | one column + index |

**Lean: C.** It keeps FKs and the existing rows untouched, the migration is purely additive (expand-only), and tag delete stays the one-transaction sweep it is today. The type count is small and fixed by the ticket's out-of-scope list.

### Decision 2 — Naming: generalise or keep `entity_tags`

**A. Full rename:** tables to `tags` / `tag_assignments`, routes to `/api/tags`, models to `Tag`. **B. Keep the storage and route names, generalise only the code and copy.** `entity_tags`, `entity_tag_assignments` and `/api/entity-tags` stay. New shared code is named `Tag…` (`TagAssignmentService`, `TagChip`), and user-facing copy says "Tag".

A table rename isn't expand-only. During a rolling deploy, old tasks still query `entity_tags` after the migration has renamed it. A route rename breaks the SDK contract for no user-visible gain.

**Lean: B.** It keeps the migration expand-only (`db:upgrade` / `lint:migrations` rules) and leaves the deployed contract alone. The cost is an `entity_` prefix on storage names that now hold more than entities, recorded in the table file's doc comment. #1071's tools are named `tag_*` either way.

### Decision 3 — API surface for the new types

**A. Nested per type** (`/api/stations/:id/tags`, `/api/portal-results/:id/tags`, `/api/connector-instances/:id/tags`, `/api/curated-views/:id/tags`), matching the entity routes. **B. One generic route** `/api/tag-assignments?targetType=&targetId=`.

**Lean: A, built from one router factory** parameterised by a target descriptor (permission type, org-scoped loader, assignment column). Each route keeps an explicit route-map entry and `@openapi` block. The entity routes move onto the same factory, so all five types share one check sequence: load the target org-scoped and readable (else 404), check write on the target (else 403), check the tag is readable in the org (else 404).

### Decision 4 — Duplicate assignment: 409 or idempotent

**A. Keep 409, make it race-safe:** insert with `ON CONFLICT DO NOTHING` against the partial index, and answer 409 when nothing was inserted. **B. Idempotent 200,** returning the existing assignment.

**Lean: A for HTTP, with the service returning `{assignment, created}`.** That keeps the entity route's existing contract and removes the 500. #1071's tools read `created: false` as a no-op success, which their ACs require. Unassigning an already-removed assignment stays a 404 over HTTP.

### Decision 5 — Tag usage on the Tags page

**A. Per-type counts on each tag card** ("4 entities · 2 views"). **B. A new tag detail page** listing tagged objects across types. **C. Counts that link** to each list pre-filtered by the tag.

**Lean: A.** The ticket's "tag detail" doesn't exist today, and B would add a cross-type list page with its own paging. C needs list filters to be URL-addressable, which no list supports yet (filters are React state). Counts must cover **readable objects only**: counting assignments on objects the caller can't read leaks their existence. They come from `include=usage` on `GET /api/entity-tags`, revive the unused `EntityTagWithAssignmentCountSchema` with a per-type breakdown, and each count joins through its type's `visibilityPredicate`.

## Tradeoff comparison

|  | C exclusive arc | B keep storage names | A nested + factory | A race-safe 409 | A readable counts |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes |
| Migration | additive | none | none | none | none |
| Shared with #1071 | table | names | service | `created` flag | — |

## Recommendation

1. Extend `entity_tag_assignments` with nullable FK columns `station_id`, `portal_result_id`, `connector_instance_id` and `curated_view_id`, relax `connector_entity_id` to nullable, add `CHECK (num_nonnulls(connector_entity_id, station_id, portal_result_id, connector_instance_id, curated_view_id) = 1)`, a partial unique `(<target>, entity_tag_id) WHERE deleted IS NULL` per new column, and an index on `(entity_tag_id) WHERE deleted IS NULL` for the filter and counts.
2. Keep `entity_tags`, `entity_tag_assignments` and `/api/entity-tags` as named. New shared code is `Tag…`, and user-facing copy says "Tag" (the glossary term "Entity Tag" becomes "Tag", with `glossary-routes` and every `relatedGlossaryTerms` reference renamed in the same change).
3. Add a `TagAssignmentService` with `list(target)`, `assign(target, tagId) → {assignment, created}`, `unassign(target, assignmentId)` and `softDeleteForTargets(type, ids, tx)`. It's keyed by a `TagTarget = {type: "entity" | "station" | "pin" | "connector_instance" | "curated_view", id}`.
4. Serve `GET/POST/DELETE /<type>/:id/tags[/:assignmentId]` for all five types from one router factory. Each route is classified in the route map with `locks: { none: "tag assignments; no job reads or writes them" }`, the rule entity tagging already follows, so tagging a connector under a running sync is allowed.
5. Make duplicate assignment race-safe: `ON CONFLICT DO NOTHING`, and 409 `ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS` when nothing was inserted.
6. Add `tagIds` (any-match, through a shared `taggedWithAny(column, type, tagIds)` subquery) and `include=tags` to the four list endpoints, inside the same `where` as their `visibilityPredicate` so `count` and paging stay correct. Station and curated-view lists start reading `include`.
7. `include=tags`, on every type including entities, returns only tags the caller may read (this closes today's entity gap). A `tagIds` value naming an unreadable or foreign tag matches nothing.
8. Every tombstone path soft-deletes its type's assignments in its own transaction:
   - station delete (`station.router.ts:1106`);
   - pin delete (`portal-results.router.ts:801`);
   - connector-instance delete, for the instance's own assignments, alongside the entity sweep it already does;
   - `CuratedViewDeleteService.deleteByIds`, which covers every view cascade.
   An integration test per type proves it.
9. Tags page: `include=usage` on `GET /api/entity-tags` returns per-type counts over readable objects, rendered on `TagCard`. `DeleteTagDialog`'s copy covers all object types.
10. Web: extract `TagChip` / `TagChipList`, a `TagAssignSelect` component and a `TagsSection` (UI + container keyed by `TagTarget`). Use them on EntityDetail and the four new detail views (gated by `capabilities.write`, so a read-only caller sees chips with no editing), and on the five list cards. Add the `tagIds` multi-select filter to the four lists.
11. SDK: a generic `sdk.tagAssignments.{list, assign, unassign}(target)` replaces `entityTagAssignments`, under `queryKeys.tagAssignments.listByTarget(type, id)`.
    - Assigning or unassigning invalidates that key plus the target type's `.root` (its list carries tags).
    - Tag delete or update invalidates `tagAssignments.root` and the five types' roots.
    - The per-object delete-key helpers gain `tagAssignments.root`.
12. Docs: glossary, FAQ and `empty-list-help` copy for the five pages and the Tags page. Add a troubleshooting entry for "I can't add a tag" (needs write on the object).

## Open questions

1. **Station delete leaves pins alive.** A station's pins survive its delete, with `portalId` nulled. Should a pin's tags survive too? **Lean: yes.** The pin is still a live, listed object, so its tags stay until the pin itself is deleted.
2. **Usage-count cost.** Counting through five `visibilityPredicate` joins per tag list could be slow for an org with thousands of tagged objects. **Lean: accept it.** It's one grouped query per type over the indexed `entity_tag_id` column, the Tags list is short and paginated, and it's measured during smoke rather than pre-optimised.
3. **Filter match semantics.** The Entities filter is ANY, and the ticket says "the same match semantics". Do users want ALL for narrowing? **Lean: ANY,** for parity. ALL is a follow-up if asked for.
4. **Pins' detail editing.** PinnedResultDetail gates on a `canWrite` prop rather than an `ActionGate`. **Lean: pass a `decideActionGate({allowed: capabilities.write})` gate into `TagsSection`,** like the other four, and leave the pin's existing controls as they are.
5. **Per-object tag cap.** Nothing bounds how many tags an object carries. **Lean: no cap.** The catalog is org-curated and an object's tags are rendered as chips, so the volume is human-scale. A cap would be a new rule, which the ticket excludes.

## Enterprise-scale considerations

- **Concurrency & correctness:** the check-then-insert race becomes `ON CONFLICT DO NOTHING` against the partial index (Decision 4). The CHECK constraint makes a row with zero or two targets impossible. Tombstone sweeps run inside each delete's existing transaction. **Lean:** DB-enforced, no app-level locking.
- **Accuracy & auditability:** assignments are soft-deleted rows with `createdBy`/`deletedBy`, as today. **Lean:** sufficient. Tags aren't billing data.
- **Failure modes:** a failed assignment write fails the request (fail-closed). A failed `include=tags` load fails the list, as entity lists do today. **Lean:** no degradation path needed.
- **Scale & unbounded growth:** the filter is an `IN (subquery)` on the new `entity_tag_id` index, and includes batch-load per page (`findByTargetIds`, never per row). **Lean:** bounded by page size, with no N+1.
- **Multi-tenancy:** the tag and the target are each loaded org-scoped, so a foreign id is 404. Counts and includes go through `visibilityPredicate`. **Lean:** no new cross-tenant surface.
- **Contract stability:** a `TagTarget` descriptor plus a router factory means a future taggable type is one column, one descriptor and one route-map entry. #1071's tools sit on the same service. **Lean:** this is the shape to build.
- **Data lifecycle:** tombstoned assignments follow their parent's lifecycle. Volume is tiny next to records, so no retention purge is needed. **Lean:** N/A because assignment rows are human-scale metadata.

## What this doesn't decide

- **Agent tag tools** belong to #1071, which builds on `TagAssignmentService`.
- **URL-addressable list filters**, needed for the count links in Decision 5C. That's a cross-list pattern beyond this ticket.
- **A tag detail page** listing objects across types (Decision 5B). There's no consumer for it beyond counts yet.
- **ALL-match filtering** and favorites, both out of scope per the ticket.

## Next step

`docs/TAG_MORE_OBJECT_TYPES.spec.md` pins the contracts: the migration, `TagTarget`, the five route shapes and their route-map entries, `include=tags`/`usage` and `tagIds`. `docs/TAG_MORE_OBJECT_TYPES.plan.md` slices it test-first:

1. Schema + migration + core model.
2. `TagAssignmentService` + router factory, with entity routes moved onto it.
3. The four new assignment routes.
4. List `tagIds`/`include` per type.
5. Tombstone sweeps.
6. Usage counts.
7. Web components + SDK.
8. The four list/detail views.
9. Docs copy.
