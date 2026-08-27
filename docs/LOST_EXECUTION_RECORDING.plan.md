# Lost-execution recording — Plan

**Implements #464 TDD-sequenced: a `lost_executions` column, worker-side detection of a stall-re-delivered execution, and a nonzero-only display — schema first, behavior next, docs last.**

Spec: `docs/LOST_EXECUTION_RECORDING.spec.md`. Discovery: `docs/LOST_EXECUTION_RECORDING.discovery.md`. Issue: #464 (moved out of epic #444 at close-out; builds on #441's attempt lifecycle and #460's advisory lock, both on `main`).

4 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/lost-execution-recording`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api     && npm run test:unit
cd apps/web     && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — Slice 1 lands the column + model together (the `type-checks.ts` guards fail to compile if either is missed) plus the mechanical fixture updates a new required Zod field forces, so the tree is green before any behavior changes. Slice 2 is the actual fix (worker detection) and depends only on the column existing. Slice 3 is the read-only display, depending on the model field. Slice 4 is doc-sync, depending on nothing but landing in the same PR.

---

## Slice 1 — Schema: `lost_executions` column + model field + migration

Adds the column to the Drizzle table and the Zod model together, generates the migration, and absorbs the compile churn from a new required `Job` field.

**Files**

- Edit: `apps/api/src/db/schema/jobs.table.ts` — add `lostExecutions: integer("lost_executions").notNull().default(0)` after `attempts`.
- Edit: `packages/core/src/models/job.model.ts` — add `lostExecutions: z.number()` to `JobSchema` after `attempts`.
- New: `apps/api/drizzle/0083_*.sql` — generated migration (`ALTER TABLE "jobs" ADD COLUMN "lost_executions" integer DEFAULT 0 NOT NULL;`).
- Edit: `packages/core/src/__tests__/models/job.model.test.ts` — add `lostExecutions: 0` to existing job fixture(s); new required-field cases.
- Edit: any other `Job`-typed object literal the compiler flags (fixtures in `apps/api`/`apps/web` — `JobDetailView.test.tsx` at minimum) — add `lostExecutions: 0`. Insert-side fixtures are unaffected (`JobInsert.lostExecutions` is optional via the DB default).

**Steps**

1. **Tests (spec: `job.model.test.ts` cases).** In `job.model.test.ts`: a valid job object including `lostExecutions` parses; `safeParse` **fails** when `lostExecutions` is omitted. Run; fail.
2. **Implement**: add the table column and the `JobSchema` field. Generate the migration: `cd apps/api && npm run db:generate -- --name add-jobs-lost-executions`. Add `lostExecutions: 0` to every `Job`-typed fixture the type-check flags. Green.
3. Lint + type-check across the monorepo (`npm run type-check` proves the `type-checks.ts` guards agree table ↔ model).

**Done when:** `job.model.test.ts` passes, `type-check` + `build` are green (the dual-schema guards satisfied), the migration file exists. No behavior change yet — nothing writes the column.

**Risk:** the required-field churn must reach *every* `Job` literal or `type-check` fails — that's the point (the guard finds them). Don't add a Zod `.default(0)` to dodge it; `attempts` sets the precedent of no Zod default.

---

## Slice 2 — Worker detects a resumed-`active` row and increments

The fix itself: the pre-read at the processor top, the conditional increment carried into the `active` transition, and the `transition` patch whitelist.

**Files**

- Edit: `apps/api/src/services/job-events.service.ts` — add `lostExecutions: number` to the `transition` patch `Partial<{…}>` whitelist.
- Edit: `apps/api/src/queues/jobs.worker.ts` — pre-read via `getDbService()` before the opening `active` transition; if `prior?.status === "active"`, spread `{ lostExecutions: prior.lostExecutions + 1 }` into the patch; wrap the read fail-open.
- Edit: `apps/api/src/__tests__/queues/jobs.worker.retry.test.ts` — new `describe("lost-execution recording (#464)")`.

**Steps**

1. **Tests (spec: worker cases 1–5).** In the retry suite, using the existing `mockFindById` / `openingCall()` helpers:
   - `active` + `lostExecutions: 0` → opening patch `lostExecutions: 1`.
   - `active` + `lostExecutions: 2` → opening patch `lostExecutions: 3`.
   - `pending` → opening patch has **no** `lostExecutions` key.
   - `mockFindById` → `undefined` → no key.
   - `mockFindById` rejects → processor completes, opening `active` still fires, no key, no throw.
   Run; fail.
2. **Implement** the whitelist addition and the worker pre-read/increment. Green.
3. Lint + type-check.

**Done when:** all 5 worker cases pass; existing #441 retry cases still pass (the pre-read is additive — a `pending`/missing row leaves the opening transition exactly as before).

**Risk:** the pre-read now calls `findById` on the happy path of *every* job execution; the existing tests' `mockFindById` returns `undefined` by default, which the guard (`prior?.status === "active"`) handles — confirm no existing case asserted `findById` was *never* called.

---

## Slice 3 — `JobDetail` shows the count when nonzero

Read-only display; reads `job.lostExecutions` straight off the fetched job (not the live stream).

**Files**

- Edit: `apps/web/src/views/JobDetail.view.tsx` — append a conditional `Lost executions` item to the `MetadataList` items array after `Attempts`.
- Edit: `apps/web/src/__tests__/JobDetailView.test.tsx` — display cases.

**Steps**

1. **Tests (spec: view cases).** Renders `Lost executions` with the value when `job.lostExecutions > 0`; does **not** render the row when `=== 0`. (Fixture already carries `lostExecutions` from Slice 1 — set it per case.) Run; fail.
2. **Implement** the conditional-spread item. Green.
3. Lint + type-check.

**Done when:** both view cases pass; the row is absent for the common zero case.

**Risk:** none — additive, read-only, off the fetched job.

---

## Slice 4 — Doc-sync

Bring the developer-facing docs in line with the landed fix (per `CLAUDE.md` → "Keeping Documentation in Sync").

**Files**

- Edit: `CLAUDE.md` — the "Async Job State & Data Locking" paragraph: drop the "until #464 lands" hedge and state that a resumed-`active` row now records `lostExecutions`.
- Edit: `.github/copilot-instructions.md` — the mirror of that paragraph.

**Steps**

1. No test (doc-only). Update both surfaces to describe the shipped behavior.
2. Lint (markdown is unformatted by policy; no type-check impact).

**Done when:** neither doc claims the gap is unfixed; both describe start-time detection + the `lostExecutions` field.

**Risk:** none.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | column + model field + migration + fixture churn | `job.model.test.ts` green; `type-check`/`build` green |
| 2 | worker pre-read/increment + `transition` whitelist | 5 worker cases green; #441 cases still green |
| 3 | `JobDetail` nonzero-only display | 2 view cases green |
| 4 | CLAUDE.md + copilot mirror doc-sync | docs match behavior |

## Cross-slice notes

- **Migration ordering.** Slice 1 generates `0083_*` from the schema edit; the edit must precede `db:generate`. Unit tests mock the DB and don't need it applied; CI integration applies it via `db:migrate:ci`.
- **The required-field churn is a Slice-1 obligation.** A new required `Job` field breaks compilation everywhere a `Job` literal omits it; Slice 1 is not done until `type-check` is green repo-wide, even though the behavior tests land later.
- **No SSE change.** `JobUpdateEvent` is deliberately untouched (spec Out of scope); the view reads `lostExecutions` off the fetched job, refreshed by the `.root` invalidation on completion.
- **Doc-sync is in-PR, not a follow-up** (Slice 4) — stale docs are a bug in this PR.

## Next step

After discovery + spec + plan are reviewed and confirmed, implementation begins on `fix/lost-execution-recording`, Slice 1 first, tests-first, one commit per slice.
