# lost-execution-recording — Smoke Suite

Manual smoke test for [#464](https://github.com/EnterpriseBT/portal-ai/issues/464) — a sync execution lost to process death is now recorded (`lost_executions` column + `JobDetail` display). **Branch under test:** `fix/lost-execution-recording` (PR [#467](https://github.com/EnterpriseBT/portal-ai/pull/467)).

The core trigger is a **stall re-delivery**: kill the worker while a job is mid-run, let BullMQ re-deliver it, and confirm the resuming execution records the loss. This needs a sync long enough that you can kill it mid-flight *and* re-delivery lands before it would have finished on its own.

## Preflight

### Environment

- [ ] `git checkout fix/lost-execution-recording && git pull --ff-only`
- [ ] `npm install`
- [ ] **Apply migration 0083** — `cd apps/api && npm run db:migrate` (adds `jobs.lost_executions integer not null default 0`; confirm `0083_add-jobs-lost-executions` in the output)
- [ ] `npm run dev` boots cleanly (API :3001, web :3000)
- [ ] Note: run this on a stack that won't suspend mid-job and won't restart the worker on unrelated file saves — an editor save (nodemon) or a container suspend during the window is itself a kill and will confuse the read. Prefer a quiet local run or app-dev.

### Fixtures

- [ ] A connector instance whose sync produces enough records to run for **tens of seconds** — large enough to kill mid-reap. The #460 large instances (e.g. `Smoke 3`) are ideal; any multi-thousand-row REST/CSV sync works.
- [ ] Have `npm run db:studio` (from `apps/api/`) open on the `jobs` table, and the web app signed in.

### Reset between runs

- [ ] No reset needed — each run creates a fresh job row. To re-verify, kick a new sync.

## §1 — A killed execution is recorded (spec AC 1, 2, 4)

- [ ] Trigger a sync on the fixture instance (via the connector-instance view). Note the job id from the redirect to `/jobs/<id>` (or from the `jobs` table).
- [ ] While the job is **`active`** and progress is climbing (mid-reap is ideal), hard-kill the API/worker process: `kill -9 <api-worker-pid>`. (Resolve the pid in a separate step so a `pkill -f` pattern doesn't also kill your own shell — see the repo's kill-safety note.)
- [ ] Restart the stack: `npm run dev`. Wait for BullMQ's stalled checker to **re-deliver** the job — progress resets toward 0 and the job runs a second time, then reaches `completed`.
- [ ] In `db:studio`, open the job's row in `jobs`:
  - [ ] `lost_executions` = **1** (the killed execution was recorded).
  - [ ] `status` = `completed`, and `attempts` is **unchanged by the re-delivery** (a stall re-delivery does not advance it — it will read whatever the BullMQ attempt count was, typically `1`, *not* `2`).
- [ ] Open `/jobs/<id>` in the web app. The metadata list shows a **`Lost executions: 1`** row (alongside `Attempts: 1 / 3`).
- [ ] (Optional, if you can kill it twice) A second kill+re-delivery on another long sync yields `lost_executions` = **2** and the view reads `Lost executions: 2`.

## §2 — A clean run records nothing (spec AC 3, 4)

- [ ] Trigger a sync on any instance and let it run to `completed` **without** killing anything.
- [ ] In `db:studio`, the job's `lost_executions` = **0**.
- [ ] On `/jobs/<id>`, there is **no `Lost executions` row** at all (zero is hidden — the row appearing is itself the signal).

## §3 — Doc-sync (spec AC 7)

- [ ] `grep -n "until #464 lands" CLAUDE.md .github/copilot-instructions.md` returns **nothing**.
- [ ] The "Async Job State & Data Locking" bullet in `CLAUDE.md` now describes the resuming execution's still-`active` detection and the `lost_executions` column.

## §4 — Not manually smoke-tested (recorded)

- [ ] **Pre-read fail-open (spec AC 5).** "A DB read failure at the processor top does not sink or stall the execution; the opening `active` transition still fires and the increment is skipped." Forcing a DB read to fail mid-job is not safely reproducible by hand — this is covered by the unit test `apps/api/src/__tests__/queues/jobs.worker.retry.test.ts` → *"fails open: a pre-read failure does not sink the execution"*. No manual step; noted here so the criterion isn't silently dropped.
- [ ] **Build/type-check/lint (spec AC 6)** — verified by CI (Static Checks) on the PR; no local step required.

## Sign-off

- [ ] Every section above verified
- [ ] ______ (date + name) — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/job/entity ids):
