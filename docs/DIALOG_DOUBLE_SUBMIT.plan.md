# One request per submit intent — Plan

**Test-first implementation of the request-level guard. First single-flight in `useAuthMutation`, then `useSingleFlight` on the multi-request workflow actions, then dialog regression tests through the real hook. Only then are the #747 hold and the #751 swallow retired, with the docs rewritten.**

Spec: `docs/DIALOG_DOUBLE_SUBMIT.spec.md`. Discovery: `docs/DIALOG_DOUBLE_SUBMIT.discovery.md`. Issue: #751. Builds on #747 (merged), whose Modal hold this plan removes.

Three code slices, each behind a green test suite and each leaving the repo compilable, then the smoke phase. They land as **commits on `fix/751-dialog-double-submit` / PR #752**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly):

```bash
cd apps/web && npm run test:unit -- --testPathPattern '<files>'
cd packages/core && npm run test:unit -- --testPathPattern '<files>'
```

Each slice:
1. Write failing tests.
2. Make the smallest change that turns them green.
3. Run the focused tests.
4. Run `npm run lint && npm run type-check && npm run format:check` at the root at the boundary.
5. Move to the next slice.

Sequencing rationale: the new guard must be in place and proven before the old guards come out.

- **Slice 1** adds the request guard. It's additive, and the #747 hold and the swallow still stand beside it.
- **Slice 2** reuses the same idea for workflow actions that chain several requests. It's independent of the dialogs.
- **Slice 3** first pins double Enter, double-click and Confirm & Save *end-to-end through the real hook*. Those tests are green before the removal because the old guards also stop them. Removing the hold and the swallow must keep them green, so the removal is safe by construction. The doc rewrite lands here, with the behaviour it describes.
- **Smoke** follows as its own phase (`/smoke 751`).

No migration, no seed.

---

## Slice 1 — single-flight in `useAuthMutation`

Delivers spec §Surface `AuthMutationConfig.dedupeInFlight`, `buildRequest` / `requestKey`, and the wrapped `mutate` / `mutateAsync`.

**Files**

- New: `apps/web/src/__tests__/auth-mutation-single-flight.test.tsx`. Harness copied from `auth-mutation-permission-denied.test.tsx` (mocked `Auth.provider`), with a deferred `global.fetch` that each test resolves or rejects by hand.
- Edit: `apps/web/src/utils/api.util.ts`. Extract `buildRequest`, add `requestKey`, add `dedupeInFlight` to `AuthMutationConfig`, and wrap the result's `mutate` / `mutateAsync` over a per-instance in-flight `Map`.

**Steps**

1. **Tests (spec cases 1–10).**
   - Same request twice while pending → one `fetch`.
   - Sends again once settled, and after an error.
   - A different URL, or a different body → both send.
   - `mutateAsync` twice → the same result from one `fetch`.
   - `dedupeInFlight: false` → two sends; a `FormData` body → two sends.
   - A dropped call's per-call `onSuccess` doesn't run.
   - `mutate` / `mutateAsync` keep their identity across rerenders.

   Run them; 1, 2/6, 9 and 10 fail.
2. **Implement.** `mutationFn` uses `buildRequest`, so the request sent and its key share one code path. The wrapper uses `useRef(new Map())` and `useCallback`. `mutate` is `void mutateAsync(...).catch(() => {})`. Green.
3. Run the existing `useAuthMutation` suites (`auth-mutation-permission-denied`, `cache-invalidation`, the `__tests__/api/*.api.test.ts` set) to show nothing regressed. Then lint and type-check.

**Done when:** cases 1–10 pass, the full web unit suite is green, and no call site changed.

**Risk:** a consumer that relies on `mutation.mutate` identity or on react-query's `mutate` returning `undefined` synchronously. The wrapper keeps both: it's stable and returns `void`. A consumer that compared the whole result object would see a new object every render. The rerender test (case 10) and the full suite cover this.

---

## Slice 2 — `useSingleFlight` and the workflow run guards

Delivers spec §Surface `use-single-flight.util.ts` and §Workflow run guards.

**Files**

- New: `apps/web/src/utils/use-single-flight.util.ts`.
- New: `apps/web/src/__tests__/use-single-flight.test.ts`.
- Edit: `apps/web/src/workflows/_shared/spreadsheet/use-spreadsheet-workflow.util.ts`. Wrap `onInterpret` (`:659`) and `onCommit` (`:699`).
- Edit: `apps/web/src/workflows/FileUploadConnector/utils/file-upload-workflow.util.ts`. Wrap `startParse` (`:213`).
- Edit: `apps/web/src/workflows/RestApiConnector/RestApiConnectorWorkflow.component.tsx`. Wrap `onCommit` (`:594`).
- Edit: `apps/web/src/workflows/FileUploadConnector/__tests__/file-upload-workflow.util.test.ts`.

**Steps**

1. **Tests (spec cases 11–16).**
   - `useSingleFlight` (11–14): a concurrent call shares the promise; it runs again after settling and after a rejection; the latest `fn` is used.
   - Workflows (15–16), in `file-upload-workflow.util.test.ts` with a deferred `runCommit` / `runInterpret` / `parseFile`: two concurrent calls → the callback runs once.

   Run them; they fail.
