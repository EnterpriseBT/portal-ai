# One request per submit intent — Discovery

**Issue:** [EnterpriseBT/portal-ai#751](https://github.com/EnterpriseBT/portal-ai/issues/751) · Bug · **full** (amended from condensed, see the issue's `## Sizing`).

**Why this exists.** A fast second activation of a submit sends the request twice. That can be a double-click, two Enters, or a click followed by Enter. Measured: a double-click on New Station's Create sent two `POST /api/stations` (4 of 4). The cause is a render lag. A mutation's `isPending` reaches the button's `disabled` (and `Modal`'s `submitDisabled`) only a render after `mutate()`, measured at 22–77 ms in dev. An activation landing inside that window goes through.

Two patches so far each closed one input path. #747 added a 500 ms submit hold on `Modal`'s form `onSubmit` (Enter). The first #751 commit made `Modal`'s actions row swallow a click with `detail ≥ 2` (double-click). Code review then showed what both miss:
- workflow submits rendered in the dialog body;
- raw non-form dialogs;
- the revalidation "Confirm & Save" buttons;
- click-then-Enter across the two guards.

They also carry side effects: a validation retry within 500 ms is blocked, and fast repeat clicks on Back are dropped. Guarding UI events is the wrong layer, because every one of those paths ends in the same call. **This is the single-flight guard on that call: one request per submit intent, whichever input produced it.**

## The current shape

### Where every submit ends: `useAuthMutation`

| Piece | Location | Note |
|---|---|---|
| `useAuthMutation` | `apps/web/src/utils/api.util.ts:246` | wraps react-query `useMutation`; `mutationFn` resolves `url(variables)`, `body(variables)`, and sends via `fetchWithAuth` |
| SDK-only rule | CLAUDE.md "API Calls & SDK Helpers"; `__tests__/sdk-only-api-calls.test.ts` | every write goes through `useAuthMutation`, enforced by the guard |
| Call sites | 86 `.mutate(` / `mutateAsync(` in `apps/web/src` (non-test) | views hand narrow callbacks to pure dialogs; dialogs never import `sdk` |

### UI-event guards to retire

| Piece | Location | Note |
|---|---|---|
| #747 submit hold | `packages/core/src/ui/Modal.tsx:16` (`SUBMIT_HOLD_MS`), `:88–126` | wraps the paper form's `onSubmit` only; released on `submitDisabled`, on close (`:98–100`), or after 500 ms |
| #751 repeat-click swallow | `packages/core/src/ui/Modal.tsx:27–32`, applied at `:175` | `DialogActions onClickCapture`; drops `detail > 1` |
| Raw-dialog opt-ins | `apps/web/src/views/EntityGroups.view.tsx:329`, `EntityGroupDetail.view.tsx:190` (and its remove confirm) | added by the first #751 commit |
| Guard rule | `apps/web/src/__tests__/dialog-enter-submit.guard.test.ts:86–95` | requires the swallow on raw form `DialogActions` |
| Core tests | `packages/core/src/__tests__/ui/Modal.test.tsx:318–442` | hold and swallow cases |

### Submit wiring today (survey of 40 form `Modal`s, workflows, raw dialogs)

| Shape | Count / examples | Reaches |
|---|---|---|
| Visible `type="button"` calling the same handler as the form's `onSubmit` | 39 dialogs (32 direct, 6 guarded lambdas such as `DeleteColumnDefinition :127`, 1 cast at `EditColumnDefinitionDialog :231`) | parent's `mutate` |
| Revalidation "Confirm & Save" in the body, `onClick={() => onSubmit(pendingBody)}`, no `disabled` | `EditColumnDefinitionDialog :396–400`, `EditFieldMappingDialog :381–385` | parent's `mutate` |
| Non-submit mutations in a dialog | EditToolpack Refresh / Rotate (`:222–236`), Share revoke per row (`ShareDialog :261`) | their own `mutate` |
| Workflow submits in the body, paper not a form | FileUpload Upload (`FileUploadConnectorWorkflow :343–349`), Commit (`RegionEditor/ReviewStep :519–528`), Interpret (`RegionDrawingStep :657–664`), RestApi Commit (`RestApiConnectorWorkflow :189–195`) | orchestration (`startParse`, `onCommit`) calling `mutateAsync` steps |
| Raw `Dialog`s | EntityGroups create (`:290–343`), EntityGroupDetail add/remove (`:151–206`, `:498–518`), PinnedResultDetail rename/delete (`:232–281`) | parent's `mutate` |
| Non-dialog | Sync now (`ConnectorInstanceSyncButton :91–96`), Unpin (`PinnedResultDetail :134–146`), toolpack refresh (`Toolpacks.view :458,516`) | `mutate` |

