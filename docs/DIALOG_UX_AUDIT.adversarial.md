# dialog_ux_audit — Adversarial Review

Adversarial probes for [#789](https://github.com/EnterpriseBT/portal-ai/issues/789): every dialog is a `Modal` whose Enter, Escape and dismissal are gated by `submitDisabled`/`pending`, and every write is bounded by a client timeout. **Branch under test:** `feat/789-dialog-ux-audit` (PR [#790](https://github.com/EnterpriseBT/portal-ai/pull/790)).

The change is client-only (no `apps/api` source changes), so the probes go after the gates: driving a submit around them, racing them, and leaving or reusing a dialog at the wrong moment. Holding a request uses the same `page.route` delay as the smoke doc.

## Preflight

### Environment
- [ ] `git checkout feat/789-dialog-ux-audit && git pull --ff-only && npm install && npm run build --workspace=packages/core && npm run dev` (web :3000, API :3001)
- [ ] Playwright MCP available; the e2e owner session (`e2e:auth`)

### Fixtures
- [ ] The seeded `e2e-fixture` org: a station, a pinned result, an entity with records and a required column

### Reset between runs
- [ ] Delete the stations and groups the probes create from their list pages

## §1 — Boundary & limit inputs
- [ ] `/stations` → **New Station**: type three spaces in Name and press **Enter** — expected SAFE: no POST; "Name is required" shows (the trim rule holds through Enter, not just the button).
- [ ] **New Station**: paste a 10,000-character name and press **Enter** — expected SAFE: either the field's max rule blocks it with an error and no POST, or one POST that the API answers with a clean 400 shown in `FormAlert`; the dialog stays open and usable either way.

## §2 — Malformed & injection input
- N/A — no input parsing or validation rule changed (the contract edits add a message to existing `min(1)` rules), and the server is unchanged.

## §3 — Concurrency & races
- [ ] Hold the request. `/portal-results/<id>` → actions → **Delete** → focus **Delete** in the confirm dialog (no text field) and press **Enter** five times — expected SAFE: exactly one `DELETE`; the dialog stays open while pending.
- [ ] Hold the request **past 30s** (delay 35s). **New Station** "Adv timeout", Create; wait for the `REQUEST_TIMEOUT` alert, then press **Create** again — expected SAFE: the alert says it may still finish; a second POST is sent (the documented risk). Record whether two "Adv timeout" stations exist afterwards (spec Risks: no idempotency keys).
- [ ] Hold the request. Open **Edit** on a station, Save, then in the same tick press **Escape** and click **Cancel** — expected SAFE: one PATCH, the dialog stays open, and it closes on success; no console error.

## §4 — Driving a disabled affordance
- [ ] Hold the request. **New Station** "Adv forced", Create, then from the console call `requestSubmit()` on the dialog's form twice — expected SAFE: no second POST (`onSubmit` is gated on `pending`, not only the button).
- [ ] **New Station** with empty Name: remove the hidden default button's `disabled` attribute from the console, then press **Enter** in Name — expected SAFE: no POST; validation runs (the handler re-checks `submitDisabled`).
- [ ] File upload wizard → Review with a blocked commit (a binding error), then `requestSubmit()` on the step's form — expected SAFE: no `POST /layout-plans/commit`.

## §5 — Multi-tenant isolation
- N/A — no server, route or authorization change; the dialogs call the same SDK endpoints with the same payloads.

## §6 — State & lifecycle abuse
- [ ] Hold the request. **Edit** a station, Save, then press the browser **Back** button — expected SAFE: the route changes (the pending gate is the dialog's, not the page's); the PATCH completes; no uncaught error in the console; returning shows the saved name.
- [ ] Open **Rename** on a pinned result, delete that pin from another tab (or via the API), then press **Enter** with a new name — expected SAFE: the dialog stays open with a `FormAlert` naming the failure (404); Cancel closes it; reopening shows no stale alert.
- [ ] — manual — Let the Auth0 session expire with a dialog open (or block the token endpoint), then Save — expected SAFE: within 30s the dialog shows the timeout alert or an auth error and becomes dismissible; it never stays pending forever.

## §7 — Misuse sequences
- [ ] **Share** dialog: focus the "Share with" select, press **Enter** — expected SAFE: the menu opens; nothing is shared.
- [ ] **New Station**: focus a link inside the dialog (e.g. "View plans" in the toolpack section) and press **Enter** — expected SAFE: the link acts (or nothing happens); no POST.
- [ ] **Create Entity Group**: type a name, then press **Enter** in Description — expected SAFE: a newline, no POST.
- [ ] REST API wizard: open **Add endpoint**, press **Escape** in its Path field — expected SAFE: only the endpoint dialog closes; the wizard keeps its step and typed values.
- [ ] — manual — With a Japanese/Chinese IME, compose a name in **New Station** and press **Enter** to commit the composition — expected SAFE: the composition commits; the dialog does not submit until a second Enter.

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | | |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/station/portal/entity ids):