2. **Implement** the hook, using a `promiseRef` and a `fnRef` updated in an effect, cleared in `finally`. Then wrap the four functions. Run tokens stay. Green.
3. Run the workflow suites (`workflows/FileUploadConnector/__tests__`, `workflows/GoogleSheetsConnector/__tests__`, `workflows/MicrosoftExcelConnector/__tests__`, `modules/RegionEditor/__tests__`). Then lint and type-check.

**Done when:** cases 11–16 pass and every workflow suite stays green. Case 17 (RestApi) is covered by 11–14 plus smoke, per the spec.

**Risk:** `reset()` during a running commit. The run token already discards that run's result. The single-flight promise still clears in `finally` when the request ends, so a new commit after `reset()` can only start once the old request has settled. That's acceptable, since `reset()` closes the workflow. It's noted for review.

---

## Slice 3 — dialog regression tests, then retire the UI guards and rewrite the docs

Delivers spec §Removals (core + web), §Docs, and test cases 18–21.

**Files**

- New: `apps/web/src/__tests__/dialog-single-flight.integration.test.tsx`. It renders `CreateStationDialog` and `EditFieldMappingDialog` (`components/*.component.tsx`; both are props-only UI), each wired to a real `useAuthMutation` (stubbed `fetch`, deferred). `CreateStationDialog.test.tsx` and `EditFieldMappingDialog.test.tsx` render only the pure UI with a jest `onSubmit`, so they can't prove a single request.
- Edit: `packages/core/src/ui/Modal.tsx`. Remove the hold, `swallowRepeatClick`, `onClickCapture`, and the `slotProps` wrapper.
- Edit: `packages/core/src/__tests__/ui/Modal.test.tsx`. Remove the hold and swallow cases. Add case 20: double Enter with no `submitDisabled` → `onSubmit` twice (deduplication isn't Modal's job).
- Edit: `apps/web/src/views/EntityGroups.view.tsx`, `apps/web/src/views/EntityGroupDetail.view.tsx`. Drop the swallow and its import.
- Edit: `apps/web/src/__tests__/dialog-enter-submit.guard.test.ts`. Drop `rawFormActions` and the #751 block.
- Edit: `CLAUDE.md` (Form & Dialog Enter-submit bullet; API Calls & SDK Helpers), `.github/copilot-instructions.md`.

**Steps**

1. **Tests (spec cases 18–19).**
   - Double Enter, double-click, and click then Enter on Create Station → one `POST`.
   - Confirm & Save twice in Edit Field Mapping → one `PATCH`.

   These are green now, with the old guards still in place. Commit-local check: temporarily comment out the slice-1 deduplication and confirm 18–19 still fail on the click-then-Enter and Confirm & Save cases. Those are the paths only the request guard covers. Then restore it.
2. **Remove** the #747 hold and the #751 swallow from `Modal`, their view opt-ins and the guard rule, and update the core `Modal` tests (case 20). Re-run 18–19: they must stay green. Run the guard (21).
3. **Docs:** rewrite the CLAUDE.md bullets and the Copilot mirror per spec §Docs.
4. Rebuild core (`npm run build --workspace @portalai/core`) so web type-checks against the new `Modal` surface. Then run the full web and core unit suites, lint, type-check and format.

**Done when:** cases 18–21 pass with no Modal hold or swallow in the tree, `grep -r swallowRepeatClick` finds nothing, and the docs describe the request guard.

**Risk:** a dialog whose submit doesn't go through `useAuthMutation` loses #747's Enter hold with nothing replacing it. Example: `NewEntityDialog`, with local async validation (`modules/RegionEditor/NewEntityDialog.component.tsx:113–133`). Its submit only commits local state, so no request is duplicated; a double submit there is idempotent local state. Check its tests stay green.

---

## Smoke (phase, after slice 3)

`/smoke 751` scaffolds `docs/DIALOG_DOUBLE_SUBMIT.smoke.md`, mapped from the spec's acceptance criteria:
- double-click, double Enter, and click then Enter on New Station;
- Confirm & Save on Edit Field Mapping;
- double-click on a workflow Commit;
- revoking two grants quickly in Share (both go through);
- resubmitting right after a validation error;
- Back twice in a stepper.

`/smoke-walk` produces the evidence.

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | single-flight in `useAuthMutation` + opt-out | spec 1–10; web suite green |
| 2 | `useSingleFlight` + 4 workflow guards | spec 11–16; workflow suites green |
| 3 | dialog e2e-through-hook tests; hold + swallow removed; docs | spec 18–21; core + web suites green; no `swallowRepeatClick` |
| — | smoke | `/smoke 751` → `/smoke-walk` |

## Cross-slice notes

- **The first #751 commit (`f9afff8d`) is undone by slice 3**, not by a `git revert`, because #747's hold is removed in the same pass and the tests are rewritten together.
- **Core rebuild:** slice 3 changes `packages/core`'s public surface (`swallowRepeatClick` removed). Rebuild core before web's type-check, or turbo's root `type-check` will see a stale `dist`.
- **Docs in the same PR:** CLAUDE.md, the Copilot mirror, and the PR body, which still describes the swallow. No user-facing help or glossary copy covers submit behaviour.
- **The PR title/body for #752** change to the request guard at slice 3. The issue's `## Scope (amended)` already matches.

## Next step

Implementation starts on this branch with slice 1, tests first, once this plan is confirmed.
