# dialog_ux_audit — Smoke Suite

Manual smoke test for [#789](https://github.com/EnterpriseBT/portal-ai/issues/789): every dialog is a `Modal` with one contract. Enter submits exactly when the primary could, and Enter on a focused button, checkbox or radio never submits. Nothing dismisses a dialog mid-save, and every write is bounded (30s, or 5 min for slow endpoints). Wizards' Enter runs the step's primary. Leaving a field for Cancel doesn't flash its error, and a reopened dialog starts clean. Dialogs are also keyboard- and screen-reader-usable. **Branch under test:** `feat/789-dialog-ux-audit` (PR [#790](https://github.com/EnterpriseBT/portal-ai/pull/790)).

Run **§Preflight** once. Each section after it is independent. Steps tagged `— manual` need a human; untagged steps are `/smoke-walk`-eligible. `— backend` steps run in a terminal. App-wide accessibility is epic [#791](https://github.com/EnterpriseBT/portal-ai/issues/791) and out of scope here; §8 covers dialogs only.

**Holding a request pending.** Several steps need a save to stay in flight. In the walk, delay it with `page.route("**/api/**", r => setTimeout(() => r.continue(), 8000))` and remove the route after. By hand, use DevTools → Network → throttling "Slow 3G".

---

## Preflight

### Environment

- [ ] `git checkout feat/789-dialog-ux-audit && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`: `Modal`, `FormDefaultButton` and `preventToggleEnterSubmit` changed in core, so web needs the rebuilt dist. No migration.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`)
- [ ] Logged in to the seeded e2e org as owner (`npm run --workspace @portalai/e2e e2e:auth`, then `e2e:seed`)

### Fixtures

- [ ] At least one station, one portal with a pinned result, one connector instance with an entity, one column definition, and one toolpack-free org setting (the seeded org has all of them)
- [ ] A small CSV for the file-upload wizard (`apps/web` → Connectors → New → File upload → **Sample files** has one)

### Reset between runs

- [ ] Delete what §1/§5 created (test stations, groups, tags) from their list pages. No other reset: nothing here changes schema or jobs.

---

## §1 — Enter submits exactly when the primary could (AC1)

- [ ] `/stations` → **New Station**: type "Smoke station" in Name and press **Enter**. The station is created and the dialog closes.
- [ ] Reopen it, clear Name, press **Enter**. Nothing is sent (no POST in the network log). "Name is required" shows and Name is focused.
- [ ] `/entity-groups` → **Create Entity Group**: a dialog with two text fields. Type a name in **Description**, not Name, and press Enter. It validates (Name error, Name focused) and doesn't submit.
- [ ] `/portals/<id>` → **Rename**: change the name and press **Enter**. It renames, the case #758 broke.
- [ ] `/portal-results/<id>` → actions → **Rename**: press Enter with the name unchanged, then changed. It saves only when Save is enabled (the old raw-Dialog bug: it submitted while Save was disabled).
- [ ] Hold the request pending (see top), submit any dialog, then press **Enter** three more times. Exactly **one** request is in the network log.

## §2 — Nothing dismisses a dialog mid-save (AC2)

- [ ] Hold the request pending. In `/stations/<id>` → **Edit**, click Save, then press **Escape**, click the backdrop, click **×**, and click **Cancel**. The dialog stays open with Save showing its pending label.
- [ ] Release the request. The dialog closes on success.
- [ ] Same check in a wizard. In Connectors → New → File upload, reach Review and click **Commit plan** while held. Escape, × and the backdrop do nothing, and **Back to regions** is disabled.

## §3 — Bounded writes (AC3) — backend

- [ ] — backend — Find the API pid (`lsof -ti :3001`), open `/stations/<id>` → **Edit**, change the name, then `kill -STOP <pid>` and click Save.
- [ ] After **30s** a `FormAlert` reads "This is taking longer than expected. It may still finish, so check before trying again." The dialog becomes dismissible and the typed name is still in the field.
- [ ] `kill -CONT <pid>`. Reload. The station may or may not show the new name. Either is correct, and the copy said so.
- [ ] — manual — A slow endpoint keeps the long bound. With the API stopped, start a layout-plan **Interpret**. No timeout appears at 30s (it bounds at 5 min). `kill -CONT` before 5 min.

## §4 — Blur toward Cancel doesn't flash an error (AC4)

- [ ] `/stations` → **New Station**: focus Name (empty), then click **Cancel**. The dialog closes with no "Name is required" flash.
- [ ] Reopen it. Focus Name, then **Tab** to the next field (not a button). "Name is required" shows.
- [ ] Settings → Access → the **New policy**, **New role** and **New group** dialogs: empty Name → Cancel closes cleanly. Empty Name → Tab into another field shows the error.

## §5 — Reopened dialogs start clean (AC5, review fixes)

- [ ] Hold the request and make it fail: `page.route` that answers 500 for the station PATCH (or stop the API, as in §3). Edit a station, Save, see the `FormAlert`, then **Cancel**. Reopen **Edit**. No alert.
- [ ] `/entity-groups` → **Create Entity Group** "Smoke group A", which succeeds. Click **Create** again: the dialog is **empty** (review fix #6).
- [ ] `/portal-results/<id>`: hold the request, click **Unpin**. While it's in flight, **Unpin** and actions → **Delete** are disabled, with "Removing this pin…" on hover (review fix #8).

## §6 — Wizards and the region editor (AC1, AC6, review fixes)

- [ ] File upload wizard → draw a region. With the region selected and focus on the canvas (not a field), press **Escape**. The region is deselected and the wizard stays open.
- [ ] Select a region, open a dialog over the step (e.g. the **New Entity** dialog from the region panel), and press **Escape** with focus on its Cancel. **That dialog** closes and the region stays selected (review fix #1).
- [ ] Drawing step: focus a text field in the region panel (e.g. the entity label), press **Enter**. Interpret runs (the step's main CTA), gated like the button. With no regions, Enter does nothing.
- [ ] Bounds inputs: type a row number and press **Enter**. The field commits and Interpret does **not** run.
- [ ] Review step: open a binding chip's popover, press Enter in its field. The popover applies and the plan does **not** commit.
- [ ] REST API connector wizard: Enter in a step field runs **Next**, and on the last step **Commit**, each only when its button is enabled.

## §7 — Static guarantees (AC7, AC8) — backend

- [ ] — backend — `grep -rn "@mui/material/Dialog\"" apps/web/src` → no results
- [ ] — backend — `grep -rn "fireEvent.submit" apps/web/src --include=*.test.tsx` → only `dialog-single-flight.integration.test.tsx` and the guard's own fixtures
- [ ] — backend — `npm run test:unit --workspace=@portalai/web -- --testPathPattern dialog-contract` → green (R1–R5)
- [ ] — manual — `CLAUDE.md` → Form & Dialog Pattern and `.github/copilot-instructions.md` describe `onSubmit`/`submitDisabled`/`pending`, the timeout, R1–R5, the Component File Policy amendment, the entity-record exception, and the focused-control Enter rule

## §8 — Keyboard and screen reader (dialogs)

Keyboard steps are walkable. The screen-reader steps need VoiceOver (macOS: ⌘F5) or NVDA (Windows) and are `— manual`.

- [ ] **Focus trap:** in `/stations` → **New Station**, press **Tab** repeatedly. Focus cycles through Name, the fields, Cancel, Create and × and never reaches the page behind. **Shift+Tab** cycles backwards.
- [ ] **Focus on open:** the first field (Name) has focus when the dialog opens, without a click.
- [ ] **Focus returns to the trigger:** close with Escape, then with Cancel. Focus lands back on **New Station** each time (`document.activeElement` is that button).
- [ ] **Named by its title:** the dialog element has `role="dialog"` and `aria-labelledby` pointing at the title ("New Station"). Check with `browser_snapshot` / the accessibility tree.
- [ ] **Enter on a focused button runs only that button:** Tab to **Cancel**, press Enter. The dialog closes and nothing is created. Tab to **×**, press Enter: it closes.
- [ ] **Enter on a focused checkbox doesn't submit:** `/stations/<id>` → **Share** (a station with attached views). Tab to an "also share" view checkbox and press **Enter**. Nothing is shared and no grant appears. **Space** toggles it.
- [ ] **First invalid field focused on submit:** New Station with empty Name → click its primary. Focus moves to Name, and Name has `aria-invalid="true"` with its error linked by `aria-describedby`.
- [ ] **Errors are alerts:** force a `FormAlert` (§5's failing PATCH). It renders with `role="alert"`.
- [ ] **Disabled reasons are exposed:** with §5's Unpin in flight, the disabled Unpin has `aria-disabled="true"`, stays focusable, and its "Removing this pin…" reason is reachable (tooltip on focus, or in the accessible description).
- [ ] — manual — **VoiceOver/NVDA:** opening New Station announces "New Station, dialog" and then the focused Name field with "required". Submitting empty announces the error.
- [ ] — manual — **VoiceOver/NVDA:** a server error announces the `FormAlert` text as soon as it appears, without moving focus.
- [ ] — manual — **VoiceOver/NVDA:** the disabled Unpin is announced as dimmed/unavailable, with its reason.

## §9 — Error & edge cases

- [ ] **Double activation:** hold the request; click Create, then press Enter immediately. Exactly one request is sent.
- [ ] **Nested forms:** in the REST API wizard, submit the embedded endpoint form (Enter in its URL field). The wizard does **not** advance.
- [ ] **Escape owned by a menu:** in any dialog with a select (e.g. Share → "Share with"), open the menu and press Escape. The menu closes and the dialog stays open.
- [ ] **Entity-record exception:** `/entities/<id>` → the **New Record** dialog with a required column empty → submit. The error shows on that field, it's focused, and `aria-invalid="true"`.

---

## Sign-off

- [ ] Every section above verified
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/station/portal/entity ids):
