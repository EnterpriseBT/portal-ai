# toast-provider — Smoke Suite

Manual smoke test for [#293](https://github.com/EnterpriseBT/portal-ai/issues/293) — a shared toast provider (`useToast()`) replacing five ad-hoc `Snackbar`s, with a bounded stack, per-severity timing, and a "+N more" row carrying **Dismiss all**. **Branch under test:** `feat/toast-provider` (PR [#294](https://github.com/EnterpriseBT/portal-ai/pull/294)).

**Read this first — two things cannot be walked in a default dev dataset**, and pretending otherwise would produce a false pass:

- **The Retry action has no production consumer yet.** #286 is the first, and it lands on its own branch. The affordance is covered by unit cases (host 16, provider "passes an action through"), and will be walked with #286. §6 says how to eyeball it anyway.
- **The overflow row needs four *distinct* persistent errors.** Dedupe collapses identical `(message, severity)` pairs, so four clicks on the same failing button give one toast. §4 gives the only recipes that produce four different messages, and both need setup. If neither is available, say so on the ticket rather than checking the box.

## Preflight

### Environment

- [x] `git checkout feat/toast-provider && git pull --ff-only`
- [x] `npm install` — **no migration** on this branch (client-side UI only; nothing DB-touching)
- [x] `npm run dev` boots cleanly — web http://localhost:3000, API http://localhost:3001
- [x] **Hard-reload the browser** (⇧⌘R / Ctrl-Shift-R) — the provider is new and sits above the router

### Fixtures

- [x] Signed in to your local dev org
- [ ] **§3 needs ≥1 registered custom toolpack.** `organization_toolpacks` is empty in a fresh dev DB — check with `select count(*) from organization_toolpacks where deleted is null;`. If it is 0, register one (Toolpacks → Register) or skip §3 and note it
- [ ] **§5 needs the connector instance that has a layout plan** (1 exists in this dev DB): `select connector_instance_id from connector_instance_layout_plans where deleted is null;`

### Reset between runs

- [x] No reset needed — nothing here writes app data. Toasts clear on page reload by design

### What to watch in EVERY section

- [x] **Toasts appear bottom-RIGHT.** `UpdateBanner` deliberately stays bottom-center; the two must never occupy the same space
- [x] **An error toast never disappears on its own** — not after 4s, not after a minute, not on a stray click elsewhere. Only its close button or Dismiss all
- [x] **At most 3 toasts are visible** at once
- [ ] No `Snackbar` appears in the old positions (Toolpacks/EditLayoutPlan bottom-right *were* local; they should now be the shared host — same corner, but one host)

---

## §1 — Settings billing toasts (the one migration with visible changes)

The easiest trigger in the app: the message is derived from a URL param, so no Stripe round-trip is needed.

- [x] Navigate to **http://localhost:3000/settings?billing=success** → a **success** toast reads "Subscription confirmed — your plan updates within a few seconds"
- [x] It appears **bottom-right** (it was bottom-center before this branch)
- [x] It **auto-hides after ~4 seconds** (it was 8s before)
- [x] The `?billing=success` param is stripped from the URL, and reloading does **not** re-toast
- [x] Navigate to **http://localhost:3000/settings?billing=cancelled** → an **info** toast reads "Checkout cancelled — your plan is unchanged", auto-hiding after ~6 seconds
- [x] No duplicate toast appears — React StrictMode double-invokes the effect that raises it, and the provider's dedupe is what collapses the second raise

## §2 — Toasts survive navigation

- [x] Navigate to `/settings?billing=success`, then **immediately** click through to another route (Portals, Connectors) before the toast fades
- [x] The toast **stays on screen** across the route change and finishes its own countdown there

## §3 — Toolpacks refresh (requires ≥1 registered toolpack)

- [x] With the API running, click **refresh** on a registered toolpack → a **success** toast naming it (`Refreshed "<name>".`), auto-hiding after ~4s
- [x] Stop the API (`Ctrl-C` the dev server's API, or go offline in devtools), click refresh again → an **error** toast reading `Failed to refresh "<name>": …`
- [ ] That error toast **persists** — leave it for a minute, click elsewhere on the page; it stays until you close it
- [ ] Click its close button → it disappears and nothing else changes

## §4 — The bounded stack and Dismiss all

Needs **four distinct** persistent errors. Two recipes; use whichever your data supports.

**Recipe A — four toolpacks (needs ≥4 registered).** With the API stopped, click refresh on four *different* toolpacks. Each message names a different toolpack, so dedupe does not collapse them.

**Recipe B — mixed error sources.** With the API stopped: in the layout-plan editor click **Interpret** (error 1), then **Commit** (error 2), then navigate to Toolpacks and refresh two different toolpacks (errors 3 and 4).

- [ ] Exactly **3** toasts are visible
- [ ] A row beneath them reads **"+1 more"** (or +N for however many extra)
- [ ] A **Dismiss all** button sits beside that count
- [ ] Click **Dismiss all** → **every** toast disappears, visible and queued, and the count row goes with them
- [ ] Repeat, but this time close the three visible toasts one at a time → each dismissal **promotes** a queued toast into view, and the count decreases; the last one leaves no count row
- [ ] With three or fewer toasts on screen there is **no** count row and **no** Dismiss all

## §5 — Layout-plan editor errors

Navigate to the connector instance that has a layout plan → **Edit layout plan**.

- [ ] With the API stopped, click **Interpret** → an **error** toast appears (`Interpret failed.` or the API's message) and persists
- [ ] Click **Commit** → a second, differently-worded error toast (`Couldn't save plan before commit: …`) appears alongside the first
- [ ] Both persist together — this is the case that killed the original one-at-a-time design
- [ ] Restart the API and retry the action → it succeeds, and no stale error toast reappears
- [ ] The editor no longer renders its own Snackbar in any of its states (loading, load-error, not-editable, editable) — feedback always comes from the one shared host

## §6 — Regression: the two holdouts and the Retry affordance

- [ ] **Connector sync feedback still works:** trigger a sync on a connector instance → its three-phase Snackbar behaves exactly as before (it is a recorded exception, not migrated)
- [ ] **`UpdateBanner` still renders bottom-center.** A real trigger needs a new bundle, so if you cannot produce one, confirm instead that nothing about it changed in the diff and that it is not competing for the toast corner
- [ ] **Retry affordance (cannot be triggered in-app yet — no production consumer until #286).** If you want to eyeball it, run `npm run storybook` in `apps/web` — otherwise record this box as "deferred to #286" rather than checked

## §7 — Error & edge cases

- [ ] **Clicking the page background does not dismiss an error** (no clickaway handler by design)
- [ ] **Rapid identical failures collapse:** click the same failing refresh button four times fast → **one** toast, not four
- [ ] **Distinct failures do not collapse:** two different failing actions → two toasts
- [ ] **Reload clears everything** — toasts are ephemeral and nothing is persisted
- [ ] Resize the window narrow (≈400px) → the toast host stays on screen, readable, and does not overflow horizontally
- [ ] Switch light ↔ dark theme with a toast on screen → it re-renders themed correctly

## Sign-off

- [ ] Every section above verified against my own running stack
- [ ] Any section that could not be walked (see the two caveats at the top) is recorded on the ticket rather than checked
- [ ] ______________________ (date + name) — confirmed

## Bug-filing template

```
Section:            (e.g. §4, Dismiss all)
Action:             (exact clicks / URL / API state)
Expected:
Got:                (wrong corner? auto-dismissed an error? stacked >3? lost a toast?)
Repro:              (reliable or intermittent; browser width; theme)
Identifiers:        (toolpack / connector instance id)
Screenshot:
```

A toast that **auto-dismisses an error**, **exceeds 3 visible**, **loses a queued toast**, or **appears bottom-center** breaks an acceptance criterion and blocks merge. Wording and spacing nits are follow-up notes on the ticket.

---

## Sign-off — 2026-07-28, Ben Turner

**Walked and confirmed:** preflight, the standing watches, §1 (Settings billing — bottom-right, ~4s success / ~6s info, param stripped, no StrictMode duplicate), §2 (survives navigation), and §3's success and error toasts. The author judged that sufficient to confirm the feature and elected to stop there.

**Deliberately not walked, and NOT checked above:**

| Section | Why | What stands in |
|---|---|---|
| §4 — bounded stack, `+N more`, **Dismiss all** | Needs four *distinct* persistent errors. A default dev DB has zero toolpacks, so this required registering four against a throwaway local webhook; one registered, and the author judged the confirmed error path sufficient | Provider cases 3–4, 9–10, 12; host cases 18–19 (overflow row, Dismiss all, promotion, eviction) |
| §5 — layout-plan editor errors | Not reachable in this dataset: the only layout plan belongs to a **file-upload** connector, and plan editing is limited to `google-sheets` / `microsoft-excel` (`EDITABLE_SLUGS`) | Provider case "error and success together"; the same behavior was observed via §3 |
| §6 — Retry action | No production consumer until #286 | Host case 16; provider "passes an action through" |

**Residual risk, stated plainly:** the multi-toast behaviors — stacking at 3, the overflow count, and Dismiss all — have never been seen by a human. They carry 5 unit cases, two of which were mutation-tested, but the first real-world confirmation will come from #286, whose unpin-failure path raises an error toast with a Retry action and needs no fixtures at all.

Boxes transcribed by the assistant from the author's confirmation; the walk and the judgement were the author's.
