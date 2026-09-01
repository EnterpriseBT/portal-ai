# stranded-job-reconciliation — Smoke Suite

Manual smoke test for [#391](https://github.com/EnterpriseBT/portal-ai/issues/391) — the sweep that reaps jobs stranded non-terminal by a Redis loss, plus the lock alert's age + stuck-hint surface. **Branch under test:** `fix/stranded-job-reconciliation` (PR [#487](https://github.com/EnterpriseBT/portal-ai/pull/487)).

## Preflight

### Environment

- [ ] `git checkout fix/stranded-job-reconciliation && git pull --ff-only` (no migration on this branch)
- [ ] **Shorten the windows for the walk** — add to `apps/api/.env`: `JOB_STRANDED_THRESHOLD_MS=60000` and `JOB_STRANDED_SWEEP_INTERVAL_MS=30000`, then **restart `npm run dev`** (env loads at dev-server start). Remove both lines after the walk.
- [ ] `npm run dev` boots cleanly; the API log shows `Startup stranded-job sweep clean` (or `…reaped jobs`) shortly after start

### Fixtures

- [ ] A connector entity with a few hundred+ records whose sync/import runs long enough to catch mid-flight (a file-upload import works; re-use any existing connector)
- [ ] `redis-cli` reachable (`docker exec -it portalai-redis-1 redis-cli` or `redis-cli -p 6380`)

### Reset between runs

- [ ] Reaped rows are terminal `failed` — nothing to reset; re-trigger a fresh job per section. Remember to remove the shortened env values at the end.

## §1 — Redis loss mid-job → reaped by the interval, no restart (slices 1–3)

- [ ] Start a long-running job (import or sync); while its lock alert shows on the instance view, run `FLUSHALL` in redis-cli (note: this clears all local Redis state — dev-stack only)
- [ ] The `jobs` row stays `active` (psql: `SELECT status FROM jobs ORDER BY created DESC LIMIT 1`) and the lock alert keeps showing — this is the pre-#391 stranded state
- [ ] **Without restarting anything**, wait out threshold + interval (~90s at the shortened values): the row flips to `failed` with `error` beginning `Stranded: the queue no longer holds this job` and `completed_at` set
- [ ] The API log shows `Reaped a stranded job…` and a sweep summary with `reaped ≥ 1`
- [ ] Refresh the instance (or entity) view: the lock alert is gone and the paused actions (sync / edit / delete) are enabled again — no support interaction needed
- [ ] `JobDetail` for the reaped job shows status Failed with the stranded reason

## §2 — Boot pass alone reconciles (slice 3)

- [ ] Repeat the strand (start job → `FLUSHALL`), then immediately restart `npm run dev` instead of waiting
- [ ] On boot the log shows `Startup stranded-job sweep reaped jobs` and the row is `failed` with the stranded reason (the row must be past the shortened threshold — wait ~60s after FLUSHALL before restarting)

## §3 — Protections: never reap the living (slice 2 guards)

- [ ] With Redis healthy, start a long job and wait past the shortened threshold while it is still genuinely running → it is **not** reaped (its BullMQ entry exists; existence is the veto), and it completes normally
- [ ] Seed a stale `awaiting_confirmation` row (psql: insert a jobs row with that status, `updated` an hour old, any `bull_job_id`) → after a sweep tick it is untouched
- [ ] Race with cancel: strand a job (FLUSHALL), then `POST /api/jobs/:id/cancel` (JobDetail's Cancel button) **before** the sweep fires → the row reads `cancelled`, and after the next sweep tick it still reads `cancelled` (first terminal writer wins; the sweep's summary counts it skipped, not reaped)

## §4 — The alert's age line + stuck hint (slice 4)

- [ ] With any job running, the lock alert now shows a per-job line `<label> — started X ago` (fresh job: no hint)
- [ ] Seed a stale `active` row locking a visible instance (psql: `connector_sync`, `metadata.connectorInstanceId` = a real instance id, `started_at`/`updated`/`created` ~20 min old, bogus `bull_job_id`) with the sweep **off** (unset the shortened env + restart, or just check within the first 60s): the alert line reads `… — this job may be stuck. View job to check or cancel it.`
- [ ] The **View job** link lands on that job's detail view, where the Cancel button is present and works
- [ ] Only the stale job carries the hint when a fresh job runs alongside it

## §5 — Fail-open when Redis is down (spec risk)

- [ ] Stop the Redis container (`docker stop portalai-redis-1`) with a non-terminal row in the DB → over the next sweep intervals the row is **never** reaped (absence must be positively observed; an unreachable queue is not evidence)
- [ ] `docker start portalai-redis-1` → the app recovers; the next sweep tick behaves normally

> Acceptance criterion "lint/type-check/suites green" is CI's box on PR #487, not a manual step. The concurrent-sweep convergence criterion beyond §3's cancel race is pinned by unit/integration tests (multi-instance ECS isn't reproducible on a dev stack).

## Sign-off

- [ ] Every section above verified
- [ ] Shortened env values removed from `apps/api/.env`
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/job/entity ids):
