# Edit dialogs that compare against the live record — Condensed design (#1053)

**Issue:** [EnterpriseBT/portal-ai#1053](https://github.com/EnterpriseBT/portal-ai/issues/1053) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** #1043 fixed the Edit Station dialog putting back another editor's change after a refetch behind the open dialog. The ticket names three more dialogs with the same shape (entity group, tag, column definition) and asks to confirm each first. Reading how each is mounted, only one behaves as filed; one is not affected; one loses the editor's own typing instead. `apps/web` only.

## Current shape

Paths are under `apps/web/src/`. Queries go stale after 60 s (`client.ts:78`), so a refetch reaches an open dialog on return to the tab.

| Dialog | What its parent passes | What a refetch does to the open dialog | Result |
|---|---|---|---|
| `components/EditColumnDefinitionDialog.component.tsx` | the live query row (`views/ColumnDefinitionDetail.view.tsx:232`, `:476`) | form keeps its seeded state (`key={columnDefinition.id}`, `:455`); `buildBody` and `validate` compare against the live `cd` (`:122`, `:164-172`) | **As filed.** An untouched label, type, description, pattern, message or format reads as an edit and is sent, putting the old value back |
| `components/EditEntityGroupDialog.component.tsx` | the live query row (`views/EntityGroupDetail.view.tsx:370`, `:570`) | the form is keyed on the values (`key={`${group.name}-${group.description}`}`, `:195`), so it **remounts** when another editor's rename arrives | **Not as filed.** No revert: the form resets to the new values. What is lost is this editor's unsaved typing, replaced mid-edit with no notice |
| `components/TagFormModal.component.tsx` | the row stored when Edit was clicked (`views/Tags.view.tsx:167`, `:184`, `:245`), not the live one | nothing: `editingTag` doesn't change on refetch | **Not affected.** It already compares against the tag it opened on |

Reference: `components/EditStationDialog.component.tsx:212` captures `const [original] = useState(...)` and reads `station` nowhere else (#1043).

Swept for the same shape (six dialogs share the `EditForm` + `key` pattern):

- `EditConnectorEntityDialog`, `EditConnectorInstanceDialog`: one field each, sent as typed. Keyed on the value, so a refetch that changes it resets the field. Nothing untouched to put back.
- `EditEntityRecordDialog`: keyed on the record's data, so it resets too; sends the whole record.
- `EditFieldMappingDialog`: keyed on `sourceField`, compares against the live mapping, and **sends every field on every save** (`:170-195`), so an open form overwrites another editor's change to any field whatever it compares against. That is the update contract, not this bug.

## Decision — which dialogs change, and how

1. **Column definition: capture the record the dialog opened on.** `const [cd] = useState(columnDefinition)` in `EditForm`, so every read in the form (seeds, `validate`, `buildBody`, the allowed type transitions, the read-only key) is of that record. Same as Edit Station.
2. **Entity group: the same, and key the form on the group's id instead of its values.** With the comparison against the opened-on group and no value key, a refetch no longer resets the form, and a save sends only what this editor changed. The id key keeps the one thing the old key did that mattered: if the page moves to another group with the dialog open (browser Back; the view stays mounted), the form starts over rather than saving one group's edits into another. The dialog's `group` prop gains `id`.
3. **Tag: no change.** Its only parent already hands it a snapshot.

No shared hook. The ticket suggested one for four dialogs; with two changing it would wrap a single `useState` line. Each dialog carries the line and its reason in a comment, as Edit Station does.

Also fixed, in the handler this touches: emptying a group's description sent `description: undefined`, which drops out of the JSON. Alone that was a body the API refuses (`400`, "At least one field must be provided"); with a rename, the rename saved and the description stayed. It is now sent as `""`.

Considered and not done:

- **Keeping the group's reset-on-change and warning the editor.** It would be the only dialog that does it, and it still throws away their typing.
- **Advancing the column definition's captured record after this editor's own save.** The page keeps the dialog open when a save returns `warnings`, but the update route never returns any (`apps/api/src/routes/column-definition.router.ts` documents the field and nothing fills it), so the dialog always closes on success. A comment in the form says what has to change if that stops being true.

## Plan — one slice

**Files**
- Edit: `components/EditColumnDefinitionDialog.component.tsx` — capture the opened-on record.
- Edit: `components/EditEntityGroupDialog.component.tsx` — capture it; compare against it; key on `group.id`; send a cleared description.

**Tests** (render the dialog, re-render with the refetched record, edit one field, save; the harness `EditStationDialog.test.tsx` uses for #1043)
- Edit: `__tests__/EditColumnDefinitionDialog.test.tsx` — a description-only save after another editor changed the label sends only the description; the same for a changed type and validation; an untouched form after a refetch closes without sending.
- Edit: `__tests__/EditEntityGroupDialog.test.tsx` — text typed before the refetch is still in the field; a save after another editor's rename or description change sends only this editor's field; a different group's id starts the form over; a cleared description is sent, alone and with a rename.
- `npm run test:unit` in `apps/web` limited to those two files plus `TagFormModal`, `EditStationDialog` and the two parent views; `npm run lint`, `npm run type-check`, `npm run format:check`.

## Smoke (manual, against your dev stack)

Two sessions on one organization: A in the browser, B through a second session or the API. "Refetch" means leave the dialog open for over a minute, then switch away from the tab and back.

1. Column definition: A opens **Edit**. B changes the label and saves. Refetch. A changes only the description and saves → the page shows B's label and A's description.
2. Same dialog: A opens **Edit**, B changes the description, refetch, A saves without touching anything → the dialog closes and B's description stands.
3. Entity group: A opens **Edit** and types a new description without saving. B renames the group. Refetch → A's typed description is still in the field. A saves → the page shows B's name and A's description.
4. Tag (regression): A opens **Edit** on a tag. B renames it. Refetch. A changes only the description and saves → B's name stands.

## Out of scope

- `EditFieldMappingDialog` sending every field on each save. Fixing it changes what the field-mapping update accepts or sends; worth its own ticket.
- The reset-on-refetch in the connector entity, connector instance and record dialogs. They lose typing, visibly, and put nothing back.
- Telling an editor that the record changed underneath them. No dialog does this today, Edit Station included. Until one does, an open form shows the values it opened on: the editor can't see another editor's change in it, and can't put a field back to the value it opened with on purpose (that reads as no change).
- Cross-field checks on the column definition update. Because a save now sends only this editor's fields, an editor working from an old type can set a canonical format the new type doesn't use; the route checks only the pattern. The server is where that belongs, and it accepts the same body from any client today.
- Tool packs in Edit Station (#1052).
