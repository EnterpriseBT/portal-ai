# One request per submit intent — Spec

Pins the single-flight guard on `useAuthMutation`, the run guards on multi-request workflow functions, and the removal of the UI-event guards they replace. Builds on [the discovery](DIALOG_DOUBLE_SUBMIT.discovery.md) for [#751](https://github.com/EnterpriseBT/portal-ai/issues/751).

## Key decisions (flag for review)

1. **The guard lives in `useAuthMutation`**, not on UI events. It's per hook instance, synchronous and ref-held, with no timer and no render dependence.
2. **"Same request" is the wire request:** `method + " " + resolvedUrl + " " + JSON.stringify(body)`. Two calls built by the same code path from equal variables give an equal key; JSON key order follows construction, and both calls construct identically. Different rows give different URLs, so they run in parallel.
3. **A dropped `mutate()` is a no-op. A dropped `mutateAsync()` returns the in-flight promise.** Per-call callbacks passed to a dropped call don't run; the first call's do.
4. **`FormData` / `Blob` bodies are not deduplicated.** This refines the discovery, which keyed them by identity, which a double-click defeats anyway. No current `useAuthMutation` caller sends one. It's a documented limit.
5. **Opt-out: `dedupeInFlight: false`** on the config. No call site uses it today.
6. **Multi-request workflow functions get a run guard:** a second call while one is running returns the running promise. That covers FileUpload `startParse`, the shared spreadsheet `onInterpret` / `onCommit`, and RestApi `onCommit`.
7. **The #747 Modal submit hold, `swallowRepeatClick` and their guard rule are removed.** `submitDisabled` and `FormDefaultButton` stay, because they keep Enter consistent with an incomplete form's disabled button.
8. **Out of scope: server-side idempotency keys** (two tabs, network retries, scripts). The discovery's open questions are resolved as their leans, confirmed by "go with the request guard".

## Scope

### In scope
- Single-flight in `useAuthMutation`, plus its opt-out.
- A reusable `useSingleFlight` hook, and its use in the four workflow functions.
- Removal of the #747 hold, the #751 swallow, the raw-view opt-ins and the swallow guard rule; rewrite of the docs that describe them.

### Out of scope
- Server-side idempotency; read deduplication (react-query already dedupes queries); visual feedback for dropped calls; `FormData` deduplication.

## Surface

### `apps/web/src/utils/api.util.ts` — `AuthMutationConfig`

Adds one optional field to the existing interface (currently `url`, `body?`, `method?`, `options?`, `mutationOptions?`, `onPermissionDenied?`):

```ts
/**
 * #751: drop a call whose request (method, resolved URL, serialized body) is
 * already in flight from this hook. True by default. Set false only for an
 * endpoint that must receive identical concurrent requests.
 */
dedupeInFlight?: boolean;
```

### `apps/web/src/utils/api.util.ts` — request building, shared by `mutationFn` and the key

Extract the existing inline resolution in `mutationFn` into one local function so the request sent and the key can't disagree:

```ts
function buildRequest<TVariables>(
  config: Pick<AuthMutationConfig<unknown, TVariables>, "url" | "body" | "method">,
  variables: TVariables
): { method: string; url: string; bodyPayload: unknown; isBinary: boolean };

/** null ⇒ not deduplicable (FormData / Blob body). */
export function requestKey(req: ReturnType<typeof buildRequest>): string | null;
```

`requestKey` returns `` `${method} ${url} ${bodyPayload === undefined || bodyPayload === null ? "" : JSON.stringify(bodyPayload)}` ``, or `null` when `isBinary`.

### `apps/web/src/utils/api.util.ts` — `useAuthMutation` return

The return type is unchanged (`UseMutationResult<TData, ApiError, TVariables>`). It returns `{ ...mutation, mutate, mutateAsync }`, where:

- `inFlight = useRef(new Map<string, Promise<TData>>())`.
- `mutateAsync(variables, options?)`:
  - when `dedupeInFlight === false`, or the key is `null`, it delegates to `mutation.mutateAsync`;
  - otherwise it returns `inFlight.get(key)` if present;
  - otherwise it calls `mutation.mutateAsync(variables, options)`, stores the promise, and deletes it in `finally` (on success or error), then returns it.
- `mutate(variables, options?)` calls `void mutateAsync(variables, options).catch(() => {})`. That matches react-query's `mutate`, which never throws; errors still reach `onError` and `mutation.error`.
- `mutate` and `mutateAsync` are stable across renders (`useCallback` over refs), so existing `useEffect` deps don't churn.

### `apps/web/src/utils/use-single-flight.util.ts` — new

```ts
/**
 * #751: wrap an async action so a call while a previous one is still running
 * returns that run's promise instead of starting another. For workflow
 * actions that chain several requests (a duplicate run would repeat the
 * non-deduplicated steps). The wrapper is stable; it always invokes the
 * latest `fn`.
 */
export function useSingleFlight<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult>;
```

It holds a ref to the running promise and clears it in `finally`. The latest `fn` is read through a ref, so callers keep their existing dependencies.

### Workflow run guards

| Function | File | Change |
|---|---|---|
| `startParse` | `workflows/FileUploadConnector/utils/file-upload-workflow.util.ts:213` | wrapped with `useSingleFlight`; the returned `startParse` is the wrapper |
| `onInterpret`, `onCommit` | `workflows/_shared/spreadsheet/use-spreadsheet-workflow.util.ts:659`, `:699` | both wrapped (this covers FileUpload, Google Sheets and Microsoft Excel) |
| `onCommit` | `workflows/RestApiConnector/RestApiConnectorWorkflow.component.tsx:594` | wrapped |

Run tokens stay. They still discard a superseded run's *progress* after `reset()`. The guard only stops a concurrent duplicate from starting.

### Removals (`packages/core`)

`packages/core/src/ui/Modal.tsx`:
- Remove `SUBMIT_HOLD_MS`, the `submitHold` ref, `releaseSubmitHold`, its two effects and the unmount effect, and the `slotProps` wrapper.
- Remove `swallowRepeatClick` and the `onClickCapture` on `DialogActions`.
- `{...props}` passes `slotProps` straight through again, as before #747.
- `useEffect` / `useRef` imports drop if unused.

`swallowRepeatClick` leaves the public `@portalai/core/ui` surface through `export * from "./Modal.js"`. It has no other consumers once the views are reverted.

### Removals (`apps/web`)

- `views/EntityGroups.view.tsx`, `views/EntityGroupDetail.view.tsx`: drop `onClickCapture={swallowRepeatClick}` and the import.
- `__tests__/dialog-enter-submit.guard.test.ts`: drop `rawFormActions` and the `#751` describe block. The #685 `submitDisabled` / `FormDefaultButton disabled` assertions stay.

### Docs

- **CLAUDE.md** "Form & Dialog Pattern", Enter-submit bullet: remove the #747-hold and #751-swallow sentences. Add one sentence: duplicates are stopped by `useAuthMutation`'s single-flight (one in-flight request per method+URL+body per hook; opt out with `dedupeInFlight: false`), and a multi-request workflow action wraps itself in `useSingleFlight`.
- **CLAUDE.md** "API Calls & SDK Helpers": the same rule in one line under `useAuthMutation`.
- **`.github/copilot-instructions.md`**: mirror both.

## Migration

None: client-only, no schema change.

## Seed

None.

## TDD test plan

### `apps/web/src/__tests__/auth-mutation-single-flight.test.tsx` (new)
Uses the `auth-mutation-permission-denied.test.tsx` harness (mocked `Auth.provider`, stubbed `global.fetch` with a controllable deferred response).
1. Two `mutate(sameVars)` before the first settles → `fetch` called **once**.
2. After the first settles, the same `mutate` → `fetch` called again (2 total).
3. Settle with an error → the key clears; a retry sends.
4. Two `mutate` with different URL variables (`url: (v) => /x/${v.id}`) → both send.
5. Same URL, different bodies → both send.
6. `mutateAsync` twice → both resolve to the **same** result; `fetch` once.
7. `dedupeInFlight: false` → two sends.
8. A `FormData` body → two sends (not deduplicated).
9. A dropped call's per-call `onSuccess` doesn't run; the first call's does.
10. The `mutate` / `mutateAsync` identities are stable across rerenders.

### `apps/web/src/__tests__/use-single-flight.test.ts` (new)
11. A concurrent second call returns the first promise; `fn` runs once.
12. After settling, a new call runs `fn` again.
13. A rejection clears it; the next call runs.
14. The latest `fn` is used after a rerender.

### Workflow guards
15. `workflows/FileUploadConnector/__tests__/file-upload-workflow.util.test.ts`: it exercises the shared spreadsheet core through `useFileUploadWorkflow`. `onCommit` twice concurrently → `callbacks.runCommit` once; `onInterpret` likewise → `callbacks.runInterpret` once.
16. Same file: `startParse` twice → `callbacks.parseFile` once.
17. RestApi `onCommit`: there is no container suite (`RestApiConnectorWorkflow` has no test today), and building one means mocking the whole SDK surface. It's covered by the `useSingleFlight` unit tests (11–14) plus the smoke step. The wiring is a one-line wrap.

### Dialog regression (existing, behaviour preserved without the hold)
18. `apps/web/src/__tests__/CreateStationDialog.test.tsx` (or a new `dialog-single-flight.integration.test.tsx` if that suite only renders the UI component): double Enter and double click with a pending parent mutation → one request. This is an integration-level render with the real `useAuthMutation` and a stubbed fetch.
19. `apps/web/src/__tests__/EditFieldMappingDialog.test.tsx` (same caveat): Confirm & Save clicked twice → one request.

### `packages/core/src/__tests__/ui/Modal.test.tsx`
20. Remove the hold and swallow cases (`:318–442`). Keep Enter-submits, `submitDisabled` blocks Enter, and `formnovalidate`. Add: double Enter with no `submitDisabled` calls `onSubmit` twice, which proves deduplication isn't Modal's job.

### Guard
21. `dialog-enter-submit.guard.test.ts` still passes with the #751 block removed.

Commands: `npm run test:unit -- --testPathPattern '<files>'` in `apps/web` and `packages/core`, then `npm run type-check`, `npm run lint`, `npm run format:check` at the root. **Totals ≈ 20 cases** (plus the removals).

## Acceptance criteria

- [ ] Double-click, double Enter, click then Enter, and a double "Confirm & Save" each send **one** request from any dialog.
- [ ] Two quick, *different* requests from one hook (revoking two grants) both send.
- [ ] A double click on a workflow Upload, Interpret or Commit starts one run.
- [ ] After a validation error, a corrected resubmit sends immediately (no 500 ms lockout).
- [ ] Clicking Back twice quickly in a stepper steps back twice.
- [ ] `Modal` has no submit hold and no repeat-click swallow; `swallowRepeatClick` no longer exists.

## Risks & rollback

- **A legitimate identical concurrent request gets dropped.** Detected by a feature that silently does less. Mitigation: the `dedupeInFlight: false` opt-out, and the spec's survey found none. Rollback: revert the `api.util.ts` commit; everything else is independent.
- **A body that varies per call** (a client timestamp or ID) defeats the key. The survey found none in mutation bodies. Such a call degrades to today's behaviour; it doesn't break.
- **A promise that never settles** blocks re-sending that exact request until the hook unmounts. `fetchWithAuth` settles on network error, and closing a dialog unmounts its hook.
- **Removing the #747 hold re-opens double Enter if the guard regresses.** Test 18 pins double Enter end-to-end through the real hook.
- **Fail mode:** the guard fails open. A `null` key, or the opt-out, sends normally, so it never blocks a first request.

## Files touched

- edit `apps/web/src/utils/api.util.ts`
- new `apps/web/src/utils/use-single-flight.util.ts`
- edit `apps/web/src/workflows/FileUploadConnector/utils/file-upload-workflow.util.ts`
- edit `apps/web/src/workflows/_shared/spreadsheet/use-spreadsheet-workflow.util.ts`
- edit `apps/web/src/workflows/RestApiConnector/RestApiConnectorWorkflow.component.tsx`
- edit `apps/web/src/views/EntityGroups.view.tsx`, `apps/web/src/views/EntityGroupDetail.view.tsx`
- edit `packages/core/src/ui/Modal.tsx`
- tests: new `apps/web/src/__tests__/auth-mutation-single-flight.test.tsx`, new `apps/web/src/__tests__/use-single-flight.test.ts`; edit `workflows/FileUploadConnector/__tests__/file-upload-workflow.util.test.ts`, `CreateStationDialog` / `EditFieldMappingDialog` tests, `packages/core/src/__tests__/ui/Modal.test.tsx`, `apps/web/src/__tests__/dialog-enter-submit.guard.test.ts`
- docs: `CLAUDE.md`, `.github/copilot-instructions.md`

## Next step

`docs/DIALOG_DOUBLE_SUBMIT.plan.md` sequences this into four test-first slices on this branch:
1. Single-flight in `useAuthMutation` (tests 1–10).
2. `useSingleFlight` and the workflow guards (11–17).
3. Dialog regression tests, then retire the hold and swallow, with the doc rewrite (18–21).
4. Smoke.

Slice 3 also reverts the first #751 commit's swallow.