Every row ends in `useAuthMutation` except the multi-call workflow orchestrations. For those, `startParse` (`workflows/FileUploadConnector/utils/file-upload-workflow.util.ts:213`) already claims a run token to supersede a stale run's *progress*, but it does not stop a second run's *requests*.

## The design space

### Decision 1 — where the guard lives

- **A. UI events (status quo, extended).** Keep the #747 hold and the #751 swallow, and patch each uncovered site. Every new surface must remember it, and the review findings (cross-path, validation-retry lockout, dropped Back clicks) stay inherent.
- **B. One form path.** Make visible submits `type="submit"` so click and Enter share `Modal`'s hold. This reverses the `type="button"` convention in about 39 dialogs. It still misses body buttons that aren't the form submit (Confirm & Save), non-form workflows and raw dialogs. It keeps the 500 ms hold's lockout.
- **C. Single-flight in `useAuthMutation`.** A synchronous, ref-held in-flight set per hook instance. A call whose request matches one already in flight doesn't send. It's one place, under the SDK-only rule every write already obeys. There's no render dependence and no timer. Validation failures never reach it, so there's no lockout. It is input-agnostic.

| | A | B | C |
|---|---|---|---|
| Covers click, Enter, double-click, click+Enter | partly | yes (form dialogs only) | yes |
| Covers body buttons, workflows, raw dialogs, page buttons | per-site opt-in | no | yes (single-call); orchestrations see Decision 3 |
| Depends on render timing / timers | yes | yes (500 ms) | no |
| Blocks legitimate actions | Back twice; retry < 500 ms | retry < 500 ms | no, if keyed per request (Decision 2) |
| Files touched | many, open-ended | ~45 | `api.util.ts` + retiring A's pieces |

**Lean: C.** The duplicate is a property of the request, not of the input event, so guard the request. It is the only option whose coverage doesn't depend on every author remembering a rule.

### Decision 2 — what counts as "the same request"

- **A. Any call while one is in flight (per hook instance).** Simplest. But it drops legitimate parallel calls on one hook: revoking two grants quickly in `ShareDialog :261` would lose the second.
- **B. The same variables.** Fixes per-row parallelism, but keys on the caller's shape rather than what is sent.
- **C. The same wire request: method + resolved URL + serialized body.** This is exactly "would the server receive the same thing twice". Two different rows produce different URLs, so they run in parallel. A double-click on Create produces byte-identical bodies, so the second is dropped. The key is computed from what `mutationFn` already builds (`api.util.ts` resolves `url(variables)` and `body(variables)`).

**Lean: C**, keyed on the serialized request. `FormData` bodies can't be stringified. They key by object identity, which a double-click defeats because each click builds a new `FormData`. No current `useAuthMutation` call site sends `FormData` (survey: it appears only in `api.util.ts`), so the fallback costs nothing today and is named as a limit.

### Decision 3 — what the dropped call returns, and multi-call orchestrations

A dropped `mutate()` is a no-op: the first call's `onSuccess` and `onError` already drive the UI. A dropped `mutateAsync()` returns the in-flight promise, so an awaiting caller (a workflow step) continues with the first call's result instead of hanging or rejecting.

Orchestrations such as `startParse` and the workflows' `onCommit` chain several requests. With C, each duplicated step is absorbed. But a second run's *non*-`useAuthMutation` work, such as the direct upload transfer, would still repeat. **Lean:** give each orchestration a run-level in-flight guard next to its existing run token, so a second `startParse` or `onCommit` while one runs returns that run's promise. That is two to four functions, enumerated in the spec.

### Decision 4 — the retired UI guards

