# google_sheets_picker — Smoke Suite

Manual smoke test for [#408](https://github.com/EnterpriseBT/portal-ai/issues/408) — the Google Sheets connector narrowed to `openid` + `email` + `drive.file`, with Google's own file picker replacing the Drive `files.list` search box, an account-match guard before the picker opens, and the proxy deleted end to end.

**Branch under test:** `feat/google-sheets-picker` (PR [#415](https://github.com/EnterpriseBT/portal-ai/pull/415)).

Run **§Preflight** once before any section. The rest can be walked top-to-bottom; each section is independent after preflight.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section in the issue body (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/google-sheets-picker && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core` — `google-sheets.contract.ts` lost three schemas; `apps/api` and `apps/web` type-check against core's `dist/`.
- [ ] **No migration.** This ticket changes no schema and needs no backfill; if `db:migrate` wants to run something, it is not from this branch.
- [ ] `apps/web/.env` carries the three new build values (they are baked in at build time — Vite reads them at dev-server start, so restart after editing):
  ```
  VITE_GOOGLE_OAUTH_CLIENT_ID=872674925548-vp7rj816sudv8iokcv9kfsln11mb6u6p.apps.googleusercontent.com
  VITE_GOOGLE_PICKER_API_KEY=<the browser API key>
  VITE_GOOGLE_CLOUD_PROJECT_NUMBER=872674925548
  ```
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`).

### Google Cloud console state (gate G2)

The code change is inert without this, and §1 cannot pass until it is done.

- [ ] Consent screen → **Data access**: only `openid`, `.../auth/userinfo.email`, `.../auth/drive.file`. No `drive.readonly`, no `spreadsheets.readonly`.
- [ ] Credentials → the OAuth client → **Authorized JavaScript origins** includes `http://localhost:3000`.
- [ ] APIs & Services → **Google Picker API is enabled** on the project (separate from the Sheets and Drive APIs; with it off the picker never opens and it looks like a bad key).
- [ ] The browser API key's referrer restrictions include `http://localhost:3000/*`.

### Fixtures

| Alias | What | Used by |
|---|---|---|
| **fresh-google** | A Google account that has **never** granted this app the old scopes. A previously-consented account re-unions its old grant through `include_granted_scopes`, so it cannot test §1. | §1 |
| **primary-google** | The account you normally connect with (e.g. `admin@portalsai.io`), holding at least one spreadsheet with a header row and a few data rows. | §2, §3, §5, §6 |
| **second-google** | Any second Google account you can sign into in the same browser. | §3 |
| **legacy-instance** | A Google Sheets connector instance connected **before** this branch, whose stored token still holds `drive.readonly`, with a spreadsheet already selected. Check with `npm run db:studio` → `connector_instances` → `credentials` (decrypted `scopes`), or note one you had connected already. | §5 |

### Reset between runs

- [ ] To re-test a first-time consent, revoke the app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) for the account in question, then reconnect.
- [ ] Deleting a connector instance in the app does **not** revoke the Google grant — the picker will still show previously granted files. Revoke separately when that matters.

---

## §1 — Consent and scopes (acceptance criteria 1, 2)

Use **fresh-google**. This is the section G2 gates.

- [ ] Connectors → add a **Google Sheets** connector → the authorize step. Before clicking, read the description text: it says the app sees your name and email and **only the spreadsheets you choose**, and does not claim "read your Google Drive and Sheets".
- [ ] Click connect. On Google's consent screen, the listed permission is **"See, edit, create and delete only the specific Google Drive files you use with this app"** plus name/email.
- [ ] **"See all of your Google Drive files" is absent.**
- [ ] **No unverified-app interstitial** ("Google hasn't verified this app") appears at any point in the popup.
- [ ] Approve. The workflow advances to the select-sheet step and the connected account address is shown.
- [ ] `npm run db:studio` → `connector_instances` → the new row's `credentials`: the decrypted `scopes` are `drive.file`, `userinfo.email`, `openid` and nothing else. (Google expands the requested `email` to `userinfo.email` — expected, not drift.)

## §2 — Pick a spreadsheet and sync end to end (acceptance criterion 3)

Use **primary-google**.

- [ ] The select-sheet step shows a **"Choose a spreadsheet"** button and **no search box** — there is nothing to type into.
- [ ] Click it. A Google authorization popup appears first (this is the browser token), pre-selecting the connected account.
- [ ] Approve, then Google's file picker opens **over** the workflow stepper. Confirm it is usable: it takes focus, its own search works, and closing it returns focus to the workflow rather than leaving the page unresponsive.
- [ ] Pick a spreadsheet. The picker closes, the step shows **"Selected: &lt;spreadsheet name&gt;"**, and the "Fetching spreadsheet contents…" panel appears while the workbook loads.
- [ ] The workflow advances to the region-drawing step with the sheet's real rows visible.
- [ ] Complete the flow through interpret → commit. The connector instance is created and its card names the spreadsheet.
- [ ] Trigger a **sync** on that instance. It completes and rows land — this is the whole point of the ticket: a file granted in the browser is readable by the server.
- [ ] Re-open the workflow and click **"Choose a different spreadsheet"** — the button's label changes once a selection exists, and picking a second sheet replaces the first.

## §3 — The account-match guard (acceptance criterion 4)

Use **primary-google** for the connector and **second-google** in the popup. This is the failure that used to surface as an unexplained 404 at sync time.

- [ ] On a connector connected as **primary-google**, open the select-sheet step and click "Choose a spreadsheet".
- [ ] In the Google popup, switch to **second-google** and authorize.
- [ ] **The file picker never opens.**
- [ ] A warning names **both** addresses: "This connector is linked to &lt;primary&gt;, but you authorized &lt;second&gt;. Choose the linked account to pick a spreadsheet."
- [ ] The "Choose a spreadsheet" button is still enabled — retrying is possible without reloading.
- [ ] Click it again and authorize as **primary-google**: the warning clears and the picker opens normally.
- [ ] No sync was attempted and no 404 appeared anywhere in the API log.

## §4 — The proxy is gone (acceptance criteria 5, 6)

- [ ] With the API running:
  ```bash
  curl -i -H "Authorization: Bearer <your app JWT>" \
    "http://localhost:3001/api/connectors/google-sheets/sheets?connectorInstanceId=x"
  ```
  → **404** (no handler mounted), not 400/403/502.
- [ ] `http://localhost:3001/api/docs` — the Google Sheets tag lists `authorize`, `callback`, `select-sheet`, `sheet-slice` and **no** `GET /sheets`.
- [ ] ```bash
  grep -rn --exclude-dir=dist --exclude-dir=node_modules "drive.readonly\|spreadsheets.readonly" apps packages
  ```
  → only the two deliberate assertions in `google-auth.service.test.ts` and the explanatory comment in `google-auth.service.ts`. No `.ts`/`.tsx` fixture, no contract, no route.

## §5 — An existing instance keeps working (acceptance criterion 7)

Use **legacy-instance** — connected before this branch, holding the old broad grant.

- [ ] Its card still shows `active`, not `error`.
- [ ] Trigger a **sync**. It completes and rows land, with no reconnect and no user action.
- [ ] `npm run db:studio` → that row's `credentials`: the stored `scopes` still contain `drive.readonly`. Narrowing the consent screen did not revoke an existing grant — that is the expected behavior, and the reason no migration was needed.

## §6 — Error and edge cases

Each maps to a row in the spec's Risks table.

### §6a — Picker cannot load (acceptance criterion 8)

- [ ] Stop the dev server, blank `VITE_GOOGLE_PICKER_API_KEY` in `apps/web/.env`, restart, and open the select-sheet step.
- [ ] The step shows an alert saying the picker **could not load** and names it as a **configuration problem on our side** — it does **not** say "No spreadsheets found — make sure the right Google account is connected", and it does not present an empty selector.
- [ ] The "Choose a spreadsheet" button is disabled rather than opening a broken popup.
- [ ] Restore the key, restart, confirm the step recovers.

### §6b — The user changes their mind

- [ ] Click "Choose a spreadsheet", then close the Google authorization popup without approving. No error alert appears — a cancelled authorization is a choice, not a fault — and the button returns to enabled.
- [ ] Click again, approve, then close the **picker** without choosing a file. Nothing is selected, no request is sent, the step stays usable.

### §6c — A genuinely missing spreadsheet still fails promptly

- [ ] Pick a spreadsheet, complete the workflow, then **delete that spreadsheet in Google Drive** (or revoke the app's access to it).
- [ ] Trigger a sync. It fails with a Sheets fetch error rather than hanging — the bounded retry adds about one second, not an open-ended wait.
- [ ] In the API log the read is attempted **twice** at most.

> **Note on the retry.** G1 read a freshly picked spreadsheet on the first attempt, so the propagation delay this retry covers has never actually been observed. If you never see a first-read 404 in §2, that is the expected outcome, not a gap in coverage.

### §6d — Deployed build (optional, after this merges to dev)

- [ ] On the deployed dev app, the picker opens — confirming the three `DEV_VITE_GOOGLE_*` GitHub Actions secrets reached the build. Nothing in CI can catch their absence: tests pass and the deploy succeeds while the picker reports itself unavailable.

---

## Sign-off

- [ ] Every section above verified
- [ ] Any unchecked box carries a recorded reason
- [ ] ______________ (date + name) — confirmed against my own running stack

## Bug-filing template

```
Section:            (e.g. §3 — account-match guard)
Expected:
Got:
Repro:
Identifiers:        (org id / connector instance id / spreadsheet id / job id)
Console + API log:
```
