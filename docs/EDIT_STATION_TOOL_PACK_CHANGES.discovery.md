# Edit Station tool pack changes — Discovery

**Issue:** [EnterpriseBT/portal-ai#1052](https://github.com/EnterpriseBT/portal-ai/issues/1052) · Bug · `full`

**Why this exists.** The Edit Station dialog changes a station's tool packs in two ways its editor didn't ask for. It detaches custom packs its picker couldn't show (A), and it sends the whole pack list on save, so it overrides whatever another editor changed since the dialog opened (B). Both were found by code review on #1043 and neither had been reproduced.

The survey changes the size of A. The ticket describes it as a race against a slow or failed request. It is not a race for a member: `GET /api/toolpacks` refuses anyone without an unconditional read on tool packs, so a member who may edit a station never gets the custom list, and **any pack edit they save detaches every custom pack on the station**. That 403 is visible today as a console error when a member opens a portal page.

This is the change that makes a station's packs save the way its connectors and views already do (#674): by difference, and only among what the editor can see.

## The current shape

### The dialog (`apps/web/src/components/EditStationDialog.component.tsx`)

| Piece | Location | Note |
|---|---|---|
| Pack options | `:43-52`, `:59-68`, `:249-268` | Built-ins (a constant, marked disabled when the plan excludes them) plus `sdk.toolpacks.list({ kind: "custom" }, { enabled: open })` mapped to `org:<id>` |
| Loading or failed custom list | — | Not handled. No `isLoading`/`isError` read; `customOptions` is `[]` |
| The record it opened on | `:212-236` | `original.toolPacks` from `station.enabledToolpacks` (#848, #1043) |
| Save | `:292-329`, `:309-311` | `if (!sameMembers(form.toolPacks, original.toolPacks)) body.toolPacks = form.toolPacks` — the whole list |
| Connectors and views | `:164-177` | `attachmentChanges(initial, current)` → `{ add?, remove? }`, the helper packs can reuse |
| Parent | `views/StationDetail.view.tsx:91-92`, `:113-122`, `:217`, `:368-381` | Mounted only while open; Edit is gated on `station.capabilities.write`; nothing gates the custom list |

### The picker (`packages/core/src/ui/searchable-select/MultiSearchableSelect.tsx`)

`:31-33` maps each selected value to an option and drops the ones with none; `:40-42` reports only the matched ones. So a value with no option has no chip and disappears from the form on the next change. It has no way to be told a label for a value it has no option for. `MultiAsyncSearchableSelect.tsx:46-72` keeps such values with a raw-id chip (#630).

Six consumers: this dialog (`:393`), `ConnectorInstancePicker.component.tsx:28`, `PaginationToolbar.component.tsx:1035`, `modules/AccessAuthoring/GroupEditorDialog.component.tsx:113`/`:121`, `RoleEditorDialog.component.tsx:118`, and a story.

### The contract (`packages/core/src/contracts/station.contract.ts`)

| Schema | Location | Shape |
|---|---|---|
| `StationAttachmentChangesSchema` | `:154-167` | `{ add?: string[], remove?: string[] }`, strict, an id can't be in both |
| `UpdateStationBodySchema` | `:173-186` | `name?`, `description?`, `connectorInstanceChanges?`, `curatedViewChanges?`, `toolPacks?: string[] (min 1)`, strict, at least one field |
| `CreateStationBodySchema` | `:120-132` | `toolPacks?: string[] (min 1)` — whole list, which is right for a create |

### The route (`apps/api/src/routes/station.router.ts`, `PATCH /api/stations/:id`, `:665-800`)

- **Refs.** `parseToolpackRefs` (`:78-108`) splits built-in slugs from `org:` ids and checks each custom id is a live pack in the caller's org (`400 STATION_INVALID_TOOLPACK`). It checks nothing about whether the caller can read the pack.
- **Plan check (#284).** `:719-732` reads the live rows **outside the transaction** and gates only built-ins not currently attached (`403 STATION_TOOLPACK_NOT_ENTITLED`). This is the second half of B: once another editor has removed a pack the plan no longer includes, a stale whole list re-adds it and the whole save is refused.
- **Write.** One transaction (`:746-772`): the row, `stationToolpacks.replaceForStation`, then `StationAttachmentService.applyAll`.
- **Attachments, for comparison** (`services/station-attachment.service.ts:179-290`): a diff against live rows. `add` needs read on the object (`403 STATION_ATTACHMENT_NOT_READABLE`) and inserts with `ON CONFLICT DO NOTHING`; `remove` skips what the caller can't read; already-attached and not-attached ids are no-ops. Audited as `station.attachments.change`.
- **Audit.** Tool pack changes are not audited at all.

### Storage (`db/repositories/station-toolpacks.repository.ts`, `db/schema/station-toolpacks.table.ts`)

`replaceForStation` (`:76-149`) reconciles to a target list: soft-deletes live rows not in it, inserts the missing ones. There is no add or remove primitive. Two partial unique indexes (`station_id, builtin_slug` and `station_id, organization_toolpack_id`, both `WHERE deleted IS NULL`).

### Who else sets packs

| Caller | Location | Path |
|---|---|---|
| Create Station dialog | `components/CreateStationDialog.component.tsx:166` | `POST /api/stations`, whole list |
| Provisioning | `services/application.service.ts:856` | `replaceForStation` directly |
| Demo seed | `services/demo-seed.service.ts:379` | `replaceForStation` directly |
| e2e fixture seed | `db/seed-org.ts:43` | `replaceForStation` directly |

No agent tool and no CLI command writes packs, and nothing under `packages/e2e`, `packages/admin-cli` or `packages/devops-cli` sends `toolPacks`. The Edit dialog is the only sender of it on an update.

### Reading packs (`routes/toolpacks.router.ts:168-174`, `:285-288`)

Both the list and the by-id read are behind `requirePermission("resource.read", "toolpack")`, a class-level gate ("owner/admin pass via `* *`; members are denied 403"). A member therefore can't list custom packs or resolve one's name, on any page.

## The design space

### Decision 1 — how a pack edit is saved (B)

- **A. By difference: `toolPackChanges: { add?, remove? }` replaces `toolPacks` on the update body.** The dialog sends what this editor changed from the station it opened on; the server applies it to the live rows. Same schema and semantics as connectors and views.
- **B. Keep the whole list, add a precondition.** The body carries the list the dialog opened on and the server answers 409 when the live list differs. Detects the conflict but makes the editor redo their work, and it is a second concurrency model next to #674's.
- **C. Client only.** Refetch before save and merge. A check-then-act race, and it leaves the route replacing.

| | A | B | C |
|---|---|---|---|
| Another editor's change survives | Yes | Yes (save refused) | Usually |
| Atomic | Yes | Yes | No |
| Matches connectors and views | Yes | No | No |
| Contract change | One field swapped | One field added | None |

**Lean: A**, and remove `toolPacks` from the update body rather than keep both. The dialog is its only sender, the body is strict so an old client gets a 400 naming the key, and two ways to change packs on one route is the thing that makes the next bug. Create keeps `toolPacks`.

### Decision 2 — packs the dialog can't show (A)

Saving by difference does not fix A on its own: the picker still drops a value with no option from the form, and the difference then says "remove it".

- **A. Change the shared picker to keep unmatched values** (as the async one does). Fixes the trap for all six consumers, but changes what five unrelated ones render, and the chip would read `org:<uuid>` because a member can't resolve the name.
- **B. The dialog keeps them.** Values with no option are held aside: put back into the form on every change, shown as fixed entries ("1 custom tool pack you can't change here"), and left out of the difference. The editor changes only packs they can see, which is #674's rule for attachments they can't read.
- **C. Disable the picker until the custom list loads.** For a member it never loads, so they could no longer change built-in packs either.

**Lean: B.** It is the same rule the dialog already applies to connectors and views, and it holds whether the list is slow, failed or refused.

### Decision 3 — what the server does with a custom pack the caller can't read

Today station write lets a caller attach or detach any custom pack in the org by id. Attachments don't work that way (#674), and #832's rule is that an object a write references needs read.

- **A. Mirror attachments.** `add` of a custom pack needs read on it (`403`, as `STATION_ATTACHMENT_NOT_READABLE` does); `remove` of one the caller can't read is skipped. Built-ins are unaffected.
- **B. Leave it.** Station write keeps covering every pack; only the dialog protects them.

**Lean: A.** It makes A impossible from any client, not only this dialog, and it closes a reference-without-read gap. The cost: a member can no longer attach or detach a custom pack through the API unless a policy grants them read on it. See open question 1.

### Decision 4 — the rules a diff has to keep

- **At least one pack.** The whole-list field enforced `min(1)`. With differences, two editors can each remove a different pack and empty the station. The check moves to the server, on the result, inside the transaction.
- **Serialising.** Take a row lock on the station (`SELECT … FOR UPDATE`) at the start of the update transaction. The plan check's read of live rows moves inside it too.
- **Plan check.** Gate each `add` of a built-in that isn't already attached. Removing an attached pack the plan excludes keeps working, as #284 requires. The stale re-add disappears because an untouched pack is no longer sent.
- **No-ops.** Adding an attached pack or removing an unattached one does nothing, as for attachments.

**Lean: all four as stated.** A new repository primitive (`applyChanges`) does the insert with `ON CONFLICT DO NOTHING` (restating each partial index's predicate) and the soft-delete; `replaceForStation` stays for create, provisioning and seeds.

### Decision 5 — auditing a pack change

Attaching a pack changes which tools a station's sessions can call, and nothing records it. The attachment audit event already exists and is emitted from this route.

- **A. Add `toolPacks: { added, removed }` to `station.attachments.change`'s metadata.** No new audit action.
- **B. A new `station.toolpacks.change` action.**
- **C. Leave it unaudited** (as today).

**Lean: A.** One event per save, and no new action to carry through the audit vocabulary.

## Tradeoff comparison

| | 1: diff replaces list | 2: dialog keeps hidden packs | 3: server mirrors attachments | 4: lock + result check | 5: audit on existing event |
|---|---|---|---|---|---|
| Packages | core, api, web | web | api | api | api |
| Contract change | Yes | No | New 403 on add | New refusal for an empty result | Metadata only |
| Spread to spec | Yes | Yes | Yes | Yes | Yes |

## Recommendation

1. `UpdateStationBodySchema` gains `toolPackChanges: StationAttachmentChangesSchema.optional()` and loses `toolPacks`.
2. `PATCH /api/stations/:id` applies `toolPackChanges` to the live rows in its transaction, under a row lock on the station, through a new `stationToolpacks.applyChanges`.
3. Adding a built-in that isn't attached is plan-checked (`403 STATION_TOOLPACK_NOT_ENTITLED`); adding a custom pack needs it to exist in the org and be readable by the caller; removing a custom pack the caller can't read is skipped.
4. A save that would leave the station with no pack is refused with a typed 4xx.
5. The dialog sends the difference between the packs it opened on and the packs in its form, computed only over packs its picker has an option for. Packs with no option stay in the form, are shown as fixed, and are never sent.
6. A pack change is recorded on the save's `station.attachments.change` audit event.
7. `CreateStationBodySchema`, `replaceForStation` and its three direct callers are unchanged.

## Open questions

1. **Should a member be able to change a station's custom packs at all?** With decision 3 they can't unless granted read on the pack, and they can't be shown its name either way. **Lean: no, not in this ticket.** Today they detach them by accident and can't see what they are; "can't change what you can't read" is the existing rule.
2. **What does the dialog call a pack it can't name?** The page's chip (`ToolPackChipWithMetadata`) has the same problem for a member. **Lean: a count line under the picker ("2 custom tool packs on this station can't be changed here"), not chips with ids.**
3. **Which code refuses an empty result?** **Lean: `400 STATION_TOOLPACK_REQUIRED`**, a new `ApiCode`, shown in the dialog's `FormAlert`. The dialog also keeps its own check.

## Enterprise-scale considerations

- **Concurrency & correctness.** Two editors, or two saves, on one station. **Lean:** differences applied to live rows under a station row lock; inserts idempotent on the partial unique indexes; the plan check and the at-least-one check read inside the transaction.
- **Accuracy & auditability.** **Lean:** pack changes join the existing audit event (decision 5). Today there is no record of who attached a pack.
- **Failure modes.** The custom list failing or being refused must not change data. **Lean:** fail closed on what can't be seen: unseen packs are never in the difference, and the server skips removals of unreadable packs.
- **Scale & unbounded growth.** N/A because a station holds a handful of packs and the change is two short id lists.
- **Multi-tenancy.** Custom ids are already resolved within the caller's org (`findManyByIds(ids, { organizationId })`). **Lean:** keep that check on `add`, and add read.
- **Contract stability.** **Lean:** one way to change packs on update, shaped like the two attachment fields, so a later per-pack rule (a plan limit on custom packs, a pack-level grant) has one place to apply.
- **Data lifecycle.** N/A because rows are soft-deleted as today; re-adding a pack creates a new row, unchanged.

## What this doesn't decide

- **Whether members can read tool packs.** The class-level gate on `GET /api/toolpacks` is why a member can't see pack names anywhere. Row-filtering that list is its own change (the route says why it isn't filtered).
- **The shared picker dropping unmatched values.** Five other consumers have the same latent behaviour; none is known to hit it. Changing the component changes what they render.
- **Create.** A new station has no other editor and no hidden packs.
- **`seed-org --all-toolpacks` removing custom packs from fixture stations.** It calls `replaceForStation` with built-ins only. A fixture concern.
- **Telling an editor the station changed underneath them.** Same as #1043 and #1053.

## Next step

`docs/EDIT_STATION_TOOL_PACK_CHANGES.spec.md` fixes the contract (the body field, each refusal and its code, the audit metadata, the dialog's rules for packs with no option) and `…plan.md` slices it, roughly: core contract; repository `applyChanges` with its integration tests; route (lock, plan check, read check, empty-result refusal, audit) with route integration tests including two-editor cases; the dialog (difference, hidden packs, the count line) with unit tests; then the member walk that shows a custom pack surviving a built-in pack edit.
