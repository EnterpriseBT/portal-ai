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

## Smoke (manual, against your dev stack)

Walk in the browser (`/smoke-walk` for the untagged steps). Tags: `— manual` needs a human (real vendor account); `— backend` is DB/CLI setup or proof. Acceptance criteria: **AC1** (member sees no instance actions on another's connector, sees them on their own, locked ⇒ `aria-disabled` naming the job) → §1, §2; **AC2** (every surface renders from the gates; guard passes) → §3–§7, plus `action-gate.guard.test.ts` in CI; **AC3** (no editable form without write) → §1.3, §2.

**Preflight**
- No migration. `npm run build --workspace @portalai/core` (stale dist otherwise), then `npm run dev`.
- `npm run --workspace @portalai/e2e e2e:auth:all`. Switch admin and member into e2e-fixture (`POST /api/organization/switch`). The org must be on a tier with custom RBAC (the fixture's is).
- **As owner:**
  - Upload a sample CSV as file-upload connector **smoke689**, giving one entity with records.
  - On that entity, add a custom column definition **smoke689_col** with a field mapping.
  - Create a tag **smoke689** and an entity group **smoke689**, and add the entity as a member.
- **As member:** upload a CSV as connector **smoke689-mine** (their own).
- **As owner, Settings → Access:**
  - Policy **smoke689 reader**: allow `read` on `connector_instance:<smoke689>` and `entity:<its entity>`, plus class `read` on `entity_record`, `field_mapping`, `tag`, `column_definition`, `entity_group`.
  - Group **smoke689 readers** containing the member, with that policy attached.
- **Holding a job in flight — backend:** in `psql`, run `BEGIN; LOCK TABLE entity_records IN ACCESS EXCLUSIVE MODE;`, then trigger the job. `ROLLBACK;` releases it.
- **Reset:** delete the two connectors, the tag, the group, the column definition, the policy and the access group.

**§1 Connector instance, layout plan, catalog (rows 13–16)**
1. **Member** on smoke689's page:
   - no Edit, no ⋮ menu, no Create Entity;
   - Capabilities show as chips (Read, Write) with no checkboxes.

   **Owner** on the same page: Edit, ⋮ (Delete) and Create Entity are present; the flags are checkboxes.
2. **Member** on **smoke689-mine**: Edit, Delete and Create Entity are all present (their own connector).
3. **Member** opens `/connectors/<smoke689 id>/layout-plan/edit` directly: "You don't have write access to this connector." with only **Back**, and no editor.
4. **Owner**, Connectors → Catalog: Connect shows on active definitions. Toggle the Active filter off: an inactive definition shows **no** Connect.
5. **Member**, Connected tab: no Delete on smoke689's card; Delete on smoke689-mine's.

**§2 Entity, records, field mappings (rows 17–20)**
1. **Member** on smoke689's entity:
   - tags show without ✕ and with no "Add tag";
   - no Edit, no ⋮, no Create, Delete records or Re-validate All.
2. **Member** on smoke689-mine's entity:
   - **Create** is present;
   - **Delete records** and **Re-validate All** are absent (entity-wide actions; the code-review fix).

   **Owner** on smoke689's entity: all of these are present.
3. **Owner**, turn smoke689's **Write** flag off, then on the entity page:
   - Create and Delete records are `aria-disabled`; hovering shows "Writes are disabled on this connector";
   - ⋮ → Delete is still enabled (the route doesn't check the flag).

   Turn Write back on.
4. **Member** opens a smoke689 record: no ⋮ (no Edit, Delete or Re-validate).
5. **Owner**, hold a job (preflight), then click **Re-validate All**:
   - The entity page shows the lock alert, and Delete records / Edit are `aria-disabled` naming "Revalidation is running on this connector — try again when it finishes."
   - Open a record: the **same lock alert** shows, and ⋮ → Edit / Delete are disabled with that reason.

   `ROLLBACK;`. Within seconds and **without reloading**, the alert clears and the actions re-enable on the record page (the code-review fix).
6. **Member** on smoke689_col's page: field-mapping rows have **no** edit or delete icons, and no Create in Field Mappings.

   **Owner**: the icons are present. With smoke689's Write flag off, they're `aria-disabled` with the writes-disabled tooltip.

**§3 Column definitions, tags, groups (rows 21–25)**
1. **Member** on Column Definitions, Tags and Entity Groups:
   - **Create** is `aria-disabled` with "Ask for access to create column definitions / tags / entity groups";
   - cards have no Delete; tag cards have no Edit.
2. **Owner**, open a **system** column definition: Edit is `aria-disabled`, hovering shows "System column definitions are read-only", and there's no ⋮.
3. **Member** on group smoke689: no Edit, no ⋮, no Add Member, no Remove; the primary member shows a non-clickable star.

   **Owner**: all present. Toggling the star and removing a member both work.
4. **Owner**, edit smoke689_col's validation pattern so revalidation is required. Double-click **Confirm & Save**: the network tab shows **one** PATCH.

**§4 Jobs (row 28)**
1. **Owner**, hold a job and click Re-validate All. Then open it from Jobs:
   - as **member**: no Cancel Job;
   - as **owner**: Cancel Job is present, and clicking it shows "Cancelling…" disabled, then the job ends cancelled.

   `ROLLBACK;`.
2. **Backend**: `GET /api/jobs/<id>` as member shows `capabilities: {read: true, write: false, delete: false}`, and `POST …/cancel` as member returns 403.

**§5 Stale permissions**
1. **Owner**, add `write` on `connector_instance:<smoke689>` to **smoke689 reader**. **Member** reloads smoke689: the flags are checkboxes.
2. **Owner** removes that statement. **Member**, without reloading, clicks the **Write** checkbox: the request returns 403, and after the refetch the flags render as chips.

**§6 Sync label — manual** (needs a Google Sheets connector)
1. Click **Sync now**: while the sync runs the button reads a disabled **"Syncing…"**, not "Sync now", and Edit / Delete are locked naming "Sync is running…".

**Bug template:** Section · Expected · Got · Repro · ids (org / connector / entity / job).

## Out of scope

- Server rejecting creates against inactive definitions (`connector-instance.router.ts:776-796` checks only existence). File a bug from this walk.
- REST workflow's non-atomic commit (no rollback if an endpoint POST fails). A pre-existing reliability issue; file a bug.
- A read-only RegionEditor (Decision 4).
- Per-row `capabilities` on the tag-assignment list (not needed: entity write governs).
