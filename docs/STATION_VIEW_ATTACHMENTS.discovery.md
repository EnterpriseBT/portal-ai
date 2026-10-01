# Station view attachments + empty-station warnings — Discovery

**Issue:** [EnterpriseBT/portal-ai#674](https://github.com/EnterpriseBT/portal-ai/issues/674)

**Why this exists.** Since #599, everything a user can read in a station comes through the **curated views attached to it** (`station_views`): agent SQL, map tiles, `station_context` and `resolve_identity` (#643, #648, #658, #660).

The web app still can't attach one:
- **Dialogs:** both station dialogs only pick connector instances.
- **Contracts:** the station create/update contracts carry only `connectorInstanceIds`.
- **Attaching:** happens only through `POST /api/curated-views/:id/attach` or the one-time 0113 backfill, and nothing in the web app calls that route.

Every empty-station warning keys on connectors or entities. So a station with connectors and no views gives its users an empty workspace, no explanation and no way to fix it.

This is the feature that makes views a first-class station attachment, alongside connectors:
- **Picking:** in the same form.
- **Permission rule:** the same for both. A user with `edit` on the station attaches anything they can `read`.
- **Lifecycle:** the same for both.
- **Warnings:** the same for both, in the UI and in the agent's own words.

## The current shape

### Station writes (`apps/api/src/routes/station.router.ts`)

| Piece | Location | Note |
|---|---|---|
| Body schemas | `packages/core/src/contracts/station.contract.ts:81-86`, `:101-110` | `connectorInstanceIds: z.array(z.string()).optional()`; no view ids |
| Create permission | `station.router.ts:462` | `resource.write` on `{type:"station"}` only. **No `read` check on the connector ids** (existence, org or readability) |
| Create writes | `:510-527` | `Promise.all(stationInstances.create…)`; not in a transaction |
| Update permission | `:674` | `resource.write` on the station |
| Update writes | `:741-770` | **Replace-all:** hard-deletes every `station_instances` row, then re-creates. Unreadable attachments would be dropped |
| GET detail | `:294-345` | `include=connectorInstance` → `stationInstances.findByStationId` (`station-instances.repository.ts:28-40`). **Instances not filtered by the caller's `read`**; no views; returns `canShare` / `canWrite` / `canDelete` |
| Delete | `:873`, `:900-916` | Soft-deletes the station in a transaction; **doesn't touch `station_views`** |
| Audit | none | Unlike `connector-instance.router.ts:830` (`AuditService.record`) |

### Views and their attachment table

| Piece | Location | Note |
|---|---|---|
| `station_views` | `apps/api/src/db/schema/station-views.table.ts:14-35` | `baseColumns` (`created_by`, soft-delete `deleted`), `organization_id`, partial unique `(station_id, curated_view_id) WHERE deleted IS NULL`; `station_instances` has the same shape (`station-instances.table.ts:23`) |
| Repository | `station-views.repository.ts:23` | `findByStationId` only |
| Attach | `curated-view.router.ts:688`, `:716-741` | Requires `resource.write` on the **view**, not station `edit`; dedupes by find-then-insert |
| Detach | `:778`, `:796-805` | View `write`, then `softDeleteMany`; no station check |
| View delete | `:619-625` | Soft-deletes the view's attachments |

### Permission-filtered lists (the principle the picker must follow)

- **Connector instances:** `GET /api/connector-instances` ANDs `PermissionService.loadSet(...).visibilityPredicate("connector_instance", …)` into the query, with `ilike` search (`connector-instance.router.ts:180`, `:203-209`).
- **Curated views:** `GET /api/curated-views` does the same with `visibilityPredicate("curated_view", …)` (`curated-view.router.ts:141-215`, `:182-188`), plus `search`, `connectorEntityId` and `stationId`.
- **The connector picker:** `ConnectorInstancePicker.component.tsx` fetches `limit: 100` once and filters on the client (`MultiSearchableSelect`).
- **Async multi-select:** `@portalai/core/ui` has `MultiAsyncSearchableSelect` (`packages/core/src/ui/searchable-select/`), already used in `modules/AccessAuthoring/StatementEditor.component.tsx`.

### Web surfaces

| Surface | Location | Today |
|---|---|---|
| Create dialog | `CreateStationDialog.component.tsx:43-56`, `:151-152`, `:316` | Schema validates name + toolPacks; sends `connectorInstanceIds` only if non-empty |
| Edit dialog | `EditStationDialog.component.tsx:70-78`, `:113`, `:186-189`, `:284` | Seeds from `station.instances` (unfiltered); sends the full list when the sorted set changed |
| Station detail | `StationDetail.view.tsx:55`, `:264-287`, `:300-305` | Connector chips; "This station has no connector instances…" `Alert` |
| Portal header | `Portal.view.tsx:135-196` (`PortalHeaderMeta`) | Instances row hidden when empty; no warning |
| SDK / keys | `stations.api.ts`; `keys.ts:177-183` (`curatedViews`), `:200-207` (`stations`) | Attach/detach hooks exist (`curated-views.api.ts:80-93`), unused; **no `stationViews` key** |

### Agent-facing empty-station text

- **System prompt:** `system.prompt.ts:624-626` says "_No entities attached to this station yet._" when `stationContext.entities` is empty. Tested at `system.prompt.test.ts:90-93`.
- **`platform_help`:**
  - Situations are `no_packs | no_entities | no_records | unentitled_packs | default` (`platform-help.tool.ts:44-49`).
  - `entityCount` comes from `AnalyticsService.loadStation`, which is **connector-based** (`analytics.service.ts` ~`:305`). So "no entities" really means "no connectors".
  - Matching is at `:161-168` and prose at `:194-213`; tests are at `platform-help.tool.test.ts:142-191`.
- **`station_context`:** returns empty entities when no granted views resolve (`station-context.tool.ts:234-260`), with no reason given.

### Help content

- **Glossary:** "Station" (`glossary.util.ts:239-246`) is "groups connector instances and tool packs", and there's **no "Curated View" entry**.
- **FAQ:**
  - `:55-57`: "What is a Station" is connector-only.
  - `:261-263`: "vague answers → check that it has a connector instance" needs a views clause.
- **Getting started:** `getting-started.util.ts:31-35`, "Create a station: bundle your connector instances…".

## The design space

### Decision 1 — Contract shape for view ids on create/update

- **A. A full set: `curatedViewIds?: string[]`, mirroring `connectorInstanceIds`.** The client sends the set of attachments it wants **among those it can see**. The server computes the final set as *(existing attachments the user can't read) ∪ (requested ids)*, and writes only the difference (soft-delete removed, insert added).
- **B. Deltas: `attachCuratedViewIds` / `detachCuratedViewIds`.** This states intent explicitly, but adds a second shape alongside the connector field and makes the edit form compute deltas.
- **C. No contract change; the form calls the attach/detach routes.** That's N writes per save, no atomicity, and permission rules that differ from the station's.

| | A | B | C |
|---|---|---|---|
| Matches the existing connector field | yes | no | no |
| Atomic with the station save | yes | yes | no |
| Preserves unreadable attachments | server-side | by construction | n/a |
| Client complexity | lowest | medium | high |

**Decided: A**, applied to **both** `curatedViewIds` and `connectorInstanceIds`.
- **Shape:** one shape for both, and the edit form already sends a full set.
- **Preservation:** happens on the server, where the permission set lives, so a client can never detach what it can't see, whatever it sends.
- **Bug fix:** this also fixes today's hard-delete replace of connector links, which would otherwise violate the PRD.

### Decision 2 — Where the "attach what you can read" rule is enforced

- **A. In the station create/update routes.** Load the permission set once (`PermissionService.loadSet`, as GET does at `:318-327`). Require `resource.read` on **every** requested view and connector instance (with existence and same-org checks), and reject the whole request if any fails, writing nothing.
- **B. Also realign the standalone attach/detach routes to the same rule.** They'd require station `edit` plus view `read`, instead of view `write`.

**Decided: A + B.** Attaching or detaching is an **edit to the station, not to the view**, so `write` on the view is irrelevant.
- **One rule:** `edit` on the station, plus `read` on the attached object, whichever endpoint does it.
- **What's wrong today:** the attach route checks the view's `write`. That lets a view author attach to a station they can't edit, and stops a station editor from attaching a view they can read.
- **Impact:** nothing in the web app calls these routes today.
- **Error code:** reject with 403. Spec decides the code, e.g. `STATION_ATTACHMENT_NOT_READABLE`, uniform for missing, other-org and unreadable ids so nothing about existence leaks.

### Decision 3 — Atomicity and concurrency of the attachment writes

- **A. One `DbService.transaction` for the station row plus both attachment diffs.** Inserts use the partial unique indexes (`ON CONFLICT DO NOTHING`, restating `WHERE deleted IS NULL`). Removals are soft-deletes.
- **B. Keep today's separate calls.**

**Decided: A.**
- **Partial saves:** today a failure partway leaves a half-applied station.
- **Concurrent editors:** computing the diff inside the transaction, against the current rows, means two editors can't duplicate an attachment.
- **Hard deletes:** they lose the soft-delete trail the rest of the schema keeps.

### Decision 4 — The view picker

- **A. `MultiAsyncSearchableSelect` against `GET /api/curated-views?search=…`.** Server-side search and paging, filtered by the existing visibility predicate.
- **B. Mirror `ConnectorInstancePicker`: fetch `limit: 100` once and filter on the client.**

**Decided: A.**
- **Scale:** views are many per org (one per entity by default, plus authored ones), so a 100-row client list silently truncates.
- **Precedent:** `MultiAsyncSearchableSelect` is already used in the codebase.
- **Labels:** chips need labels for already-selected ids, which come from the station GET (Decision 5).
- **Connector picker:** stays as is. Moving it to async is noted under "doesn't decide".

### Decision 5 — Station detail payload for chips + warnings

*Amended after review.* Attachments the caller can't read are **shown**, by their real name, as **no-access chips**. They are not filtered out.

- **A. GET `/api/stations/:id` gains `include=curatedView`.** It returns **every** attached `views` and `instances` row, each with `canRead: boolean` evaluated against the caller's permission set. The station-level emptiness behind the warnings is then just the list lengths.
- **B. Separate fetches** (`curatedViews.list({stationId})` plus the station GET), with the client deciding which chips are no-access.

**Decided: A.**
- **Server-side check:** only the server can evaluate `read` per attachment; `canRead` is computed with one loaded set, never per row.
- **Payload:** the warnings use the full lists, so they're the same for everyone.
- **Consumers:** both the station detail page and the portal header read the one payload.
- **Chip:** the no-access chip is a new shared component used for both kinds, with an error outline, a lock icon, the tooltip "You don't have access to this view" / "…connector", and no click-through.
- **Edit dialog:** seeds its pickers only from `canRead` rows. The unreadable ones are preserved server-side (Decision 1) and never shown as removable.

### Decision 6 — Agent-facing (and UI) empty-station messages

*Amended in spec review.* Views don't gate all data access: connectors reach entity data through the entity-management toolpack. So neither kind's absence means "no data".

**Decided:**
- **One shared copy function in core** (`describeStationAttachmentGaps`) drives the UI alerts, the system prompt and `platform_help`, so they can't drift.
- **Missing:** when **neither** views nor connectors are attached, one combined message says both are missing. Otherwise it names whichever is missing.
- **No access:** among the kinds that are attached, when the caller can read none of them, "You don't have access to any views/connectors (or both) on this station."
- **`platform_help`:** its connector-based `no_entities` becomes `attachments_missing` and `attachments_inaccessible`.

## Tradeoff comparison

| | D1 full set, server-preserved | D2 one rule, both routes | D3 one transaction | D4 async picker | D5 all attachments + `canRead` | D6 shared empty-station copy |
|---|---|---|---|---|---|---|
| Spread to spec | yes | yes | yes | yes | yes | yes |
| Changes an existing contract | station create/update | attach/detach permission | no | no | station GET (additive) | `platform_help` situation names |

## Recommendation

1. Add `curatedViewIds?: string[]` to `CreateStationBodySchema` and `UpdateStationBodySchema`, alongside `connectorInstanceIds`.
2. On create and update, require `resource.write` on the station, then `resource.read` on every requested view and connector instance, through one loaded permission set. Reject the whole request with 403, without revealing which ids exist, if any fails.
3. On update, compute each attachment set as *(currently attached ids the caller can't read) ∪ (requested ids)*. Write only the difference: insert added with `ON CONFLICT DO NOTHING`; soft-delete removed.
4. Run the station row and both attachment diffs in one `DbService.transaction`.
5. Realign `POST`/`DELETE /api/curated-views/:id/attach` to the same rule: station `edit` plus view `read`, instead of view `write`.
6. GET `/api/stations/:id` adds `include=curatedView` and returns **all** attached `instances` and `views`, each with `canRead`, evaluated with one loaded permission set.
7. Both station dialogs add a view picker (`MultiAsyncSearchableSelect` over `GET /api/curated-views?search=`) next to the connector picker. Edit seeds it from the GET's filtered `views` and sends the full set when changed.
8. The station detail page and the portal header list every attached connector and view. Unreadable ones render, by real name, as a shared **no-access chip**: error outline, lock icon, tooltip "You don't have access to this view/connector", not clickable. Each surface warns when either list is empty, identically for every user. The edit dialog seeds its pickers from `canRead` rows only.
9. One core function, `describeStationAttachmentGaps`, provides every empty-station sentence for the UI, the system prompt and `platform_help`. It gives a combined "no views or connectors" when both are missing, otherwise names whichever is missing. When attached kinds aren't readable, it says "You don't have access to any views/connectors on this station". `platform_help`'s `no_entities` becomes `attachments_missing` / `attachments_inaccessible`.
10. Emit audit events for attachment changes on station create, update and attach/detach, with ids, not names.
11. Station delete soft-deletes its `station_views` alongside its other attachments.
12. Invalidate `stations.root` and `curatedViews.root` on station create, update and attach/detach.
13. Update the help content: add a "Curated View" glossary entry; add views to "Station"; add a views clause to the FAQ at `:55-57` and `:261-263`; update getting-started `:31-35`.

## Open questions

All resolved in review:

1. **Views attached but none readable:** the agent says "You don't have access to any views on this station" (or "…connectors"). The UI shows those attachments as no-access chips (Decisions 5 and 6).
2. **Station delete soft-deletes `station_views`:** approved (Recommendation 11), together with whatever `station_instances` handling exists.
3. **Audit events:** approved: `station.attachments_changed`, with `{ added, removed }` ids, through `AuditService.record`. Spec pins the vocabulary.
4. **Create dialog with no views:** approved. A non-blocking inline hint, the same as the detail page.

## Enterprise-scale considerations

- **Concurrency & correctness:** two editors saving at once must not duplicate or lose attachments. Lean: the diff is computed inside the transaction, and inserts rely on the partial unique indexes (`ON CONFLICT DO NOTHING`).
- **Accuracy & auditability:** attachment changes alter who can read what in a station, which is an access-control change. Lean: an audit event per change, with ids, through the existing audit service.
- **Failure modes:** permission checks fail closed. Any unreadable or missing requested id rejects the whole save with nothing written. A failed transaction leaves the station unchanged, so there are no half-saves.
- **Scale & unbounded growth:** an org can have thousands of views. Lean: async server-side search for the picker. The station GET evaluates `canRead` for its attachments through one `loadSet` per request, never per id. A station's attachments are bounded by what its editors attach.
- **Multi-tenancy:** every requested id is checked for same-org as part of the `read` check, and the existing `organization_id` columns scope the writes. A cross-org id is indistinguishable from an unreadable one (403).
- **Contract stability:** `curatedViewIds` matches `connectorInstanceIds`, and `attachmentCounts` is additive. Future attachment kinds (e.g. toolpack instances already ride the same form) follow the same full-set, server-preserved shape.
- **Data lifecycle:** soft-delete everywhere (view delete and station delete), matching connector instances. No new retention window. `station_views` tombstones are covered by any future purge on the same terms as `station_instances`.

## What this doesn't decide

- **Moving `ConnectorInstancePicker` to an async select.** It still truncates at 100. That's a separate small ticket, since its 100-row behaviour predates this.
- **An agent tool for attaching views.** That's #645, the view-management toolpack.
- **Sharing or granting views.** That belongs to the RBAC surfaces. This feature only attaches views the user can already read, and shows the rest as no-access chips.
- **A bulk "attach every view over this connector".** Excluded by the PRD: views and connectors are independent.

## Next step

`docs/STATION_VIEW_ATTACHMENTS.spec.md` pins:
- the contract changes (`curatedViewIds`, `attachmentCounts`, `include=curatedView`);
- the 403 code;
- the audit event shape;
- the `platform_help` situation set;
- the per-layer test plan.

`docs/STATION_VIEW_ATTACHMENTS.plan.md` then slices it, roughly:
1. core contracts plus the server write path (permission checks, preserving diff, transaction, audit);
2. the GET payload (filtered lists plus counts) and attach/detach realignment;
3. the dialogs' view picker;
4. the detail-page and portal-header lists and warnings;
5. agent-facing text;
6. help content.
