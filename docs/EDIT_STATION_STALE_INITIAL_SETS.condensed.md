# Edit Station dialog: stale packs and attachments — Condensed design (#1043)

**Issue:** [EnterpriseBT/portal-ai#1043](https://github.com/EnterpriseBT/portal-ai/issues/1043) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** If the station page refetches while the Edit Station dialog is open, a save that changes only the name can also send the tool packs, connectors or views the dialog opened with, undoing what another editor changed in the meantime. #848 fixed this for the name and description; the other three fields still have it. `apps/web` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The form | `apps/web/src/components/EditStationDialog.component.tsx:215-220` | Seeded once (`useState`) from the station when the dialog mounts |
| Name and description baseline | `EditStationDialog.component.tsx:210-213` | `const [original] = useState(...)`: captured once (#848) |
| Packs, connectors, views baseline | `EditStationDialog.component.tsx:189-204` | `initialInstanceIds`, `initialViewIds`, `initialToolpacks` are plain `const`s, recomputed from the live `station` prop on every render |
| What gets sent | `EditStationDialog.component.tsx:286-294` | Packs: the form's full set, when it differs from `initialToolpacks`. Connectors and views: `attachmentChanges(initial…, form…)`, the add/remove difference (#674) |
| How the dialog is mounted | `apps/web/src/views/StationDetail.view.tsx:368-381` | Rendered only while open (`{editOpen && …}`), so "when it mounts" is "when it opens" |

After a refetch the three baselines reflect the other editor's change while the form still holds what this editor opened with, so untouched fields read as edits. #674's difference-based save was meant to stop exactly this ("a stale editor can't re-attach what another just removed"); comparing against a live baseline gets around it.

## Decision — where the baseline comes from

- **A. Capture the three sets once, in the state that already holds the name and description baseline.** The comparison is then form-as-opened against baseline-as-opened, so an untouched field is never a change whatever the page does behind the dialog.
- **B. Re-seed the form when the station prop changes.** Keeps the dialog current, but discards what the editor has typed, or needs a merge of their edits with the new data.

**Decided: A.** One `useState` holds `name`, `description`, `toolPacks`, `connectorInstanceIds` and `curatedViewIds` as the dialog opened; the form is seeded from it and the submit compares against it. No behaviour changes for an editor whose page doesn't refetch.

## Plan — one slice

**Files**
- Edit: `apps/web/src/components/EditStationDialog.component.tsx` — widen the once-captured baseline to the three sets; seed the form and compute the save from it.

**Tests** (written first; `npm run test:unit -- --testPathPattern EditStationDialog` in `apps/web`)
- Edit: `apps/web/src/__tests__/EditStationDialog.test.tsx`. Each rerenders the open dialog with a changed `station`, changes only the name, saves, and expects the body to be `{ name }`:
  - another editor removed a tool pack;
  - another editor detached a connector;
  - another editor detached a view;
  - another editor attached a connector (it must not be sent as a removal).
- The existing cases for a real pack or attachment edit must still pass unchanged.
- Then `npm run lint`, `npm run type-check`, `npm run format:check` in `apps/web`.

## Smoke (manual, against your dev stack)

Steps 1–3 are agent-walkable. Step 4 needs two sessions and a page refetch under an open dialog, which a scripted browser doesn't produce; it is the case the unit tests pin.

1. Open a station you can edit, choose Edit, add a tool pack and save. The station page shows the pack.
2. Edit again, attach a connector or a view and save; then edit and detach it and save. The page shows each change.
3. Edit, change nothing, save. The dialog closes and no `PATCH /api/stations/…` is sent.
4. — manual. Person A opens the Edit dialog on a station with a connector attached. Person B detaches that connector and saves. A waits over a minute, switches away from the tab and back (the page behind the dialog now shows no connector), changes only the name and saves. The connector stays detached, and A's request carries only the name.

## Out of scope

- **Tool packs are saved as a full set.** When an editor does change the packs, the dialog sends the whole list, which replaces whatever another editor did to the packs meanwhile. Connectors and views are saved by difference; doing the same for packs is a change to the update API.
- **Telling the editor the station changed underneath them.** The dialog keeps showing what it opened with.
