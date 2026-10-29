# OAuth popup callback errors — Condensed design (#924)

**Issue:** [EnterpriseBT/portal-ai#924](https://github.com/EnterpriseBT/portal-ai/issues/924) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Both OAuth connectors' `/callback` routes render the popup page only on success. A denied consent (`?error=access_denied`), a bad or expired `state`, or a failed token exchange goes to `next(err)`, so the popup shows the JSON error envelope, nothing is posted to the opener, and the dialog stays "connecting" until `useOAuthPopupAuthorize`'s 5-minute timeout. The fix: every callback outcome answers with the page, and failures post a `<slug>-failed` message that the hook rejects on. Touches `apps/api` (page + both routes) and `apps/web` (the hook).

## Current shape

| Piece | Location | Note |
|---|---|---|
| Success page + headers | `apps/api/src/utils/oauth-callback-html.util.ts` (`renderOAuthCallbackHtml`, `sendOAuthCallbackPage`) | posts `{type:"<slug>-authorized", connectorInstanceId, accountInfo}` to `WEB_APP_URL`'s origin; CSP pins the script by hash, COOP `unsafe-none`, `no-store` (#922) |
| Google callback | `apps/api/src/routes/google-sheets-connector.router.ts:169-203` | missing `code`/`state` → `400 GOOGLE_OAUTH_INVALID_STATE`; `catch` → raw `next(err)` (not even `mapGoogleAuthError`); `error` param never read |
| Microsoft callback | `apps/api/src/routes/microsoft-excel-connector.router.ts:140-174` | same shape; `catch` → `next(mapMicrosoftAuthError(err))` |
| 500 redaction | `apps/api/src/services/http.service.ts:43-78` | a 500's message never reaches the client (`INTERNAL_ERROR_MESSAGE`, #687) |
| Popup hook | `apps/web/src/utils/oauth-popup.util.ts` | origin + type-checked `message` listener; only `<slug>-authorized` settles it, else `PopupClosedError` at 5 min |
| Consumers | `GoogleSheetsConnectorWorkflow.component.tsx:259-277`, `MicrosoftExcelConnectorWorkflow` (same), `use-reconnect-connector-instance.util.ts:75-86` | all already surface `err.message` (`OAuthAuthorizeStep`'s `error`, the reconnect `errorMessage`); reconnect silences only `PopupClosedError` |

## Decision — one page, two outcomes; the server picks the words

- **Page.** `renderOAuthCallbackHtml` takes an `outcome`: `{kind:"authorized", connectorInstanceId, accountInfo}` or `{kind:"failed", code, message}`. Same script shape, same headers, same `WEB_APP_URL` target (still never `*`); the failure posts `{type:"<slug>-failed", code, message}` and shows the message as escaped text ("Authorization failed. …") so a popup that lost its opener still says something. New `sendOAuthCallbackFailurePage(res, {slug, error: ApiError})` answers with **the error's status** (400/502/500: logs and monitoring keep their meaning; browsers render HTML at any status) and the 500 rule: a 500 shows `INTERNAL_ERROR_MESSAGE`, keeping its code. The error is logged before rendering, since it no longer reaches the catch-all.
- **Provider `error` param.** Read before the `code`/`state` check. `access_denied` → `400 <P>_OAUTH_ACCESS_DENIED`, "Authorization was cancelled."; any other provider error → `400 <P>_OAUTH_PROVIDER_ERROR`, "<Google|Microsoft> couldn't complete the authorization. Please try again." Four new `ApiCode`s (`GOOGLE_`/`MICROSOFT_`). The provider's `error_description` is **never echoed**: the callback URL is unauthenticated and anyone can craft one, so the opener only ever sees server-authored text. `state` isn't verified on this path — a forged failure can at most show an error in a dialog, and it carries nothing secret.
- **Google catch** goes through `mapGoogleAuthError`, matching Microsoft, so a non-`ApiError` doesn't become an unlabelled 500.
- **Hook.** Also accepts `<slug>-failed` (same origin check; `code` and `message` must be strings) and rejects with a new exported `OAuthCallbackError` (`code`, `message`), closing the popup and cleaning up like success. The workflows and reconnect need no change: `err.message` is already what they render, and reconnect surfaces non-`PopupClosedError` errors, so a cancelled reconnect now says "Authorization was cancelled." instead of hanging.

## Plan — 2 slices

**Slice 1 — API: failure page + routes**
- Edit: `apps/api/src/utils/oauth-callback-html.util.ts` (outcome union, `sendOAuthCallbackFailurePage`), `constants/api-codes.constants.ts` (4 codes), both routers' `/callback` (error-param branch, catch → failure page; `@openapi`: `code` not required, `error` param documented, 4xx/5xx now `text/html`).
- Tests: `apps/api/src/__tests__/utils/oauth-callback-html.util.test.ts` (failed payload type/code/message, escaped message, 500 redaction, CSP hash still matches the script); `__tests__/__integration__/routes/google-sheets-connector.router.integration.test.ts` + `microsoft-excel-connector.router.integration.test.ts` (`?error=access_denied&state=x` → 400 HTML with `<slug>-failed` + `ACCESS_DENIED`; bad state → 400 HTML `INVALID_STATE`; exchange failure → 502 HTML; headers present on each). `npm run test:unit` / `test:integration` scoped to these files.

**Slice 2 — web: hook rejects on failure**
- Edit: `apps/web/src/utils/oauth-popup.util.ts` (`OAuthCallbackError`, failed-message guard, doc comment).
- Tests: `apps/web/src/utils/__tests__/oauth-popup.util.test.tsx` (rejects with code + message on `<slug>-failed`; ignores it from the wrong origin or another slug; listener removed; popup closed); `utils/__tests__/use-reconnect-connector-instance.util.test.tsx` (failed message → `errorMessage` set).

## Smoke (manual, against your dev stack)

1. Google Sheets workflow → **Connect** → on Google's consent screen click **Cancel**. The popup closes within a second; the dialog shows "Authorization was cancelled." and **Connect** is enabled again.
2. Repeat with the Microsoft Excel workflow (cancel on the Microsoft consent screen) → same.
3. Open `http://localhost:3001/api/connectors/google-sheets/callback?code=x&state=garbage` directly in a tab → an HTML page saying authorization failed (no JSON); devtools shows status 400, the CSP/COOP/`no-store` headers.
4. Retry Connect after step 1 and complete consent → succeeds as before (no stale error; the `-authorized` path is unchanged).
5. On an existing connector's page, **Reconnect** → cancel consent → the page shows "Authorization was cancelled." rather than staying in progress.

## Out of scope

- Detecting a popup the user closes by hand without a callback (the COOP-severed opener makes `popup.closed` unreliable; the 5-minute timeout stays).
- Re-checking `state` on the failure path, or retrying a failed exchange.
