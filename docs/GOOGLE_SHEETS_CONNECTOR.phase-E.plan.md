# Google Sheets Connector — Phase E Implementation Plan

Companion to `GOOGLE_SHEETS_CONNECTOR.discovery.md` and `.phase-{A,B,C,D}.plan.md`. Phase E scope:

> **Phase E** — Reconnect / error recovery flow (handles `invalid_grant` from Google).

Concretely: when Google rejects our refresh token (user revoked the grant, password rotation, project-level revocation), the next sync — and any other adapter call that needs an access token — fails. Phase B already detects this and flips the connector instance to `status="error"` with `lastErrorMessage` set. Phase E surfaces a **Reconnect** affordance in the UI so the user can re-authorize without losing their committed plan / records, and tightens the surrounding details so the user doesn't end up in a half-fixed state.

## What already exists (do not rebuild)

- **`GoogleAccessTokenCacheService.getOrRefresh`** (Phase B) — already detects `GoogleAuthError("refresh_failed")`, flips the instance to `status="error"`, stores the message in `lastErrorMessage`. This is the only place we need to detect; everything else propagates.
- **`mapGoogleAuthError`** in `routes/google-sheets-connector.router.ts` — maps `refresh_failed` → `502 GOOGLE_OAUTH_REFRESH_FAILED` for synchronous routes (listSheets, etc.). The sync processor surfaces the same upstream error through the SSE stream's `failed` event.
- **`GoogleSheetsConnectorService.handleCallback`** (Phase A) — already finds an existing instance by `(organizationId, connectorDefinitionId, googleAccountEmail)` and updates its credentials in place. The reconnect flow reuses this; we just need to also reset `status` + clear `lastErrorMessage` on the update branch.
- **`POST /api/connectors/google-sheets/authorize` + `GET /callback`** (Phase A) — the authenticated authorize endpoint mints a signed-state consent URL; the public callback exchanges the code, fetches the user's email, and persists / updates the instance. **No new endpoints for reconnect.** Reconnect is just authorize against an already-existing `(org, email)` pair.
- **`useGooglePopupAuthorize` hook** (`workflows/GoogleSheetsConnector/utils/google-sheets-popup.util.ts`) — opens the consent URL in a popup, waits for the postMessage handshake, returns `{ connectorInstanceId, accountInfo }`. Phase E reuses this verbatim.
- **`ConnectorInstanceSyncFeedbackUI`** (Phase D Slice 6) — already renders failure errors from the SSE stream. Phase E adds a "Reconnect" CTA inside the error alert when the failure is auth-related.
- **`ConnectorInstance.status` field** — already part of the redacted shape served from GET-by-id. The detail view already shows it as a chip. Phase E reads it to decide whether to render the reconnect affordance.

## What's net-new for Phase E

