# Gate data & connector actions per object — Condensed design (#689)

**Issue:** [EnterpriseBT/portal-ai#689](https://github.com/EnterpriseBT/portal-ai/issues/689) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic #684. Audit rows 13–28 in `docs/PER_OBJECT_ACTION_AFFORDANCES.discovery.md`. `apps/web`, plus one small `core`+`api` addition for jobs (Decision 6 — the only exception to the sizing).

**Why.** This is the last area child. Every payload these surfaces use already carries `capabilities: {read, write, delete}` (connector instances, entities, records, field mappings, column definitions, tags, entity groups — `packages/core/src/contracts/capabilities.contract.ts`), yet **no view in rows 13–28 reads it or uses `useActionGate`**. They gate on the connector's `enabledCapabilityFlags.write` (a connector feature switch, not a permission), on `cd.system`, or on nothing, so a read-only caller sees Edit/Delete/Sync/Create everywhere and gets a 403.

## Current shape

| Row | Piece | Location | Today |
|---|---|---|---|
| 13 | Instance Edit / Sync / Reconnect / menu (Edit, Modify Layout Plan, Delete) / Create Entity | `views/ConnectorInstance.view.tsx:360-457, 644-659` | raw `disabled={isLocked}` + Tooltip; menu `{kind:"disable"}` with hardcoded "Paused until the running job finishes"; Reconnect ungated; no `ci.capabilities` |
| 14 | Write/Sync/Push flag checkboxes | `ConnectorInstance.view.tsx:524-634` | disabled only on unsupported/pending; server needs write + unlocked (`connector-instance.router.ts:1612,1622`) |
| 15 | Layout plan editor + entry | `views/EditLayoutPlan.view.tsx:256-334`; route `connectors.$connectorInstanceId.layout-plan.edit.tsx` | full editor for any reader (edit-context needs only read); "Commit plan" `:329` disabled only while committing; fallback links to non-existent `/connectors/new/file-upload` (`:273`). View already loads the instance (`:359`) |
| 16 | Catalog Connect; Connected-tab Delete | `ConnectorDefinition.component.tsx:68-75`; `ConnectorInstance.component.tsx:90-97`; `Connector.view.tsx:180-187, 312-325` | Connect always shown, incl. inactive definitions (filter is user-toggleable); card Delete ungated |
| 17 | Tag chips unassign + `TagAssignSelect` | `views/EntityDetail.view.tsx:404-420` | gated on class `tag.read` only; server needs entity write |
| 18 | Delete records / Re-validate; header Edit/Delete; Create record | `EntityDetail.view.tsx:331-356, 456-501` | write flag + lock via hand-rolled tooltip span (`:250-254`); Re-validate ignores lock + flag. Server: clear/revalidate are **class** `entity_record` delete/write |
| 19 | Entities Create; card Delete | `views/Entities.view.tsx:170-178, 59-70` | ungated; card Delete on write flag only |
| 20 | Dialog openers | EntityDetail `:584,:597`; `ColumnDefinitionDetail.view.tsx:306-313, ~539-551`; `EntityRecordDetail.view.tsx:282-318` | write flag only; `fm.capabilities` / `record.capabilities` unused; field-mapping Create ungated |
| 21–22 | Column definition Create / Edit / Delete | `ColumnDefinitionList.view.tsx:96-102`; `ColumnDefinitionDetail.view.tsx:212-237`; `ColumnDefinition.component.tsx:52, 62-71` | Create ungated (server: class owner/admin); system Edit is `disabled` + native `title` (never shown on a disabled MUI button); card takes bare model, no `capabilities` |
| 23 | "Confirm & Save" | `EditColumnDefinitionDialog.component.tsx:397-403`; `EditFieldMappingDialog.component.tsx:380-388` | no `disabled`, but already safe: the handler submits and retires the warning in one step, and the warning can't appear mid-save (Save disabled, Enter blocked) |
| 24 | Tags Create / Edit / Delete | `views/Tags.view.tsx:84-90, 123-129`; `TagCard.component.tsx:10, 20-27` | ungated; card takes bare `EntityTag` |
| 25 | Groups Create / Edit / Delete / members | `views/EntityGroups.view.tsx:80-88, 154-204`; `EntityGroupDetail.view.tsx:321-412` | ungated (Edit/Delete gate only pending state); member add/remove/primary need group write |
| 26–27 | REST / region-editor workflow commit | `RestApiConnectorWorkflow.component.tsx:191, 594-710`; `modules/RegionEditor/ReviewStep.component.tsx:521-535` | state-gated (conforming); only entry is catalog Connect (row 16) |
| 28 | Job Cancel | `views/JobDetail.view.tsx:77-89` | shown to every reader; server = creator, or class `job.delete` (`jobs.router.ts:347-376`); payload has no `capabilities`, and the client has no DB user id |

Locks: `sdk.connectorInstances.runningJobs` / `sdk.connectorEntities.runningJobs` + `joinRunningJobLabels`. Mutations for these types have no `onPermissionDenied` yet (only portals and curated views do, `api.util.ts:166-172`).

## Decisions

1. **One lock reason.** Instance and entity surfaces compute `blocked = lockedReason` ("`<labels>` is running on this connector — try again when it finishes.") once, and feed it to every action's `gate({allowed, blocked})`. The hardcoded "Paused until…" string goes.
2. **The connector's write flag is state, not permission.** `enabledCapabilityFlags.write === false` → `blocked: "Writes are disabled on this connector"` (`disable`), after the permission check. Permission comes only from `capabilities` (or class `canOnResource` for creates).
3. **Gates per row:**
   - Instance (13): Edit, Modify Layout Plan, Reconnect, Sync → `ci.capabilities.write`; Delete → `.delete`; Create Entity → class `canOnResource("entity","write")` (the server's owned entity create), then the write flag. All `+ blocked: lockedReason`, except Reconnect, which the server doesn't lock. Raw buttons become `GatedButton`.
   - Flags (14): without `write` → read-only display (On/Off text, no checkboxes). With write and locked → checkboxes `disabled`, with the lock reason as helper text.
   - Catalog (16): Connect → `canOnResource("connector_instance","write")` (hide); inactive definitions render no Connect. Card Delete → `row.capabilities.delete`.
   - Entity (17–18): tag unassign/assign, header Edit, Create record → `entity.capabilities.write`; header Delete → `.delete`; Delete records / Re-validate → class `entity_record` delete/write (matching the server), then flag, then lock.
   - Index Creates (19, 21, 24, 25) follow the plausible-primary pattern from `CuratedViews.view.tsx:180-191`: `allowed` = class `write`, `primary.plausible` = class `read`, with a grant hint. Field-mapping Create (a section action) hides.
   - Records, field mappings, column definitions, tags, groups (20, 22, 24, 25): row/detail Edit → `capabilities.write`; Delete → `.delete`; group member add/remove/primary → `group.capabilities.write`. **System column definitions** → `disable` "System column definitions are read-only" (a real tooltip). `ColumnDefinitionCardUI` and `TagCard` take the capability-bearing row types.
4. **Layout plan (15): no read-only editor.** Without `instance.capabilities.write`, the view renders the existing not-editable fallback with "You don't have write access to this connector." Building a read-only RegionEditor is out of proportion to the value, and the entry is already hidden. The fallback link is fixed to `/connectors`. Commit also takes `blocked: lockedReason` (the view adds the running-jobs query).
5. **Workflows (26–27) need nothing beyond the gated entry** (row 16). Their commits are already state-gated, and the commit is reachable only through Connect.
6. **Job Cancel (28) needs server data.** Job GET/list gain `capabilities` (`withCapabilities`), where `delete` = the cancel rule: creator, or class `job.delete`. Compute it from the same predicate the cancel route uses (extracted into `JobsService`, also used by the route), so the UI and the server can't drift. Cancel → `gate({allowed: job.capabilities.delete})`. This is the only `core`/`api` change, and it comes with an agreement test like the foundation's.
7. **Confirm & Save (23): no change; already conforming.** Implementation found the audit's double-submit can't happen: `handleConfirmRevalidation` submits, then hides the warning and clears the pending body in the same handler, and the warning is unreachable while a save is pending. A `disabled={isPending}` would be dead code; a test now pins "a double click submits once" instead.
8. **Stale permissions.** The update/delete mutations on these SDK domains declare `onPermissionDenied: { invalidate: () => [queryKeys.<entity>.root] }`.

## Plan — 4 slices (tests first; `npm run test:unit` in `apps/web`, plus `apps/api` for slice 4)

1. **Connector instance, layout plan, catalog (13–16).** Files: `ConnectorInstance.view.tsx`, `EditLayoutPlan.view.tsx`, `ConnectorDefinition.component.tsx`, `ConnectorInstance.component.tsx`, `Connector.view.tsx`, `connector-instances.api.ts`. Tests: the instance view (read-only caller sees no actions/checkboxes; locked → `aria-disabled` + reason), EditLayoutPlan (no write → fallback), the catalog cards (no Connect without create or when inactive).
2. **Entities, records, field mappings (17–20).** Files: `EntityDetail.view.tsx`, `Entities.view.tsx`, `EntityRecordDetail.view.tsx`, `ColumnDefinitionDetail.view.tsx` (field-mapping table), plus the entity/record/field-mapping api files. Tests: `EntityDetailView`, `EntitiesView`, `EntityRecordDetailView`, `ColumnDefinitionDetailView` — each with a read-only fixture and a write-enabled fixture.
3. **Column definitions, tags, groups (21–25) + Confirm & Save (23).** Files: `ColumnDefinitionList/Detail.view.tsx`, `ColumnDefinition.component.tsx`, `Tags.view.tsx`, `TagCard.component.tsx`, `EntityGroups.view.tsx`, `EntityGroupDetail.view.tsx`, both edit dialogs. Tests: existing view/card/dialog tests, a new `TagsView.test.tsx`, and a double-click on Confirm & Save submits once.
4. **Job cancel (28).** Files: `packages/core/src/contracts/job.contract.ts`, `apps/api/src/routes/jobs.router.ts`, `apps/api/src/services/jobs.service.ts`, `JobDetail.view.tsx`. Tests: an api integration test (capabilities.delete equals cancel allow/deny for creator / other member / admin) and `JobDetail` (no Cancel without `delete`).

Each slice ends with `npm run lint` (the action-gate guard) and `type-check`. `KNOWN_VIOLATIONS` stays `{}`.

## Smoke (against your dev stack; walk in the browser)

**Preflight:** `npm run dev`; `e2e:auth:all`. As **owner**: create a file-upload connector "smoke689" with one entity, one record, a custom column definition with a field mapping, a tag, and an entity group. Give the **member** read-only access to it (a policy `allow read` on that connector instance / entity, attached via a group). **Reset:** delete all of the above.

1. **Member** on smoke689's instance page: no Edit/Sync/Delete/Modify Layout Plan/Create Entity; flags render as text. **Owner**: all present.
2. As owner, start a sync. While it runs: Edit/Delete/Create Entity are `aria-disabled` and focusable, with the tooltip naming "Sync is running on this connector…"; the flags are disabled with the same reason.
3. Member opens `/connectors/<id>/layout-plan/edit` directly → fallback "You don't have write access…"; its link lands on `/connectors`.
4. Catalog: member (no class create) sees no Connect; an inactive definition shows no Connect for anyone.
5. Member on the entity page: no tag ✕ / assign, no Edit/Delete/Create record/Delete records/Re-validate. Owner: present; turn the connector's Write flag off → Delete records shows "Writes are disabled on this connector".
6. Member on Entities, Column definitions, Tags, Groups: Create shows `aria-disabled` with the grant hint (plausible primary); no row Edit/Delete; no member add/remove on a group.
7. Owner on a system column definition: Edit shows a hover tooltip "System column definitions are read-only".
8. Owner: Edit a column definition so revalidation is required; double-click "Confirm & Save" → one PATCH (network tab).
9. Owner starts a sync; member opens that job → no Cancel. Owner → Cancel works.
10. Revoke the member's group mid-session; the member clicks a stale action → "no longer have access" toast, and the action disappears after the refetch.

## Out of scope

- Server rejecting creates against inactive definitions (`connector-instance.router.ts:776-796` checks only existence). File a bug from this walk.
- REST workflow's non-atomic commit (no rollback if an endpoint POST fails). A pre-existing reliability issue; file a bug.
- A read-only RegionEditor (Decision 4).
- Per-row `capabilities` on the tag-assignment list (not needed: entity write governs).