Once C lands, the #747 hold and the #751 swallow are redundant, and both have side effects (the review). **Lean: remove both** and restore `Modal` to its pre-#747 submit wiring. This also removes `swallowRepeatClick`, the raw-dialog opt-ins and their guard rule. That's a clean cut per the house no-compat rule. `submitDisabled` stays: it still keeps Enter consistent with the visible button for an *incomplete* form, which is its other job.

## Tradeoff comparison

|  | C: single-flight in `useAuthMutation` | C: wire-request key | Return in-flight promise + run guard | Remove UI guards |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| New pattern | the in-flight set (one place) | — | run guard mirrors the existing run token | — |
| Contract change | `useAuthMutation` gains a behaviour (documented, opt-out) | — | — | CLAUDE.md dialog rule rewritten |

## Recommendation

1. `useAuthMutation` holds a per-instance in-flight set keyed by `method + resolvedUrl + serializedBody`. A call whose key is in flight sends nothing. `mutate` returns, and `mutateAsync` returns the in-flight promise. The key is cleared when that request settles, success or error.
2. A `FormData` body keys by object identity, documented as the limit.
3. The config gains an opt-out, `dedupeInFlight: false`, for a call that must send identical requests concurrently. The spec confirms whether any exists today (expected none).
4. Workflow orchestrations (`startParse`, each workflow's `onCommit`, Interpret if it chains calls) get a run-level in-flight guard beside their run token. The spec lists them.
5. Remove the #747 Modal submit hold, `swallowRepeatClick`, the raw-dialog opt-ins and the guard-test rule for them. Rewrite CLAUDE.md's Enter-submit bullet and the Copilot mirror to point at the single-flight rule.
6. Tests: unit-test the in-flight set in `api.util` (same request twice, then once; different URLs, then both; settle clears it; `mutateAsync` shares the promise). Add a browser smoke for double-click, double Enter, click+Enter, Confirm & Save and a workflow commit.

## Open questions

1. **Is dropping an identical in-flight request ever wrong?** An idempotent "refresh" or "sync now" pressed twice sends one request. That's the desired behaviour. **Lean: no opt-out needed today; keep the flag for the future.**
2. **Should the key include headers (e.g. a per-call `Idempotency-Key`)?** None are set per call today. **Lean: no; the key is the wire request as built from config.**
3. **Does the dropped `mutate` need user feedback?** The first request's pending state is already on screen. **Lean: no.**
4. **Should the server also enforce idempotency (an `Idempotency-Key` header on creates)?** That would also cover two tabs, retries after a network blip, and scripts. It is a cross-package contract change. **Lean: out of scope here; file as a follow-up if wanted.**

## Enterprise-scale considerations

- **Concurrency & correctness:** the client guard is per hook instance and per tab. Two tabs or two users can still create twice, so true cross-client deduplication needs a server-side idempotency key (open question 4). **Lean:** the client fix is the right layer for "one user, one intent".
- **Accuracy & auditability:** N/A because no record-of-truth changes; it only stops accidental duplicate writes.
- **Failure modes:** the set clears on settle, success or error. If a promise never settles (a hung request), that exact request can't be re-sent until the hook unmounts. **Lean:** acceptable; `fetchWithAuth` requests end on network error or timeout, and closing the dialog unmounts it.
- **Scale & unbounded growth:** the set is bounded by in-flight requests per hook instance. N/A otherwise.
- **Multi-tenancy:** N/A because it is client-side, per user, per tab.
- **Contract stability:** `useAuthMutation`'s callers don't change. The opt-out flag gives future concurrent-identical endpoints a way out without re-plumbing.
- **Data lifecycle:** N/A.

## What this doesn't decide

- Server-side idempotency keys: a cross-package contract, open question 4.
- Read deduplication: react-query already dedupes queries by key.
- Visual double-click feedback (ripples, button states): unchanged.

## Next step

`docs/DIALOG_DOUBLE_SUBMIT.spec.md` pins the in-flight key and API, enumerates the orchestrations and their run guards, and lists every removal. `docs/DIALOG_DOUBLE_SUBMIT.plan.md` slices it test-first:
1. single-flight in `useAuthMutation`;
2. run guards on the workflow orchestrations;
3. retire the #747 hold, the swallow and its guard rule, with the doc updates;
4. smoke.

The branch's existing swallow commit (`f9afff8d`) is reverted by slice 3, and the condensed doc is replaced by this discovery doc.
