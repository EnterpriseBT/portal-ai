# microsoft-excel-no-onedrive — Smoke Suite

Manual smoke test for [#416](https://github.com/EnterpriseBT/portal-ai/issues/416) — a Microsoft account whose Entra tenant has no OneDrive now fails with an actionable `409 MICROSOFT_EXCEL_NO_ONEDRIVE` that the user actually sees, instead of a `502` carrying raw Graph JSON that the UI swallowed entirely.

**Branch under test:** `fix/microsoft-excel-no-onedrive` (PR not yet opened).

Run **§Preflight** once before any section. §1–§3 need the no-OneDrive account; §4–§6 need a working one; §7 is browser-only. Each section is independent after preflight.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section in the issue body (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout fix/microsoft-excel-no-onedrive && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core` — `AsyncSearchableSelect` gained the `onSearchError` prop, and `apps/web` type-checks against core's git-ignored `dist/`. Without the rebuild the web build sees the old surface.
- [ ] **No migration.** This branch changes no schema — if `npm run db:migrate` wants to apply something, it came from elsewhere.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`).
- [ ] Auth0 dev tenant works — login lands on `/dashboard`.
- [ ] Keep the **API log** visible in a terminal for the whole walk. §2 reads it directly, and it's where the Graph `request-id` now lives.
- [ ] Keep the browser **DevTools Network tab** open on the app. §1, §3, and §6 read status codes and response bodies from it.

### Fixtures — two Microsoft accounts

This ticket is about telling two *account* conditions apart, so the walk needs both.

| Alias | What it is | Used by |
|---|---|---|
| **no-drive** | A Microsoft work/school identity whose tenant has no SharePoint Online license. The original report reproduced with `bbgrabbag_gmail.com#EXT#@bbgrabbaggmail.onmicrosoft.com` — a guest (`#EXT#`) in a bare `*.onmicrosoft.com` directory. At the account picker choose the **Work or school** entry. | §1, §2, §3 |
| **has-drive** | A Microsoft account with real OneDrive and at least one `.xlsx` in it — a personal MSA, or a work account on an M365-licensed tenant. At the picker choose **Personal account** for the MSA. | §4, §5, §6 |

- [ ] Both accounts are available and you know which picker entry selects which.
- [ ] `has-drive` has at least one `.xlsx` at the drive root (the search walks from root, depth 3).

### Reset between runs

- [ ] Each connector attempt creates a `connector_instances` row. Between runs, delete the instances you created for this walk (Connectors → the instance → delete) so a stale `pending` instance doesn't confuse a later section.
- [ ] `cd apps/api && npm run db:studio` — for inspecting `connector_instances` (`name`, `status`, `config`) when a section asks.

---

## §1 — The no-OneDrive account gets an actionable 409

The core of the ticket. Acceptance: *409 not 502*, and *no Graph internals in the response*.

- [ ] Connectors → add a **Microsoft 365 Excel** connector. At the Microsoft account picker, choose the **no-drive** account.
- [ ] Authorization completes and the workflow advances to the **Choose workbook** step. (It should — OAuth and Graph `/me` don't touch SharePoint. If authorization itself fails, that's a different bug.)
- [ ] Click into the **Workbook** field to trigger the search.
- [ ] **In DevTools Network:** the `GET /api/connectors/microsoft-excel/workbooks?connectorInstanceId=…` request returns **`409`**, not `502`.
- [ ] Its response `code` is exactly **`MICROSOFT_EXCEL_NO_ONEDRIVE`**.
- [ ] Its response `message` names both the cause and the remedy — mentions **no OneDrive**, and says to **reconnect** with a personal account or a work account whose tenant has OneDrive/SharePoint enabled.
- [ ] The response body contains **no** `request-id`, **no** `client-request-id`, **no** `innerError`, and no raw `{"error":{…}}` Graph JSON. (Search the response text for `request-id` — expect zero hits.)

## §2 — The Graph detail is in the logs instead

Acceptance: *the Graph status, `error.code`, and `request-id` appear in the API logs for every failed `/me/drive` call*. The ids moved out of the user's browser and into the operator's log — confirm they actually arrived.

- [ ] In the API log, find the line emitted by the §1 search — module `microsoft-graph`, level `warn`, message `Microsoft Graph request failed`.
- [ ] That line carries `status: 400`, `endpoint: "children"`, `graphCode: "BadRequest"`, `kind: "no_drive"`, and a non-null `requestId`.
- [ ] The same line carries the raw Graph `body` — the full upstream text is preserved for support, just not shown to the user.

## §3 — The user can see it, and the empty state stops lying

Acceptance: *the user sees an alert naming cause and remedy*, and *the empty-state text doesn't claim "No workbooks found" when the search failed*. This is the half that was completely invisible before.

- [ ] On the **Choose workbook** step, an error **alert** is visible above the Workbook field, carrying the same remedy copy from §1 plus the `MICROSOFT_EXCEL_NO_ONEDRIVE` code.
- [ ] Open the Workbook dropdown. Its empty message reads **"Workbook search failed — see the message above."**
- [ ] It does **not** read "No workbooks found — make sure the right Microsoft account is connected."
- [ ] **In DevTools Console:** no unhandled promise rejection appears for the failed search. (Before this fix, the rejection escaped the select entirely.)
- [ ] Type a few characters into the field. The alert stays, and the dropdown keeps the "search failed" message — a retry that fails again must not silently revert to the "no workbooks" copy.

## §4 — A working account is unaffected

The regression guard. None of the above may cost the happy path.

- [ ] Delete the no-drive instance, then add a fresh Microsoft 365 Excel connector using the **has-drive** account.
- [ ] Click into the **Workbook** field: the dropdown populates with your `.xlsx` files. The `GET …/workbooks` request is **`200`**.
- [ ] No error alert appears on the step.
- [ ] Type part of a workbook's name — the list filters to it (substring match on filename, case-insensitive).
- [ ] Pick a workbook. `POST …/select-workbook` returns **`200`** and the workflow advances to **Draw regions** with the sheet grid rendered.
- [ ] Complete the workflow through to commit. Records land — confirm in `db:studio` (`entity_records` for the new entity) or via the entity's detail view.

## §5 — An empty drive still says "no workbooks found"

The distinction the old copy destroyed: *no results* and *search failed* are different, and both messages must still be reachable.

- [ ] With the **has-drive** account connected, type a query that matches nothing — e.g. `zzzznotarealworkbook`.
- [ ] The dropdown reads **"No workbooks found — make sure the right Microsoft account is connected."**
- [ ] No error alert appears on the step, and the request was a **`200`** with an empty `items` array — an empty result is not an error.

## §6 — Error & edge cases

The failure modes the spec's Risks section names. Each of these is a case where the fix must *not* fire.

- [ ] **A deleted workbook is not "no OneDrive."** With the **has-drive** account, select a workbook, then delete that file from OneDrive in another tab, then reload the connector-instance view / re-enter the workflow so it re-fetches. The failure surfaces as `MICROSOFT_EXCEL_FETCH_FAILED` (502) — **not** `MICROSOFT_EXCEL_NO_ONEDRIVE`, and not a "reconnect your account" message. Acceptance: *a 404 for a deleted workbook still surfaces as `MICROSOFT_EXCEL_FETCH_FAILED`*.
- [ ] **A failed search is issued once, not four times.** Repeat §1's search with the **no-drive** account and count the `GET …/workbooks` entries in the Network tab for that single keystroke-debounce: exactly **one**, not four. (Before slice 5, react-query retried it three more times.) Acceptance: *a failed search is issued once*.
- [ ] **5xx still retries.** Confirm the retry change didn't kill legitimate retries: stop the API (`Ctrl-C` on the dev server) and load any authenticated view. In the Network tab the failed request is attempted **more than once** before the UI settles on an error. Restart the API afterwards.
- [ ] **An unrecognized Graph failure still 502s.** Not reproducible without forcing an upstream error, so this is covered by automated tests (`apps/api` integration case 17) rather than a manual step. Check the box only if you exercise it some other way; otherwise note it as covered by CI.

## §7 — The other searchable selects are unchanged

Slice 3 changed `AsyncSearchableSelect` for **all nine** consumers — options are now cleared whenever a search rejects. Spot-check the busiest ones.

- [ ] **Entities view** — the entity search/filter select still loads options on open and filters as you type.
- [ ] **Field-mapping dialog** (create or edit) — the searchable selects populate and a selection sticks.
- [ ] **Pagination toolbar** — its select still behaves normally.
- [ ] **REST API connector → inferred columns table** — its selects still populate.
- [ ] Nothing in DevTools Console logs an unhandled rejection during any of the above.

---

## Sign-off

- [ ] §1 — 409 with actionable code and message, no Graph internals in the body
- [ ] §2 — Graph status / code / request-id present in the API log
- [ ] §3 — alert visible on the step, empty state no longer claims "no workbooks found", no unhandled rejection
- [ ] §4 — a working account completes the workflow end to end
- [ ] §5 — a genuinely empty result still reads as empty, not as an error
- [ ] §6 — deleted workbook ≠ no-OneDrive; failed search issued once; 5xx still retries
- [ ] §7 — the other `AsyncSearchableSelect` consumers unaffected
- [ ] `<date>` — `<name>` — confirmed against my own running stack

**Any box left unchecked carries a recorded reason** on the line below it.

## Bug-filing template

```
Section:            (e.g. §3)
Expected:
Got:
Repro:
Identifiers:        connector instance id / org id / Graph request-id from the API log
Account used:       no-drive | has-drive  (and which picker entry you chose)
```