| Piece | File | Purpose |
|---|---|---|
| Reset `status` + `lastErrorMessage` on reconnect | `services/google-sheets-connector.service.ts` (extend `handleCallback`'s update-existing branch) | When updating an existing instance with new credentials, also clear the error state. Without this, the instance stays `status="error"` after a successful re-authorization, which is confusing and breaks the "Sync now" disable affordance. |
| `useReconnectConnectorInstance` hook | `apps/web/src/utils/use-reconnect-connector-instance.util.ts` (new) | Wraps `useGooglePopupAuthorize` + the `sdk.connectorInstances.get` query invalidation on success. Returns `{ onReconnect, isReconnecting, errorMessage, onDismissError }`. State held in one place so the connector-instance detail view and the sync-feedback alert can both consume it. |
| `ConnectorInstanceReconnectButton` UI | `apps/web/src/components/ConnectorInstanceReconnectButton.component.tsx` (new) | Pure UI — accepts `{ status, isReconnecting, onReconnect }` and renders a **Reconnect** button (visible only when `status === "error"`). Mirrors the trigger-only shape of `ConnectorInstanceSyncButtonUI`. |
| Surface reconnect in the connector-instance detail view | `apps/web/src/views/ConnectorInstance.view.tsx` (extend) | When `ci.status === "error"`, render the `ConnectorInstanceReconnectButton` as a high-emphasis affordance above the metadata list (or in the page header alongside Sync). Edit / Delete remain available as secondary actions. |
| Surface reconnect in the sync failure alert | `apps/web/src/components/ConnectorInstanceSyncFeedback.component.tsx` (extend) | When the failed SSE event's error code matches a refresh-token failure (the alert already shows the message), render the **Reconnect** CTA inline so the user can recover without scrolling away from the feedback panel. |
| Optional: refresh-failure error code in the SSE error string | `apps/api/src/queues/jobs.worker.ts` (already includes `code: ...` from postgres errors) — for `GoogleAuthError` we'd want the same treatment so the frontend can pattern-match the kind reliably. | The frontend currently has only the `error` *string* on the SSE event. Phase E adds the upstream `kind` (e.g. `refresh_failed`) so we can branch the UI deterministically without parsing message text. |

## TDD discipline

Same as Phases A-D — red → green → refactor, run via `npm run test:unit` / `npm run test:integration` from `apps/api/`. Phase E touches more frontend than backend; the dialog/component coverage lives in `apps/web/src/__tests__/`.

---

## Slice 1 — `handleCallback` clears error state on reconnect

### Goal

When Google's OAuth callback succeeds and `handleCallback` finds an existing instance for the same `(org, googleAccountEmail)` pair, also reset `status` and clear `lastErrorMessage` so the instance returns to the active state. Without this, the user reconnects but the UI keeps showing the error chip + the Sync button stays disabled because `status !== "active"`.

### Red

Extend `apps/api/src/__tests__/services/google-sheets-connector.service.test.ts` (the existing service test):

1. **Reconnect resets status + clears lastErrorMessage.** Seed an instance with `status="error"`, `lastErrorMessage="invalid_grant"`. Call `handleCallback` with a code that maps to the same email. Assert the row now has `status="active"` and `lastErrorMessage=null`.
2. **First-time authorize is unchanged.** Seed no instance; call `handleCallback`. The created row has `status="pending"` (the existing first-time behavior). Assert this regression doesn't fire.
3. **Reconnect against an instance whose status is already "active" doesn't downgrade it.** Seed `status="active"`. Reconnect should leave it `active`.

### Green

In `handleCallback`'s `if (existing)` branch, add `status: "active"` + `lastErrorMessage: null` to the `update` payload:

```ts
const updated = await DbService.repository.connectorInstances.update(
  existing.id,
  {
    credentials: credentials as unknown as string,
    status: "active",
    lastErrorMessage: null,
    updatedBy: userId,
  }
);
```

### Refactor

The "active" choice is intentional — by the time the user is reconnecting, they had a working instance (otherwise they wouldn't have been able to hit `refresh_failed`). Setting `pending` on a reconnect would push the user back through the workflow; that's wrong. If we ever support reconnect *during* the workflow (instance not yet committed), the logic can branch on `await connectorInstanceLayoutPlans.findCurrentByConnectorInstanceId(existing.id)` — but that's not a v1 case.

---

## Slice 2 — Frontend reconnect hook + UI button

### Goal

A reusable hook + pure-UI component pair following the Component File Policy. The hook owns the popup orchestration, the cache invalidation, and the local error state; the UI component is a trigger-only button.

### Red

- New file `apps/web/src/__tests__/ConnectorInstanceReconnectButton.test.tsx`:
  1. Renders nothing when `status !== "error"` (the affordance is gated to error state).
  2. Renders an enabled "Reconnect" button when `status === "error"` and idle.
  3. Shows "Reconnecting…" + disables the button when `isReconnecting === true`.
  4. Click invokes `onReconnect`.
  5. Surfaces an error alert when `errorMessage` is set; click on the alert's close button calls `onDismissError`.

### Green

- `apps/web/src/utils/use-reconnect-connector-instance.util.ts`:
  - `useReconnectConnectorInstance(connectorInstanceId)` returns `{ status, isReconnecting, errorMessage, onReconnect, onDismissError }`.
  - `onReconnect` calls `useGooglePopupAuthorize.authorize()` (which opens the popup, postMessages back, returns the resulting `connectorInstanceId`).
  - On success: invalidate `queryKeys.connectorInstances.get(connectorInstanceId)` so the chip / button state refreshes from the server.
  - On `PopupClosedError`: silent (user changed their mind) — leave `errorMessage` null.
  - On any other error: store the message in `errorMessage`.

- `apps/web/src/components/ConnectorInstanceReconnectButton.component.tsx`:
  - `ConnectorInstanceReconnectButtonUI` (pure UI). Single export per file (Component File Policy "single-component file" rule — no container alongside since the view consumes the hook directly).
  - Returns `null` when `status !== "error"`.
  - Otherwise: `<Stack>` with the Reconnect button + an optional error alert (paralleling the sync-feedback shape).

### Refactor

The hook pattern mirrors `useConnectorInstanceSync`. If a third "popup-driven recovery" affordance shows up later (e.g. reconnect for a hypothetical Microsoft connector), lift the popup-orchestration boilerplate into a generic `usePopupAuthorize` that takes the SDK action.

---

## Slice 3 — Wire reconnect into the connector instance detail view

### Goal

When the user lands on a connector instance whose status is `error`, the page must lead with **Reconnect** as the obvious next action. Edit / Delete stay reachable as secondary actions; Sync stays disabled (or hidden) because the underlying credentials are broken.

### Red

Extend the connector-instance view test (or its closest existing coverage):
1. **Status = error → Reconnect button is rendered as the page primary action.** Sync button is not shown (or shown as disabled with a tooltip). Edit + Delete remain in secondaryActions.
2. **Status = error → metadata list still shows the lastErrorMessage row.** Already covered today; just confirm the new component doesn't suppress it.
3. **Status = active → Reconnect button is NOT rendered.** Sync (or Edit, depending on `enabledCapabilityFlags.sync`) takes the primary slot per Phase D Slice 6.

### Green

In `apps/web/src/views/ConnectorInstance.view.tsx`:

```ts
const reconnect = useReconnectConnectorInstance(connectorInstanceId);
const isInError = ci.status === "error";

primaryAction={
  isInError ? (
    <ConnectorInstanceReconnectButtonUI {...reconnect} variant="contained" />
  ) : isSyncConfigured ? (
    syncAction
  ) : (
    editAction
  )
}
```

Move Edit + Delete into `secondaryActions` when reconnect or sync is primary. Keep the existing `lastErrorMessage` MetadataList row as the explanation surface — the button is the "do something about it" affordance.

### Refactor

The decision tree (`error → reconnect; sync-configured → sync; else → edit`) is small enough to inline in the view. If Phase F adds another instance-level state (e.g. `paused`), extract to a `resolvePrimaryAction({ status, syncConfigured })` helper.

---

## Slice 4 — Surface reconnect inline in the sync-failure alert

### Goal

When a sync fails because the refresh token was revoked, the user sees the failure feedback right where they triggered the action — but they then need to scroll up to the page header to find Reconnect. Phase E makes the recovery one-click from the feedback alert itself.

### Red

Extend `ConnectorInstanceSyncFeedback.test.tsx`:
1. **Renders Reconnect inline on auth-related failure.** Pass `errorMessage` containing one of the well-known `GoogleAuthError` kinds (`refresh_failed`, `invalid_grant`); assert a Reconnect button appears alongside the existing alert message.
2. **Does NOT render Reconnect on non-auth failures.** A 5xx Google API response or a transient network error → only the existing alert + dismiss; no Reconnect button.
3. **Click invokes `onReconnect`.**

### Green

Extend `ConnectorInstanceSyncFeedbackUI` props: `onReconnect?: () => void`, `isReconnecting?: boolean`, `showReconnect?: boolean`. The view passes these from the same hook the page header uses, so the click goes through the same popup orchestration.

The "is this an auth error?" decision is made by the view, not the UI component — the view inspects the SSE event's error string for `refresh_failed` / `invalid_grant` and flips `showReconnect: true`. (Or, if Slice 0's tightening of the SSE error shape lands first, the view branches on a structured `code` field.)

### Refactor

Currently the SSE event's `error` field is a free-form string. If Phase E ends up wanting to branch on it more than once (here, plus a future toast on instance list views), upgrade it to `{ message, code? }` so frontend pattern-matches don't drift. Minor follow-up; not blocking.

---

## End-to-end verification gate

After Slices 1-4 land, run the full reconnect flow against a real Google account:

1. **Establish baseline.** Connect a Google Sheets instance, commit a layout plan, run a successful sync. Note `lastSyncAt`, status chip = "active", and the Sync button is enabled.
2. **Revoke the grant.** Visit https://myaccount.google.com/permissions, find the Portal.ai entry, click Remove access. (Alternatively: revoke the refresh token directly via `https://oauth2.googleapis.com/revoke?token=...` — same effect.)
3. **Trigger sync.** Click Sync now. The SSE `failed` event arrives with a `refresh_failed` / `invalid_grant` message. The instance's `status` flips to `"error"` and the failure alert shows the message + the inline **Reconnect** button.
4. **Reconnect via the alert button.** Popup opens, you re-grant, popup auto-closes. The instance row's status flips to `"active"`, `lastErrorMessage` clears, and the page header swaps Reconnect → Sync now.
5. **Re-sync immediately.** Sync now → success path. `0 added, 0 updated, N unchanged, 0 removed` (your committed records survived; same `id`s, same plan).
6. **Cancel-the-popup case.** Click Reconnect → close the popup without granting. The hook's `PopupClosedError` is silent — no toast, no error message, the page state is unchanged.
7. **Reconnect from the page-header button** (not the sync-alert one). Same end state — both entry points share the hook, so behavior is identical.

If all seven pass, Phase E is done.

---

## Out of scope for Phase E

- **Re-auth without losing the popup.** If Google's consent screen flows the user through a "select account" step and they pick a *different* Google account, the callback will create a *new* `ConnectorInstance` for that email rather than updating the one the user was reconnecting. v1 lets that happen and surfaces the new instance in the connector list; it does not auto-reconcile. A future phase could detect the mismatch in the popup return path and warn the user. For now: the existing `(org, email)` lookup is the source of truth.
- **Background reconnect prompts.** The user must visit the connector-instance detail page (or hit Sync) to discover the error. We do not push notifications or send emails. If sync cadence ever lands, that's the right moment to add a notification surface.
- **Service-account auth as a fallback.** Out of scope for the gsheets connector entirely (per discovery — we use OAuth2 web app flow only).
- **Token rotation / proactive refresh.** Google's refresh tokens don't have a hard expiry under normal use; they only get invalidated on grant removal or 6-month idle. We don't try to detect "almost-expired" tokens.

## Risks specific to Phase E

- **Popup blockers.** Opening the consent popup outside a direct user gesture (e.g. on initial page load when status is `error`) gets blocked by Safari/Chrome. The button click is the gesture; we never auto-open. Slice 2's test confirms `onReconnect` is only fired on click, not on mount.
- **Stale UI after reconnect.** If we forget to invalidate `connectorInstances.get(id)`, the page keeps showing `status="error"` even though the DB is now `"active"`. Slice 2's hook owns this invalidation; Slice 3's test verifies the chip flips post-reconnect.
- **Race between two open detail-view tabs.** Tab A reconnects, Tab B still shows `status="error"`. Tab B's user clicks Reconnect again — second authorize updates credentials again (idempotent) and B's status flips. No harm, but the UX is "I clicked, popup briefly opened, closed, status changed". Acceptable for v1; if multi-tab becomes a complaint, an SSE channel for instance-status changes would unify them.
- **SSE error-string brittleness.** Slice 4's "is this an auth error?" decision currently parses the failure message. A future change to the upstream error message would break the branch. Slice 4's refactor note flags this — we promote the SSE event to carry `{ message, code }` if it hits us a second time.
