# Google Sheets scope narrowing — Discovery

**Issue:** [EnterpriseBT/portal-ai#408](https://github.com/EnterpriseBT/portal-ai/issues/408)

**Why this exists.** The Sheets connector requests `https://www.googleapis.com/auth/drive.readonly`, which Google classifies as a **restricted** scope. Restricted scopes require OAuth verification *plus* an annual third-party **CASA security assessment** — real money every year, and weeks-to-months of calendar time. Until it completes, production carries the *"Google hasn't verified this app"* interstitial and a hard **100-user cap** on the OAuth client. That cap is a ceiling on signups, not a cosmetic wart, and it is live today on `app.portalsai.io`.

The PRD answers on the ticket settled the direction: **migrate to `drive.file` + the Google Picker**, accept a one-time reconnect for existing instances, and leave BYO-credentials out. So this is not a discovery about *whether*. It is about **how small the scope set can get, and what breaks on the way** — and the survey found the answer is much better than the ticket assumed.

## The current shape

### Where the restricted scope is actually used

| Google API | Call sites | Purpose |
|---|---|---|
| `drive/v3/files` (files.list) | **exactly one** — `google-sheets-connector.service.ts:233` | Populates the spreadsheet search box |
| `sheets.googleapis.com/v4/spreadsheets` | `google-sheets-connector.service.ts:47` | Reads tabs + cell values — the whole sync path |
| `oauth2/v3/userinfo` | `google-auth.service.ts` | Resolves the connected account's email |

**`drive.readonly` has a single consumer.** Every byte of actual spreadsheet data comes from the Sheets API. That is the finding that shrinks this ticket: the restricted scope is not woven through the connector, it powers one search box.

### The surfaces involved

| Piece | Location | Note |
|---|---|---|
| Scope list | `google-auth.service.ts:23-28` | `openid`, `email`, `drive.readonly`, `spreadsheets.readonly`; `include_granted_scopes=true` is set |
| files.list proxy | `google-sheets-connector.service.ts:213-251` | Service method behind the route |
| Proxy route | `google-sheets-connector.router.ts:263` | `GET` — "List the user's spreadsheets via Drive's files.list" |
| SDK endpoint | `apps/web/src/api/google-sheets.api.ts:46` | `searchSheets` — imperative GET, one of the recorded `useAuthFetch` exceptions for a label-map cache |
| The UI | `SelectSheetStep.component.tsx` (94 lines) | Async search box; empty state reads *"No spreadsheets found — make sure the right Google account is connected."* |
| Reconnect | `google-auth.service.ts:186-191` | `invalid_grant` (revoked **or scope changed**) already marks the instance `status="error"` for the reconnect flow |

That last row matters: the one-time-reconnect answer needs no new mechanism. A scope change surfaces through a path that already exists.

## The design space

### Decision 1 — how small can the scope set be?

This is the decision the ticket did not know it had. With `files.list` gone, two scope sets are viable, and the difference is not marginal.

**A. `drive.file` + `spreadsheets.readonly`** — the obvious narrowing. `spreadsheets.readonly` is **sensitive**, so verification is still required (no CASA, no assessment fee), and the unverified interstitial and 100-user cap persist until Google approves.

**B. `drive.file` alone** — `drive.file` grants access to files the user picked, and the Sheets API honours it for exactly those files. `drive.file` is **not sensitive**, so if the Sheets read works under it, the app requests **only non-sensitive scopes**: no verification at all, no interstitial, **no user cap**, nothing to renew.

| | A: `drive.file` + `spreadsheets.readonly` | B: `drive.file` only |
|---|---|---|
| CASA assessment | no | no |
| Verification required | **yes** (sensitive) | **no** (non-sensitive) |
| 100-user cap | until approved | **never** |
| Annual renewal | verification review | none |
| Risk | none — known to work | Sheets-API-under-`drive.file` must be proven |

**Decision: B — proven, not assumed.**

Verified against the dev Google client with a purpose-built Picker harness on `localhost`:

```
Granted scope(s): https://www.googleapis.com/auth/drive.file     ← nothing else
[control] Drive files.get  -> HTTP 200  (grant attached)
          Sheets get       -> HTTP 200  "Scrabble", tabs ["Sheet1"]
```

**So the whole verification problem disappears, not just CASA.** With `openid`, `email` and `drive.file` — all non-sensitive — the app requests nothing that requires Google review: no assessment fee, no unverified interstitial, no 100-user cap, nothing to renew annually.

### Two false negatives on the way — both matter for implementation

The experiment reported **FAIL twice** before this, and neither was Google's answer:

1. **`PickerBuilder` needs `.setAppId(<cloud project number>)`.** Without it the Picker never associates the selection with the app, so no per-file grant is created. The tell was the status code: an insufficient *scope* is **403**, while an unassociated *file* is **404 "Requested entity was not found"** — Sheets returns 404 rather than 403 so it cannot be used to probe for a file's existence. **The implementation must set this**, and a test should pin it, because omitting it fails in a way that looks like the scope being rejected.
2. **A stale cached page.** The second FAIL was almost certainly the browser serving the pre-`setAppId` HTML — `python -m http.server` sends no cache headers. Recorded because it is exactly how a fixed harness re-reports a bug that is already gone.

The third run added a **Drive `files.get` control** before the Sheets call, which is what made the result trustworthy: Drive definitely accepts `drive.file`, so `Drive 200 + Sheets 404` would have meant a genuine rejection while `404 + 404` meant the grant never attached. Two identical 404s without that control are indistinguishable from a real answer — and accepting one would have bought a CASA assessment that was never needed.

**One residual uncertainty worth carrying into the spec.** The run that passed differed from the failing run in two ways, not one — it had the app id *and* an extra Drive round-trip before the Sheets call. So it is not fully excluded that per-file grant propagation is non-instant and the extra latency helped. The spec should therefore treat a 404 on the first Sheets read immediately after a pick as **retryable**, rather than assuming the grant is visible the instant the Picker closes.

### Decision 2 — where the Picker runs

**A. Client-side Picker in `SelectSheetStep`** — Google's `gapi` picker loads in the browser, the user selects, and the file id comes back to our workflow. The standard integration, and the only one that produces a `drive.file` grant for the chosen file.

**B. Keep a server-mediated flow** — not actually available: the per-file grant is a property of the user's interaction with the Picker. There is no server-side equivalent.

**Lean: A.** There is no real choice; recording it so the constraint is explicit. Note the Picker needs the OAuth **client id** and a Google **API key** in the browser — the client id already reaches the browser, the API key is new build-time config with its own referrer restriction (and, per the Mapbox lesson in #83, a referrer-restricted key is fine *here* precisely because this call is browser-side).

### Decision 3 — what happens to the files.list proxy

**A. Delete it** — the route, the service method, and the `searchSheets` SDK endpoint. Nothing else calls it.

**B. Keep it behind the old scope for existing instances** — lets a pre-migration instance still browse.

**Lean: A.** The PRD answer accepted a one-time reconnect, and (B) means maintaining two auth shapes indefinitely for a search box we are removing anyway. Deleting it is also what makes the scope reduction real: leaving the endpoint would leave the scope, which is the whole problem.

## Tradeoff comparison

| | D1: `drive.file` only | D2: client-side Picker | D3: delete the proxy |
|---|---|---|---|
| Spread to spec | Yes — scope list, and whether `spreadsheets.readonly` survives | Yes — new step UI, new build-time API key | Yes — route + service + SDK removal |
| Blocked on evidence | **Yes** — must be proven first | No | No |
| Reversible | Yes (add the scope back) | Yes | Yes (git) |

## Recommendation

1. **Done — `drive.file` alone is sufficient** (see Decision 1 for the evidence). This was a prerequisite rather than a task, because the scope list is the contract and everything downstream depended on it.
2. Request exactly `openid`, `email`, `drive.file`. **Drop both `drive.readonly` and `spreadsheets.readonly`** — every remaining scope is non-sensitive, so Google verification is not required at all.
3. Replace `SelectSheetStep`'s async search box with the Google Picker, loaded client-side with the existing client id plus a new referrer-restricted browser API key.
4. Delete the `files.list` proxy end to end: route, service method, and `searchSheets`.
5. Take the one-time reconnect: existing instances keep working on their broader grant until revoked, then flow through the `status="error"` reconnect that already exists. No dual-scope path.
6. Correct the surfaces that will be wrong afterwards — the connector's own help copy, and `PROD_PROVISIONING.runbook.md:175`, which tells the operator to enable the Drive API.

## Open questions

1. ~~**Does the Sheets API read a Picker-selected file under `drive.file` alone?**~~ **ANSWERED: yes.** Proven with a control; see Decision 1. Two false negatives preceded it — `setAppId` is required, and a cached page repeated the failure after it was fixed.
2. **Does the Picker need the Drive API enabled on the GCP project?** *Lean: yes*, and it stays enabled; the change is which *scope* we request, not which API is switched on. Worth confirming so the runbook edit is correct rather than plausible.
3. **Are there existing instances in production to migrate?** *Lean: one* — the live `google-sheets` instance created during the #83 walk. So the reconnect path will have a real subject on the first deploy, which is a gift: it gets exercised immediately rather than theoretically.
4. **Does the Picker work inside our workflow's dialog?** *Lean: yes*, but it renders its own modal, so z-index and focus-trap interaction with the workflow stepper needs a look during implementation.

## Enterprise-scale considerations

- **Concurrency & correctness** — *N/A because* this changes an authorization scope and one UI step; no shared mutable state, no check-then-act.
- **Accuracy & auditability** — *N/A because* no new records. The existing OAuth audit trail is unchanged.
- **Failure modes** — **Lean: fail closed, visibly.** If the Picker cannot load (blocked script, missing API key) the step must say so rather than presenting an empty selector — the current empty state (*"No spreadsheets found — make sure the right Google account is connected"*) would be actively misleading, blaming the user's Google account for our config error.
- **Scale & unbounded growth** — **Lean: this removes a ceiling.** The 100-user cap is the only hard scale limit in the product today; option B removes it permanently rather than deferring it to Google's review queue.
- **Multi-tenancy** — **Lean: materially improved.** `drive.file` means we hold access to only the files a user explicitly picked, rather than read access to their entire Drive — and with `spreadsheets.readonly` gone too, there is no standing grant over any spreadsheet the user did not choose. Strictly less data reachable per tenant, and a much easier answer to a security questionnaire.
- **Contract stability** — **Lean: BYO credentials stays plug-in-able.** Deliberately out of scope (PRD), but the scope list is already a single exported constant, so a future per-org client id has one place to vary.
- **Data lifecycle** — *N/A because* no retention or period semantics change.

## What this doesn't decide

- **BYO Google OAuth credentials per org** — explicitly out of scope per the PRD answer. Worth its own ticket: an org on its own client is unaffected by our verification state entirely.
- **Microsoft publisher verification** — a separate flag with a much cheaper path, tracked in the #83 walk.
- **The Auth0 Google *login* connection** — a different GCP project with login-only non-sensitive scopes; unaffected.
- **Whether to pursue verification at all under option B.** If B holds, there is nothing to verify — but the consent screen still wants a logo and the legal URLs, which is #83 housekeeping rather than this ticket.

## Next step

`docs/GOOGLE_SHEETS_PICKER.spec.md` pins the surface — the final scope list, the Picker step's props and callbacks, the removed route/service/SDK entries, and the build-time API key — **after** open question 1 is answered empirically, since the scope list is the contract and it is still one experiment away from being known. The plan then carves roughly four slices: prove the scope, add the Picker step, remove the proxy, and sweep the doc surfaces.
