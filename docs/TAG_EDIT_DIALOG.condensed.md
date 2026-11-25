# Edit detail-page tags through a dialog — Condensed design (#1115)

**Issue:** [EnterpriseBT/portal-ai#1115](https://github.com/EnterpriseBT/portal-ai/issues/1115) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Each taggable object's detail page gives its tags a whole page section (#1070): a heading, the chips, and an always-open dropdown for writers. The list cards already show tags as a compact "Tags" row in their metadata list. The detail pages move to the same row, with editing behind a pencil button that opens a dialog. Web only: no API, permission or contract change.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The section | `components/TagsSection.component.tsx` | `TagsSectionUI` (chips + `TagAssignSelectUI` when the gate is `allow`) and the `TagsSection` container over `useTagAssignments` |
| Its users | `StationDetail.view.tsx:321`, `PinnedResultDetail.view.tsx:415`, `CuratedViewDetail.view.tsx:350`, `ConnectorInstance.view.tsx:557` (container); `EntityDetail.view.tsx:348` (UI, wired at `:577` and `:799`) | Each page also renders a `MetadataList` (`:250`, `:210`, `:175`, `:474`, `:316`) |
| Card precedent | `StationList.component.tsx:139` (and the pin and connector cards) | `{ label: "Tags", value: <TagChipListUI/>, variant: "chip", hidden: !tags.length }` |
| Data + calls | `utils/use-tag-assignments.util.ts` | `tags`, `onAssign` / `onUnassign` (each with `invalidate` + an error `toast`), `onSearch`, `canReadTags` (#630) |
| The dropdown | `components/TagAssignSelect.component.tsx` | Keeps its own `inputRef` (refocuses after a pick); takes no ref from outside |
| Chips | `components/TagChipList.component.tsx` | Renders nothing when there are no tags |

## Decision — a metadata row plus an immediate-apply dialog

- **`TagsMetadataValueUI`** (new, pure): the row's value. It shows the chips (nothing when there are none), then an Edit pencil: a `GatedIconButton` (`IconName.Edit`, `size="small"`, default colour, like the field-mapping Edit on `ColumnDefinitionDetail`, `aria-label="Edit tags for {name}"`) that's rendered only when its gate isn't `hide`.
- **`tagsMetadataItem({ tags, canWrite, canReadTags, name, onEdit })`** (new pure util in `utils/tags-metadata.util.tsx`): builds the `MetadataItem` (`label: "Tags"`, `variant: "chip"`). The gate is `decideActionGate({ allowed: canWrite && canReadTags })`, so a writer who can't read tags gets no Edit (#630). `hidden` is true while tags load, when the caller can't read tags, and for a non-editor with no tags. Each page appends it as the **last** item of its `MetadataList`.
- **`TagsDialogUI`** (new, pure, in `TagsDialog.component.tsx`): a core `Modal` titled "Tags for {name}", holding the removable chips and the dropdown, with one `Done` button (`type="button"`). There's no `onSubmit`, `FormAlert` or `pending`: every pick and remove is saved by its own call as it happens, and that call's toast and `invalidate` run even after the dialog closes (#970). So nothing blocks Escape, close or Done, and nothing is left unsaved. Focus lands on the dropdown through `useDialogAutoFocus(open)`; `TagAssignSelectUI` gains an `inputRef` prop that it merges with its own.
- **The container is a hook.** `useObjectTags(target, { canWrite, name })` (`utils/use-object-tags.util.ts`) wraps `useTagAssignments` with the dialog's open state and returns `{ metadataItem, dialogProps }`. A view spreads the item into its `MetadataList` and renders `<TagsDialogUI {...dialogProps} />`. No container component is needed (Component File Policy: each new file holds one pure component). EntityDetail's UI takes the item and the dialog props from its container instead of today's five tag props.
- **Errors.** A failed add or remove keeps today's toast. The dialog stays open showing server state: there's no optimistic patch, and a duplicate add refetches as now.
- **`TagsSection` goes**, with its test and story. Nothing else renders it.
- **Colour dots in the pickers.** One `TagColorDotUI` draws a tag's dot on chips, cards and options (it forwards `className`, so a chip's icon margin applies). `tagSelectOption` maps a tag to an option with its dot, for the dialog's dropdown and the list pages' Tags filter. Core's `AsyncSearchableSelect` and `MultiAsyncSearchableSelect` now draw `option.icon`, as `MultiSearchableSelect` already did.

## Plan — 1 slice

**Files**
- New: `components/TagsMetadataValue.component.tsx`, `components/TagsDialog.component.tsx`, `utils/tags-metadata.util.tsx`, `utils/use-object-tags.util.ts`; stories in `stories/` for both components.
- Edit: `TagAssignSelect.component.tsx` (`inputRef` prop); the five views (drop the section, append the item, render the dialog); `EntityDetail.view.tsx`'s UI props.
- Delete: `TagsSection.component.tsx`, `__tests__/TagsSection.test.tsx`, `stories/TagsSection.component.stories.tsx`.

**Tests** (`cd apps/web && npm run test:unit -- --testPathPattern <names>`)
- `__tests__/TagsMetadataValue.test.tsx`: the chips; the pencil alone with no tags; Edit shown, hidden or disabled by gate; the name; axe.
- `__tests__/tags-metadata.util.test.tsx`: hidden while loading, without tag read, and for a reader with no tags; shown for a writer with none; gate `hide` when the caller can't read tags.
- `__tests__/TagsDialog.test.tsx` (R6): title; closed renders nothing; the dropdown is focused on open; picking calls `onAssign`; a chip's delete calls `onUnassign`; Done, Escape and close call `onClose`; axe open, with tags and with none.
- `__tests__/TagAssignSelect.test.tsx`: an outside `inputRef` receives the input.
- The five views' existing tests: the Tags section assertions move to the metadata row and the Edit dialog (StationDetail, PinnedResultDetail, CuratedViewDetail, ConnectorInstance, EntityDetail).
- The guards `dialog-contract`, `component-axe`, `action-gate`, `mutation-toast` and `mutation-invalidate` pass unchanged.

## Smoke (manual, against your dev stack)

1. As the owner, open a station's detail page. There's no "Tags" page section. The metadata list ends with a "Tags" row: its chips and a pencil button ("Edit tags for {station}"); with no tags, just the pencil.
2. Press Edit. A dialog "Tags for {station}" opens with focus in "Add tag".
3. Pick a tag. It appears as a chip in the dialog and, behind it, in the page's row, with no reload. Remove a chip: it goes from both.
4. Done, Escape and the close button each close it. Reloading shows the same tags.
5. Repeat steps 1–3 on a pinned result, a view, a connector and an entity.
6. As the member, on an object shared Read: the chips show with no remove control and no Edit. On one with no tags, there's no Tags row.
7. Stop the API, then pick a tag in the dialog: "Couldn't add the tag." toasts, and the dialog stays open showing the old tags.
8. The Stations, Pinned results, Views and Connectors list cards look as before.
9. On the Stations list, open Filter → Tags: each coloured tag leads with its dot, and picking one shows the dot on its chip with a small gap to its left.

## Out of scope

- Save/Cancel batch editing; removing tags from the row itself; tag catalog management; list cards; API or permission changes (all as listed on the issue).
