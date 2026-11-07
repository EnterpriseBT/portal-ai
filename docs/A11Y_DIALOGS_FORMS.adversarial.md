# A11Y_DIALOGS_FORMS — Adversarial Review

These are adversarial probes for [#793](https://github.com/EnterpriseBT/portal-ai/issues/793), which ships accessible dialogs and forms. The surfaces most likely to break:
- **`aria-disabled` instead of `disabled`:** gated and pending buttons stay focusable and clickable as elements, so only their handlers stop them.
- **`Modal`'s inner form:** Enter, pending and Escape.
- **Hidden reason and description text:** text taken from user-authored names now reaches assistive tech as descriptions.
- **The async select's chip:** removal by keyboard.

**Branch under test:** `feat/793-a11y-dialogs-forms` (PR [#981](https://github.com/EnterpriseBT/portal-ai/pull/981)).

**Why these categories.** This PR touches no API, no authorization and no data path. The risk is that an affordance which used to be *natively* disabled is now only *ARIA*-disabled, and that some input path (a key, a stripped attribute, a portal, a fast double action) could reach the action anyway. §3, §4, §6 and §7 engage that. §2 engages the user-authored text now read as descriptions. §1 engages long text inside the new description and helper-text layouts. §5 is N/A.

## Preflight

### Environment
- [ ] `git checkout feat/793-a11y-dialogs-forms && npm install && npm run build --workspace=@portalai/core && npm run dev` (web on :3000, API on :3001).
- [ ] Playwright MCP available. `e2e:auth:all` fixtures present (owner and member).

### Fixtures
- [ ] The `e2e-fixture` org with demo data: a station with a portal, and entities.
- [ ] To hold requests in flight, either use DevTools "Slow 3G", or in the walk patch `window.fetch` to delay non-GET requests by about 4s.

### Reset between runs
- [ ] Delete any tags, groups or views whose names start with "Adv 793". Nothing else is written.

## §1 — Boundary & limit inputs
- [ ] Create a tag whose name is 120 characters (the `nameField` max) and whose description is 2000 characters, then open its **Delete** confirm (which uses `describeContent`). — expected SAFE: the dialog renders, its description is the full message without truncation errors, the action row stays visible, and nothing overflows the viewport horizontally.
- [ ] In **Create Tag**, give the color picker an error with a long message (force `errors.color` in React DevTools, or store a tag whose color is invalid). — expected SAFE: the helper text wraps under the whole picker row, the hex field still describes it, and the picker toggle keeps its place.
- [ ] Add 10 conditions in Advanced Filters on an entity's records page. — expected SAFE: they're named "Condition 1" to "Condition 10" in order. Remove "Condition 3" and the rest renumber ("Condition 3" is the old 4th), with no duplicate names.

## §2 — Malformed & injection input
- [ ] Create a tag named `<img src=x onerror=alert(1)> "quoted" &amp;`, then open its Delete confirm. — expected SAFE: the name appears literally in the dialog and in its accessible description, with no script run and no markup injected (the description is React text through `aria-describedby`). Console shows no errors.
- [ ] Create a station or tag whose name contains a newline and RTL text (`Adv 793 ‮evil‮`). — expected SAFE: the gated reason and description text render as plain text, and the dialog name (from its title) matches what's displayed.

## §3 — Concurrency & races
- [ ] In **Create Tag**, with requests delayed, press Enter on **Create**, then press Enter four more times on the now-"Saving..." button. — expected SAFE: exactly one tag is created (`aria-disabled` click swallow, `FormDefaultButton` gating and #751's dedupe), and the button never becomes natively disabled.
- [ ] Same dialog, delayed: press **Create** with the mouse, then immediately press Enter in the Name field. — expected SAFE: one tag is created, and Enter during pending does nothing (`submitDisabled || pending` gate).
- [ ] Delete Tag, delayed: double-click **Delete**. — expected SAFE: one DELETE request (check the Network tab) and no error toast for a second, missing tag.
- [ ] REST API wizard on its last step, delayed: press **Commit**, then press Enter, then **Back**. — expected SAFE: one commit request. Back and Cancel are `aria-disabled` with "Wait for this to finish" and do nothing, and the wizard doesn't change step mid-commit. — manual if no REST endpoint is available locally

## §4 — Auth & permission boundaries
- [ ] As **member** on `/views`, in DevTools remove `aria-disabled` from **Create View** and click it. — expected SAFE: no dialog opens. The gate's handler ignores the click whatever the attribute says, because `GatedButton` branches on the gate, not the DOM.
- [ ] As **member**, focus **Create View** with Tab and press Enter, then Space. — expected SAFE: nothing opens; focus stays and the reason is still the description.
- [ ] As **member**, in a `More actions` menu with a disabled item (a station you can read but not edit, if any), press Enter on the item. — expected SAFE: the item does nothing, the menu stays open, and the item's description is its reason.
- [ ] As **member**, try the forbidden write directly, bypassing the UI: `POST /api/curated-views` with the member's token. — expected SAFE: `403 PERMISSION_DENIED` (the server enforces it; this PR only changed rendering). — backend

## §5 — Multi-tenant isolation
- N/A — this PR changes no request, loader or data path. Nothing it renders comes from another org.

## §6 — State & lifecycle abuse
- [ ] Open **Rename** on a portal with requests delayed, press Save, then press the browser's Back button while it's pending. — expected SAFE: the route changes and the save completes in the background (the new name shows after a reload). No console error from a gated button unmounting mid-request. Rename Portal raises no toast.
- [ ] Open Add Member on a group, select an entity, then delete that group in another tab and press Submit. — expected SAFE: the request answers 404, nothing is written, and nothing crashes. The 404 refetches the group (#688's `onPermissionDenied`), so the page shows "Entity group not found" and the dialog closes with it; focus falls to `body` because the trigger is gone.
- [ ] Open a dialog from **More actions** on a station page, then have the station deleted in another tab and close the dialog. — expected SAFE: focus goes to a sensible element, never an exception. If the trigger itself is gone, `body` is acceptable but the page doesn't crash.

## §7 — Misuse sequences
- [ ] In Add Member's entity select, with the chip focused, press **Backspace** repeatedly. — expected SAFE: the first press removes the selection and later presses do nothing (no error, and focus doesn't jump into the page).
- [ ] With the combobox input focused and empty, press Delete or Backspace. — expected SAFE: the selection chip is **not** removed (only the chip's own key handler removes it).
- [ ] Press Escape repeatedly during a pending save in any form dialog. — expected SAFE: the dialog stays open throughout, and once the save settles a single Escape closes it.
- [ ] Open the version caption dialog ("© <year> (app version)") and press Tab repeatedly. — expected SAFE: focus stays trapped in the dialog, and the dialog keeps its name "App version".
- [ ] Open the Edit Toolpack dialog, press **Refresh schema** with requests delayed, then press **Rotate signing secret** and **Save**. — expected SAFE: while the refresh runs, Rotate is `aria-disabled` with "Refreshing…" and does nothing, and one refresh request is sent. Save keeps its pre-#793 behavior: it isn't blocked by a refresh, only by its own save. — manual if no custom toolpack exists locally

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/tag/group/portal ids):
