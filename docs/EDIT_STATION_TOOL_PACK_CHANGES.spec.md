# Edit Station tool pack changes — Spec

**Issue:** [EnterpriseBT/portal-ai#1052](https://github.com/EnterpriseBT/portal-ai/issues/1052) · **Discovery:** `docs/EDIT_STATION_TOOL_PACK_CHANGES.discovery.md`

A station update changes tool packs by difference (`toolPackChanges: { add, remove }`), applied to the live rows inside the update's transaction. The Edit Station dialog sends only what its editor changed, and only among packs its picker can show. This pins the body field, each refusal, the audit metadata and the dialog's rules.

## Key decisions (flag for review)

1. **`toolPackChanges` replaces `toolPacks` on update.** No alias: the body is strict, so `toolPacks` on a PATCH answers `400 STATION_INVALID_PAYLOAD` naming the key. Create is unchanged.
2. **A custom pack the caller can't read is answered like one that doesn't exist.** Adding it is `400 STATION_INVALID_TOOLPACK` ("Unknown toolpack"), the code a missing or other-organization id already gets. *This differs from the discovery, which said 403:* a distinct answer would tell a caller the pack exists. Removing one the caller can't read is skipped, not refused.
3. **The lock is the station row update.** The handler's transaction already starts by updating the station row, which holds that row until commit, so two updates of one station run one after the other. Every read of the station's packs moves after that statement. No separate `FOR UPDATE`.
4. **The plan is read before the transaction; which packs are new is decided inside it.** Reading the plan needs its own connection, and waiting for one while holding a transaction is how a small pool deadlocks (#698).
5. **An empty result is refused only when the body changes packs.** A rename of a station that somehow has no packs still saves.
6. **A member can't change a station's custom packs** (confirmed in discovery): they can't read them, so they can't add them, and their removals are skipped.
7. **Pack changes are audited on `station.attachments.change`**, as two new arrays in its metadata.

## Scope

### In scope

1. `UpdateStationBodySchema`: `toolPackChanges` in, `toolPacks` out.
2. `stationToolpacks.applyChanges` repository primitive.
3. `PATCH /api/stations/:id`: parse, read check, plan check, apply, empty-result refusal, audit, OpenAPI text.
4. `ApiCode.STATION_TOOLPACK_REQUIRED`.
5. `StationAttachmentChange` metadata gains pack arrays.
6. `EditStationDialog`: difference over shown packs, packs with no option kept and counted.

### Out of scope

- `CreateStationBodySchema`, `replaceForStation` and its direct callers (provisioning, demo seed, fixture seed).
- Making tool packs readable by members, or naming a pack a member can't read.
- `MultiSearchableSelect` dropping values it has no option for.
- Telling an editor the station changed underneath them.

## Surface

### `packages/core/src/contracts/station.contract.ts`

```ts
export const UpdateStationBodySchema = z
  .object({
    name: nameField().optional(),
    description: descriptionField().optional(),
    connectorInstanceChanges: StationAttachmentChangesSchema.optional(),
    curatedViewChanges: StationAttachmentChangesSchema.optional(),
    /** Built-in slugs and `org:<id>` refs. `add` attaches, `remove` detaches;
     *  an attached `add` or an unattached `remove` is a no-op. */
    toolPackChanges: StationAttachmentChangesSchema.optional(),
  })
  .strict()
  .refine(/* at least one field, unchanged */);
```

`StationAttachmentChangesSchema` is reused as is (strict; an id can't be in both lists). Its doc comment is widened to cover packs.

### `apps/api/src/db/repositories/station-toolpacks.repository.ts`

```ts
/** Attach and detach packs against the live rows. `client` must be the
 *  caller's transaction. Returns what actually changed, as wire refs. */
async applyChanges(
  stationId: string,
  changes: { add: ReplacePacksPayload; remove: ReplacePacksPayload },
  actor: { userId: string },
  client: DbClient
): Promise<{ added: string[]; removed: string[]; remaining: number }>
```

- Reads the station's live rows on `client`.
- Inserts each `add` ref that isn't live, with `ON CONFLICT DO NOTHING` on the matching partial unique index, restating its `WHERE deleted IS NULL`.
- Soft-deletes each live row whose ref is in `remove`.
- `added` / `removed` are refs (`slug` or `org:<id>`) that changed; `remaining` is the live count afterwards.

### `apps/api/src/routes/station.router.ts` — `PATCH /api/stations/:id`

Order, with each refusal:

| Step | Rule | Refusal |
|---|---|---|
| 1 | Body parses; caller has write on the station (unchanged) | `400 STATION_INVALID_PAYLOAD`, `404 STATION_NOT_FOUND`, `403 PERMISSION_DENIED` |
| 2 | Each `add` ref is a known built-in slug or `org:<id>` | `400 STATION_INVALID_TOOLPACK` |
| 3 | Each `add` custom id is a live pack in the caller's org **and** `set.can("resource.read", { type: "toolpack", id, createdBy })` | `400 STATION_INVALID_TOOLPACK`, same message for all three |
| 4 | Before the transaction: `EntitlementService.splitBuiltinPacks(org, add built-ins)`; and for `remove` custom ids, which are readable | — |
| 5 | In the transaction, after the row update: read live packs. A built-in that is in `add`, not live, and not in the plan | `403 STATION_TOOLPACK_NOT_ENTITLED` (unchanged code and message) |
| 6 | `applyChanges` with `add` as sent and `remove` without the custom ids the caller can't read | — |
| 7 | `remaining === 0` | `400 STATION_TOOLPACK_REQUIRED`, "A station needs at least one tool pack." |

- A `remove` ref is parsed by shape only (`org:` prefix or not), not checked against the built-in registry, so a pack whose slug has since been retired can still be detached.
- Steps 5–7 throw inside the transaction, so a refusal writes nothing, the rename included.
- The response is unchanged: the station with `enabledToolpacks` re-read after commit.
- `@openapi`: the 400 description gains `STATION_INVALID_TOOLPACK` (unknown, other-organization or unreadable pack in `add`) and `STATION_TOOLPACK_REQUIRED`; the 403 text keeps the plan refusal. The body component regenerates from the schema (`config/swagger.config.ts:602`).

### `apps/api/src/constants/api-codes.constants.ts`

`STATION_TOOLPACK_REQUIRED = "STATION_TOOLPACK_REQUIRED"`, beside `STATION_INVALID_TOOLPACK`.

### `apps/api/src/services/station-attachment.service.ts`

```ts
export interface StationAttachmentChange {
  added: { curatedViewIds: string[]; connectorInstanceIds: string[]; toolPacks: string[] };
  removed: { curatedViewIds: string[]; connectorInstanceIds: string[]; toolPacks: string[] };
}
```

`applyAll` returns empty `toolPacks` arrays; the route fills them from `applyChanges`. `hasChanges` counts them, so a pack-only save is audited. The agent's view attach and detach (#1036) record empty arrays.

### `apps/web/src/components/EditStationDialog.component.tsx`

- **Shown packs**: the values of the picker's options at that moment (every built-in; custom packs once their list has loaded).
- **On change**: the form's pack list becomes what the picker reported plus every pack already in the form that has no option. A pack with no option can't leave the form.
- **On save**: `toolPackChanges = attachmentChanges(original shown, form shown)`, where "shown" filters both lists by the options at save time. Absent when nothing changed. `toolPacks` is never sent.
- **Count line**: once the custom list has settled (loaded or failed), if `n` packs in the form have no option, the dialog shows "1 tool pack on this station can't be changed here." / "`n` tool packs on this station can't be changed here." under the picker. Nothing while the list is loading.
- **Validation** is unchanged: at least one pack in the form, counting packs with no option.
- A `STATION_TOOLPACK_REQUIRED` or `STATION_INVALID_TOOLPACK` answer shows in the dialog's `FormAlert` like any other.

## Migration

None. No schema change; the two partial unique indexes already exist.

## Seed

None.

## TDD test plan

Run from each package with `npm run test:unit` / `npm run test:integration`, limited to the named files.

### core — `packages/core/src/__tests__/contracts/station.contract.test.ts`

- `toolPackChanges` with `add`, with `remove`, with both; rejects an id in both; rejects an unknown key inside it.
- `toolPacks` on an update is rejected as an unknown key.
- A body with only `toolPackChanges` satisfies "at least one field".
- `strict-request-bodies.test.ts` still passes.

≈ 6 cases.

### api repository — `apps/api/src/__tests__/__integration__/db/repositories/station-toolpacks.repository.integration.test.ts`

- Adds a built-in and a custom pack; reports both as `added`.
- Adding an attached pack is a no-op; removing an unattached one is a no-op.
- Removes a pack by soft delete; re-adding creates a new live row.
- Add and remove in one call; `remaining` is right, including zero.
- Leaves packs it wasn't told about alone.
- Rolls back with its transaction.

≈ 7 cases.

### api route — `apps/api/src/__tests__/__integration__/routes/station.router.integration.test.ts`

- Adds and removes built-ins by difference; the other packs stay.
- **Two editors:** B removes Statistics; A, who never touched it, adds Web Search → Data Query and Web Search.
- **Plan:** adding an unentitled built-in is 403 and writes nothing; removing an attached unentitled one works; B removes an unentitled pack and A's unrelated change still saves (the #284 half of B).
- **Custom packs:** an owner adds and removes one; a member's `add` of a custom pack is `400 STATION_INVALID_TOOLPACK`; a member's `remove` of one is skipped and the pack stays; a member changing a built-in leaves the custom pack attached.
- A missing and an other-organization custom id get the same 400 as an unreadable one.
- Removing the last pack is `400 STATION_TOOLPACK_REQUIRED` and writes nothing, the rename in the same body included; two concurrent removals of different packs can't empty the station.
- A retired slug in `remove` detaches.
- `toolPacks` on PATCH is `400 STATION_INVALID_PAYLOAD` naming the key.
- Audit: a pack change records `station.attachments.change` with the pack arrays; a no-op change records nothing.
- Existing #284 and #706 cases are rewritten onto `toolPackChanges`.

≈ 18 cases.

### web — `apps/web/src/__tests__/EditStationDialog.test.tsx`

- Adding a built-in sends `{ toolPackChanges: { add: [slug] } }`; removing one sends `remove`; both in one save.
- Removing a pack and adding it back sends nothing.
- **Custom list refused (the member case):** a built-in edit sends only that change, and never the custom pack in `remove`.
- **Custom list still loading:** the same, and the custom pack's chip appears once it loads.
- **Custom list loaded:** removing the custom pack's chip sends it in `remove`.
- The count line: shown with the right number when the list was refused; absent while loading; absent when every pack has an option.
- Another editor's pack change after a refetch isn't sent (#1043 cases, now on `toolPackChanges`).
- The last shown pack can be removed while a pack with no option remains; removing every pack still shows "At least one tool pack is required".
- Axe on the dialog with the count line showing.

≈ 12 cases.

**Totals ≈ 43 cases.** No migration or seed test is needed.

## Acceptance criteria

- [ ] A member who edits a station's built-in packs leaves its custom packs attached.
- [ ] An editor who changes one pack doesn't undo a pack another editor added or removed while their dialog was open.
- [ ] An editor's save isn't refused because another editor removed a pack the plan no longer includes.
- [ ] A station can't be left with no tool pack, by one save or by two at once.
- [ ] Adding a custom pack the caller can't read answers exactly as an unknown pack does.
- [ ] Every pack change appears in the audit log with who made it and which packs.
- [ ] `PATCH /api/stations/:id` with `toolPacks` is a 400 naming the key; the OpenAPI document shows `toolPackChanges`.
- [ ] Creating a station is unchanged.

## Risks & rollback

- **A client still sending `toolPacks` on update gets a 400.** The web app is the only known sender and ships in the same PR. Detected by the dialog's tests and the route test for the key. The web and API deploy together on SaaS; on a residency install a `helm upgrade` moves both.
- **Members lose the ability to attach a custom pack by id through the API.** Intended (decision 6). An owner or admin, or anyone granted read on the pack, is unaffected.
- **Fail mode.** Everything fails closed: an unreadable pack is neither added nor removed, an unresolvable plan refuses the save (`splitBuiltinPacks` throws, as today), and a refusal inside the transaction writes nothing.
- **Rollback** is a revert of the PR. No data is migrated, and rows written by the new path are ordinary `station_toolpacks` rows.

## Files touched

- Edit: `packages/core/src/contracts/station.contract.ts`
- Edit: `packages/core/src/__tests__/contracts/station.contract.test.ts`
- Edit: `apps/api/src/db/repositories/station-toolpacks.repository.ts`
- Edit: `apps/api/src/__tests__/__integration__/db/repositories/station-toolpacks.repository.integration.test.ts`
- Edit: `apps/api/src/routes/station.router.ts`
- Edit: `apps/api/src/constants/api-codes.constants.ts`
- Edit: `apps/api/src/services/station-attachment.service.ts`
- Edit: `apps/api/src/__tests__/__integration__/routes/station.router.integration.test.ts`
- Edit: `apps/web/src/components/EditStationDialog.component.tsx`
- Edit: `apps/web/src/__tests__/EditStationDialog.test.tsx`
- Check: `apps/api/src/__tests__/config/route-authorization.map.ts` (the route's entry is unchanged; confirm), `packages/core/src/__tests__/models/audit-log.model.test.ts` (metadata shape)

No durable doc describes `toolPacks` on an update (`README`s, `docs/CUSTOM_TOOLPACK_INTEGRATION.md` and the Helm README were checked).

## Next step

`docs/EDIT_STATION_TOOL_PACK_CHANGES.plan.md` slices this into commits that each build and pass on this branch: the contract gains `toolPackChanges`; the repository primitive; the route with its refusals and audit; the dialog; and last, `toolPacks` leaves the update body once nothing sends it. Then the smoke walk, whose centre is a member editing built-in packs on a station with a custom pack.
