# a11y-dialogs-forms — Smoke Suite

This is the manual smoke test for [#793](https://github.com/EnterpriseBT/portal-ai/issues/793). The ticket makes dialogs and forms meet WCAG 2.2 AA and the APG dialog and combobox patterns:
- every `Modal` is named, and a confirm dialog is described by its message;
- a form sits inside the dialog;
- focus returns to the control that opened the dialog, and stays on a pressed button while the dialog saves;
- a gated action's reason is announced;
- form fields and selects are labelled;
- subtitles are no longer headings, and card titles are `h3`s.

**Branch under test:** `feat/793-a11y-dialogs-forms` (PR [#981](https://github.com/EnterpriseBT/portal-ai/pull/981)), which merges into `epic/a11y-conformance`.

**Step tags:**
- Untagged steps can be walked by an agent with `/smoke-walk` in a real browser, using the Playwright MCP's accessibility snapshot.
- Steps tagged `— manual` need a person with a screen reader, or visual judgment.
- Steps tagged `— backend` run in a terminal.

Run **§Preflight** once. After that the sections are independent. Per Q4 on the ticket, the screen-reader walk covers one dialog per family (create form, edit form, confirm delete, wizard, picker dialog). The axe case in every dialog's test (R6) covers the rest.

Filing bugs: open an issue against `EnterpriseBT/portal-ai` with type `Bug`, linking this file's section. The template is at the bottom.

---

## Preflight

### Environment

- [ ] `git checkout feat/793-a11y-dialogs-forms && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=@portalai/core`. Core's theme, `Modal` and gated controls changed, and web reads core's `dist`. No migration.
- [ ] `npm run dev` boots cleanly (API on :3001, web on :3000).
- [ ] Sign in as the e2e owner (`npm run --workspace @portalai/e2e e2e:auth`). The active org is `e2e-fixture`, holding demo data (`npx portalai demo seed --org <id> --rows 2000 --env local --yes`).

### Fixtures

- [ ] At least one tag, one portal (with a station), one entity group with a member, and one entity with records. The demo seed provides these.
- [ ] A member session (`e2e:use member`), for the gated-action steps in §5.
- [ ] For the manual screen-reader steps: VoiceOver (macOS, Safari or Chrome) or NVDA (Windows, Firefox or Chrome).

### Reset between runs

- [ ] Delete any tags, groups or portals the walk created whose names start with "Smoke 793". Nothing else is written.

---

## §1 — Dialog structure and naming (D1, D2)

- [ ] On `/tags`, press **Create Tag**. The dialog's accessibility node is `dialog "Create Tag"`. Its element is a `div`, not a `form`, and it contains exactly one `form`, which holds the title, the fields and the action buttons.
- [ ] Open the sidebar's version caption ("© <year> (app version)"). The dialog is named **"App version"** even though it has no visible title.
- [ ] On `/tags`, open a tag's **Delete** action. The dialog is named "Delete Tag". Its description, `aria-describedby` pointing at the dialog content, is the message "Are you sure you want to delete the tag <name>? All entity tag assignments …".
- [ ] Repeat the description check on the Delete Portal dialog (on `/portals/<id>`, More actions → Delete) and the Remove member dialog (Settings → Members → a member's Remove). Each one's description is its message.
- [ ] Look at the layout. With a long form (Create Station) the content still scrolls inside the dialog and the actions stay pinned at the bottom. The RegionEditor's maximize toggle still fills the screen (Connectors → Catalog → File Upload → upload `packages/e2e/fixtures/*.csv`). — manual (visual)

## §2 — Focus returns to the control that opened the dialog (D4)

- [ ] On `/tags`, focus **Create Tag** with Tab and press Enter. Then press Escape. Focus is back on **Create Tag**.
- [ ] On `/portals/<id>`, open **More actions** with the keyboard, choose **Delete**, then press Cancel. Focus lands on the **More actions** button, not on `body`.
- [ ] Do the same with the mouse. Focus is again on **More actions**.

## §3 — Focus stays put while a dialog saves (D4, R7)

- [ ] In DevTools → Network, set the throttle to "Slow 3G". On `/tags`, open **Create Tag**, type the name "Smoke 793 A", Tab to **Create**, and press Enter.
  - While the request is in flight, focus stays on the button, which now reads **"Saving..."**.
  - The button has `aria-disabled="true"`, not native `disabled`, and its description is **"Saving…"**.
  - Cancel and the ✕ close button are also `aria-disabled`. Clicking them does nothing, and Escape doesn't close the dialog.
  - When the request completes, the dialog closes and the tag is listed.
- [ ] With the throttle still on, open the new tag's **Delete**, Tab to **Delete**, and press Enter. Focus stays on **"Deleting..."**, whose description is **"Deleting…"**. Cancel's description is **"Wait for this to finish"**.
- [ ] Settings → Organization → **Rename**. Clear the name: Save stays natively disabled, the validation condition. Type a name and Save with the throttle on: Save becomes `aria-disabled` with the reason "Saving…", and focus stays on it.
- [ ] On an entity's detail page, open the **Delete** confirm (`DeleteConnectorEntityDialog`, whose derived flag R7 now follows). Press Delete with the throttle on. Focus stays on the button, and it reads as `aria-disabled`.
- [ ] Turn the throttle off.

## §4 — Fields, errors and selects (D5, D6, D9)

- [ ] On `/tags`, open **Create Tag** and press **Create** with the name empty.
  - The Name field gets `aria-invalid="true"`, and its error text is its description.
  - Focus moves to the Name field.
  - The field is `required`.
- [ ] Still in **Create Tag**, the color picker is a `group` named **"Color"**, holding the "Hex color value" field, the picker toggle and the samples.
- [ ] Make a request fail, for example by stopping the API, then submit a dialog. The `FormAlert` appears with `role="alert"` and the error text. Restart the API.
- [ ] On `/entity-groups/<id>`, press **Add Member**. Search for and pick an entity in the Entity select.
  - The combobox's description begins **"Selected: <entity>"**.
  - The chip is a button named after the entity, described "Press Backspace or Delete to remove".
  - Clicking the chip does **not** clear the selection. Focusing it and pressing Delete does.
  - The field keeps its required asterisk while a value is chosen.
- [ ] While the Entity list is loading (Slow 3G, then open the list), the open list shows a **"Loading…"** status.
- [ ] On an entity's records page, open the toolbar's **Advanced Filters** and add two conditions.
  - Each condition is a `group` named **"Condition 1"** or **"Condition 2"**, holding comboboxes **"Column"** and **"Operator"** and a **"Value"** field.
  - A `between` on a number column gives **"Minimum"** and **"Maximum"**.
  - The AND/OR toggle is a group named **"Match"**.
- [ ] The toolbar's page-size select is named **"Rows per page"**.

## §5 — A gated action's reason is announced (D7)

- [ ] As **member** (`e2e:use member`), go to `/views`. **Create View** is shown as `aria-disabled`, and its description, with no hover, is the grant hint ("Ask for access to create views"). Its accessible name is still "Create View".
- [ ] Hover it. The tooltip shows the same reason.
- [ ] On a connector whose sync is running, open the More actions menu. The **Sync** menu item is `aria-disabled` and described by the lock reason (`jobLockReason`). — manual if no long-running sync can be started locally
- [ ] Gated buttons look disabled through the theme only: no inline or component `sx`. Compare the Create View button on `/views` against a plain disabled button in both themes. — manual (visual)

## §6 — Headings after the subtitle change (D3)

- [ ] On `/connectors` → **Catalog**, each connector card's title (for example "File Upload") is an **`h3`**. The page heading is the only `h1`.
- [ ] On `/connectors` (your instances), each instance card title is an `h3`.
- [ ] Settings shows no `h6` among the headings (the old `heading-order` finding).
- [ ] In the Create View dialog (`/views` as owner → Create View), the "Columns"-style section labels are plain text, not `h6` headings.
- [ ] Scan the headings list of one more page: Help, Dashboard or a station. No section heading that a sighted user would call a heading disappeared. — manual (judgment)

## §7 — Focus on arrival (one-offs)

- [ ] Open a portal (`/portals/<id>`) from the portals list. Focus lands on the page heading (#797's announcer), **not** in the chat composer. One Tab reaches the composer, which is named "Message".
- [ ] Sign out. On `/login`, choose **Sign in with SSO**. Focus moves to the **Work email** field.

## §8 — Keyboard and screen-reader walk, one dialog per family — manual

For each family, use only the keyboard. Then repeat with VoiceOver or NVDA. Confirm that opening the dialog announces its name, and its message too for a confirm. Every field announces its label, required state, invalid state and error. While saving, the pressed button reads as dimmed or unavailable with "Saving…". On close, focus is back where you started.

- [ ] **Create form:** `/tags` → Create Tag. Create "Smoke 793 SR".
- [ ] **Edit form:** Settings → Organization → Rename. Rename the org, then change it back.
- [ ] **Confirm delete:** `/tags` → Delete "Smoke 793 SR".
- [ ] **Wizard:** Connectors → Catalog → REST API. Walk Next, Back, Cancel, and Commit if you have an endpoint to hand. The step forms submit on Enter and Commit stays focused while it runs.
- [ ] **Picker dialog:** `/entity-groups/<id>` → Add Member. Pick an entity and a field mapping, then add.

## §9 — Audit and guards — backend

- [ ] With the stack, the fixture org and fresh sessions (`e2e:auth:all`), run `npm run a11y:report` from the repo root. In `docs/A11Y_AUDIT.md`, **#793's section is empty**. #795 gained only the RegionEditor corner-header and `aria-prohibited-attr` rows from the FileUpload stories. No other area's count rose.
- [ ] `cd apps/web && npm run test:unit -- --testPathPattern dialog-contract.guard` passes. R6 (every dialog's test runs axe) and R7 (no button is natively disabled by its dialog's pending flag) are green with empty allowlists.
- [ ] `git diff epic/a11y-conformance...HEAD -- apps/web/src | grep -E '^\+.*sx=.*(aria-disabled|not-allowed|action\.disabled)'` prints nothing: no new accessibility `sx` in `apps/web`.

## Error & edge cases

- [ ] A form dialog with an invalid form AND a pending request (not normally reachable; force it in React DevTools by setting `isPending` on Rename Organization while the name is empty). Save is `aria-disabled` (the gate wins) and still focusable.
- [ ] Press Enter twice fast on **Create** in Create Tag. Only one tag is created (#751's dedupe, unchanged).
- [ ] Open, submit-fail and reopen a dialog. The old `FormAlert` is gone (R4, unchanged).

---

## Sign-off

- [ ] Every section above verified
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Browser + screen reader (if any): · Identifiers (org/tag/portal/entity ids):
