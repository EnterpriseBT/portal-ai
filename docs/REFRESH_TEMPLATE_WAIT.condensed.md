# cache refresh-template waits on a change set that's gone — Condensed design (#864)

**Issue:** [EnterpriseBT/portal-ai#864](https://github.com/EnterpriseBT/portal-ai/issues/864) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** During the #852 walk, `portalops cache refresh-template --env app-dev --phase both --yes` exited 1 seconds after executing its change set, while the stack update went on to `UPDATE_COMPLETE`.
- After `ExecuteChangeSet` it polled that change set's `ExecutionStatus`.
- CloudFormation removes a stack's change sets once one executes (`list-change-sets` was `[]`), so the describe threw.
- #863's test fake kept the change set, so CI passed.

Package: `packages/devops-cli`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The wait | `packages/devops-cli/src/commands/cache.ts` `cacheRefreshTemplate` | polled `DescribeChangeSet` → `ExecutionStatus` after execute |
| The fake | `packages/devops-cli/src/__tests__/cache.test.ts` | kept the change set after execute, unlike CloudFormation |

## Decision — wait on this operation's own stack events

- **A. The SDK's `waitUntilStackUpdateComplete`.** Its first poll can see the *previous* `UPDATE_COMPLETE`, because the asynchronous execute may not have started the update yet.
- **B. A `LastUpdatedTime` baseline** (this PR's first version). The code review found three holes:
  - an execution that fails before the update starts never moves the time, so it hangs for an hour;
  - another update landing meanwhile (a deploy) is taken for this one;
  - a missing stack spins until the deadline.
- **C. Tag the operation with a `ClientRequestToken`, and wait on the stack-level event that carries it.**
  - It succeeds only on `UPDATE_COMPLETE`, and fails on a rollback or failure, naming the status and CloudFormation's reason.
  - Until the operation's first event appears, it reads the executed change set, so `EXECUTE_FAILED`/`OBSOLETE` fail at once. Its removal after a successful execute is expected.
  - A missing stack fails at once.

**Chosen: C**, in one shared `waitForStackOperation`. `updateStackParams` (`cache phase`/`switch`, `service scale`) tags its `UpdateStack` and uses the same wait, replacing the SDK waiter.

## Plan — 1 slice

**Files:** edit `packages/devops-cli/src/commands/cache.ts` (`waitForStackOperation`, `stackTiming`, tokens on `UpdateStack`/`ExecuteChangeSet`) and `packages/devops-cli/src/__tests__/cache.test.ts`. The fake keys stack events by token; a successful execute removes the change set, and a failed one leaves it `EXECUTE_FAILED`.

**Tests** (`npm run test:unit` in `packages/devops-cli`):
- success on this operation's token, audited;
- another operation's `UPDATE_COMPLETE` is ignored;
- a rollback fails, unaudited, naming the status and reason;
- an execution that fails before the update starts fails fast;
- the phase, switch and scale tests now wait on their own token.

## Smoke (manual)

1. The next real use: prod's Provision step, `npx portalops cache refresh-template --env prod --phase both --yes --confirm-prod --json` from a clean `main`, exits 0 after the 10–20 min update with `{"changed":true}`, and `~/.portalai/audit.log` gains a `cache refresh-template` line. app-dev is already past this step, so there's no app-dev walk. The unit fake reproduces the failure the app-dev run hit, and the cases above pin the fix.

## Out of scope

- The other cutover commands. `cache switch` and `service scale` start with `UpdateStack`, which is synchronous to start, and wait with the SDK waiter; the walk proved them on app-dev.
