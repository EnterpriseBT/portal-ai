# verify-login credential capture — Condensed design (#963)

**Issue:** [EnterpriseBT/portal-ai#963](https://github.com/EnterpriseBT/portal-ai/issues/963) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** v1.2.1's `verify-login` typed the prod QA owner's password into Auth0's **email** field. It submitted, failed with "Password is required", and the failure screenshot and video went to a **public** workflow artifact showing a 14-character prefix of the password. The password is rotated and the artifact deleted (see #963). Two faults:
- the sign-in helper submits a form it never checked;
- the upload rule assumes "a password field renders masked", which doesn't hold once a password lands in a field that isn't a password field.

`packages/e2e` and two workflow upload steps only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Sign-in | `packages/e2e/src/lib/sign-in.ts` `signIn` | `fill(username)` → `fill(password)` → click Continue; it never reads either field back |
| Failure redaction | `sign-in.ts` `catch` | redacts the password from the error *message* only; the page is left as it was for the failure screenshot |
| Capture policy | `packages/e2e/src/lib/playwright-config.ts` `buildConfig` | publishable runs (CI or deployed): no trace, HTML report or `error-context.md`; `screenshot: only-on-failure` and `video: retain-on-failure` always |
| Uploads | `.github/actions/verify-login/action.yml:59-70`, `.github/workflows/e2e-test.yml:105-118` | `**/*.png` + `**/*.webm`, commented "a password field renders masked" |
| Docs | `docs/E2E_DEPLOYED_QA.runbook.md:5,118`, `CLAUDE.md` → "Artifacts are public" | say uploads are screenshots and video, and that this is safe |
| Tests | `packages/e2e/src/__tests__/sign-in.test.ts`, `playwright-config.test.ts` | fake `Page` objects; no form-content cases |

**Root cause, from the failure video (kept off the repo).**
- At t≈1.0s the Auth0 form is on screen, but its logo hasn't loaded, so the page is still loading.
- By t≈1.5s the email field holds `username + password`, the password field is empty, and the form has been submitted.
- Playwright's `fill` focuses the target, then inserts the text into whatever element has focus. Auth0's autofocus on the username field, firing as its page finished loading, took focus back between those two steps.
- v1.2.0's run with the same secrets passed, so this is a timing race, not bad data.

## Decision — check before submitting, and leave nothing typed on the page or in video

- **Options for the race:**
  - wait longer (`load`/`networkidle`), which narrows the window but doesn't close it;
  - type key by key (`pressSequentially`), which has the same focus race, only slower;
  - **verify what landed.**
- **Chosen:**
  - fill a field, then read it back with `inputValue()`. `waitForURL` already waits for Auth0's `load`; code review dropped a separate wait as redundant.
  - on a combined form, each attempt fills both fields and reads both back. Before clicking submit, the username field must equal the username **and** the password field the password.
  - on a mismatch, re-fill, up to 3 attempts, then fail.

  The submit never fires on an unchecked form, whatever the cause, so a mistyped secret is never sent to Auth0 either. The error names the field that mismatched, never its value.
- **Captures, options:**
  - mask locators in screenshots (Playwright's config-level failure screenshot takes no `mask`, and video can't be masked);
  - stop uploading on deployed runs (loses the evidence that found #963's cause);
  - **clean the page and drop video.**
- **Chosen:**
  - the whole sign-in runs under its own deadline (`SIGN_IN_DEADLINE_MS`, 150s), under the 180s test timeout. Even a hung action then reaches this cleanup, rather than the test timeout screenshotting the live form (from code review).
  - the failure message redacts the password both as given and as Playwright escapes it, and drops every URL's query, in Playwright's own error text too.
  - on any sign-in failure, `signIn` puts the Auth0 page's host, path and visible error text ("Wrong email or password") into its error, and then navigates to `about:blank` before the failure screenshot. It doesn't empty the inputs in place, because a page script could restore their values. The query is dropped, because Auth0's carries the login transaction's state.
  - publishable runs record **no video** (`video: "off"`), since a video holds every frame of the typing.
  - local runs keep video.
  - the upload steps drop `*.webm`, and their comments, `buildConfig`'s header, the runbook and CLAUDE.md say why.

## Plan — 1 slice

**Files:**
- `packages/e2e/src/lib/sign-in.ts`: fill with read-back and retry, the pre-submit check, the sign-in deadline, and on failure a scrubbed message plus `about:blank`.
- `packages/e2e/src/lib/playwright-config.ts`: `video: publishable ? "off" : "retain-on-failure"`, and the header comment.
- `.github/actions/verify-login/action.yml`, `.github/workflows/e2e-test.yml`: screenshots only; comments updated.
- `docs/E2E_DEPLOYED_QA.runbook.md`, `CLAUDE.md`, `packages/e2e/README.md`: the artifact contents and the reason.

**Tests (first):**
- `src/__tests__/sign-in.test.ts`, with a fake page whose password `fill` appends to the username field:
  - the form is never submitted, and the failure names the field without the value;
  - a failure leaves the page on `about:blank`, and the error keeps Auth0's message and path without the query;
  - a race that clears on the 2nd attempt submits once;
  - a clean form submits once;
  - a hung fill hits the deadline and still blanks the page;
  - a combined form's password mismatch names the password field;
  - Playwright's URL queries and an escaped password are scrubbed.
- `src/__tests__/playwright-config.test.ts`: video is off for CI and deployed runs, and kept locally.

Run `npm run test:unit` in `packages/e2e`, then `npm run lint` / `type-check` there.

## Smoke (manual, against your dev stack)

1. `npm run --workspace @portalai/e2e e2e:auth:app-dev` signs in and writes `.auth/app-dev/owner.storageState.json`, so the checked path still signs in.
2. `E2E_TARGET=app-dev npm run --workspace @portalai/e2e test:e2e -- --project=login` passes.
3. A forced failure: `E2E_QA_AUTH0_USERNAME=qa+app-dev@portalsai.io E2E_QA_AUTH0_PASSWORD=wrong-on-purpose E2E_TARGET=app-dev npm run --workspace @portalai/e2e test:e2e -- --project=login` fails with "Wrong email or password".
   - the error names the Auth0 page and its message;
   - `test-results/app-dev/**/test-failed-1.png` is blank;
   - there's no `*.webm`, because a deployed target is publishable;
   - the log doesn't contain the value.
   One wrong attempt, which is well inside Auth0's brute-force threshold.
4. **After merge:** Deploy Dev's `verify-login` is green. The PR's `E2E Tests` run is green.

## Out of scope

- Changing the QA identities or Auth0 configuration.
- Scanning artifacts for secrets after upload: with nothing typed left on the page and no video, there's nothing to scan for.
