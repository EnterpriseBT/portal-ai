# `portalai org delete` runs the full deletion — Condensed design (#1088)

**Issue:** [EnterpriseBT/portal-ai#1088](https://github.com/EnterpriseBT/portal-ai/issues/1088) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `portalai org delete` tombstones the `organizations` row and nothing else. The org's memberships stay live, so a member whose newest `last_login` is on that org resolves to *no* current org, and its records, `er__` tables, connectors and stations stay on disk for good. Owners deleting from Settings already get the full deletion (#197), and `demo delete` moved onto it in #1035. This ticket moves `org delete` onto the same path, and makes the current-org pick skip a deleted org, so users already stranded by an earlier operator delete recover too. Touches `apps/api` (one script, one service query), `packages/cli-env` (the ECS one-off helper moves in from devops-cli), `packages/admin-cli` and `packages/devops-cli`. Grown past the condensed sizing in code review (see the routing decision); kept as one doc.

## Current shape

| Piece | Location | Note |
|---|---|---|
| CLI command | `packages/admin-cli/src/commands/org.ts:143` (`orgDelete`) | destructive guard (refused on prod), then `store.softDeleteOrg` |
| Row-only tombstone | `packages/admin-cli/src/store.ts:328` (`softDeleteOrg`) | sets `deleted` on `organizations` only; its only caller is `orgDelete` |
| Full deletion (#197) | `apps/api/src/services/organization-delete.service.ts:69` | sweeps jobs (409 on an `active` one), cascade in one txn, S3 cleanup, Stripe cancel |
| Spawn precedent (#1035) | `packages/admin-cli/src/commands/demo.ts` (`demoDelete`) → `apps/api/src/db/demo-delete.ts` (`db:demo:delete`) | in-process marker check for the exit code, then `runApiScript`, `lastJsonLine`, audit |
| Current-org pick | `apps/api/src/services/application.service.ts:73` | newest live membership, then `findById` on its org; a deleted org → `null` |
| Membership list | `application.service.ts:107` (`listUserMemberships`) | already joins `organizations` with `deleted IS NULL` |
| ECS one-off | `packages/devops-cli/src/ecs.ts` (`runOneOffTask`), `commands/jobs.ts` (`readTaskLog`) | runs `node dist/...` in the env's API task; `portalops db seed`/`db upgrade`/`jobs redispatch` route AWS envs here, local to `runApiScript` |
| Spawn env | `packages/cli-env/src/spawn.ts` (`runApiScript`) | injects only `DATABASE_URL`, and on AWS envs `ENCRYPTION_KEY` + `SYSTEM_ID`; the rest comes from the operator's local `apps/api/.env` |
| Runbook | `packages/admin-cli/COMMANDS.md:64` | "Soft-delete only — hard deletion does not exist in this CLI" |

## Decision — spawn the full deletion through a new `db:org:delete` script

Options: (a) reuse `db:demo:delete` with a flag that skips the demo check; (b) a sibling `db:org:delete` script; (c) reimplement the cascade in the CLI store.

**Decision: (b).** (c) duplicates #197's cascade and can't reach S3/Stripe/job sweep. (a) puts the one safety property of `demo delete` (it can only remove a marked org, which is why it's allowed on prod) behind a flag. A sibling script keeps each spawn target's contract single-purpose; the shared parse/report shape is ~40 lines. `orgDelete` keeps its destructive guard (refused on prod), checks existence in-process via `store.getOrg` so a missing org keeps exit 8, then spawns `db:org:delete --org <id> --actor <operator>`. `store.softDeleteOrg` is removed (no other caller; no compat alias).

The script calls a new `ApplicationService.deleteOrganization(id, actor)`: a 404 for a missing/deleted org (the script can be run directly), then `OrganizationDeleteService.deleteOrganization`. A 409 from an `active` job surfaces as the script's stderr and a non-zero exit, as `demo delete` already does.

## Decision — AWS envs run the deletion in the env's own task (code review)

The deletion is more than SQL: it cancels queued jobs in BullMQ, deletes uploads from S3 and cancels the Stripe subscription. Spawned on the operator's machine, those reach the operator's local Redis, bucket and Stripe account, so `--env app-dev` left app-dev's queue, uploads and subscription untouched while reporting success. `demo delete` (#1035) has the same gap, prod included.

**Decision:** route by env shape, as `portalops db seed`/`db upgrade` do. On an env with `aws`, `org delete` and `demo delete` run `node dist/db/<org|demo>-delete.js --org <id> --actor <operator>` as an ECS one-off in the env's API task, which carries the env's own Redis, S3 and Stripe config; `--env local` keeps the spawn. The one-off helper (`runOneOffTask` → `runApiTask`, `apiServiceName`, `readTaskLog`) moves from devops-cli into cli-env so both CLIs share it, and devops-cli's seed/upgrade/redispatch wrappers call it. On a non-zero exit the helper reads the task's CloudWatch tail and puts the script's own (non-JSON) error lines in the error, so a refusal reaches the operator either way. Injecting the env's vendor config into a local spawn was rejected: app-dev's Redis is in the VPC and not reachable from the operator's machine.

The delete scripts print a refusal's running jobs (type, id, status), not just the 409's message, and share one parse/run/report harness instead of two copies.

## Decision — the current-org pick skips deleted orgs

`getCurrentOrganization` inner-joins `organizations` on `deleted IS NULL`, so the newest membership **in a live org** wins. Without it, every user stranded by an `org delete` run before this fix stays org-less (the new path tombstones memberships, the old one didn't). This also makes it agree with `listUserMemberships`, which already filters this way.

## Plan — 3 slices

**Slice 1 — current-org pick (api).**
- Edit: `apps/api/src/services/application.service.ts` — join + filter in `getCurrentOrganization`; one query instead of two.
- Tests: `apps/api/src/__tests__/__integration__/services/application.service.integration.test.ts` (`getCurrentOrganization`): a newer live membership in a tombstoned org falls back to the older live org; only-deleted orgs → `null`. `npm run test:integration` (filtered to the file).

**Slice 2 — `org delete` on the full deletion (api + admin-cli).**
- New: `apps/api/src/db/org-delete.ts` (`runOrgDelete`, same shape as `demo-delete.ts`); `apps/api/package.json` `db:org:delete`.
- Edit: `application.service.ts` — `deleteOrganization(id, actor)`.
- Edit: `packages/admin-cli/src/commands/org.ts` (`orgDelete` takes a `spawner`), `store.ts` (drop `softDeleteOrg`), `COMMANDS.md` (`org delete` row + spawned-scripts list).
- Tests: new `apps/api/src/__tests__/__integration__/scripts/org-delete.script.integration.test.ts` (populated org → content gone, org + memberships tombstoned; missing org → exit 1, nothing touched; bad args → usage); `packages/admin-cli/src/__tests__/commands.test.ts` (destructive guard, prod refused, missing org → 8 without spawning, spawn args, audit); drop `softDeleteOrg` cases from `store.test.ts`. `npm run test:unit` in admin-cli, `type-check`, `lint`.

**Slice 3 — ECS routing (cli-env + both CLIs + api).**
- New: `packages/cli-env/src/ecs-task.ts` (`runApiTask`, `apiServiceName`, `readTaskLog`, `TaskLogLocation`, `ApiTaskResult`); cli-env takes `@aws-sdk/client-ecs` + `client-cloudwatch-logs`. `apps/api/src/db/delete-script.util.ts` (shared harness).
- Edit: devops-cli `ecs.ts` (thin wrappers), `commands/jobs.ts`, `stacks.ts`; admin-cli `commands/org.ts`, `commands/demo.ts`; `org-delete.ts`, `demo-delete.ts`; `COMMANDS.md`.
- Tests: new `packages/cli-env/src/__tests__/ecs-task.test.ts` (the sequence, failure carries the log tail, no-aws env); devops-cli `ecs.test.ts` (wrappers pass their commands); admin-cli `commands.test.ts` (AWS env → task with the right command, local → spawn, refusal → no audit); script tests keep passing, plus a refusal that names the running job.

## Smoke (manual, against your dev stack)

1. As your dev user, own org A and join org B; switch to B in the app (B is current).
2. `npx portalai org delete <B> --env local --json` → `{ "id": "<B>", "deleted": true }`, exit 0.
3. Reload the app → you land in A; the org switcher no longer lists B.
4. In psql: B's `organization_users` rows have `deleted` set; B's connectors, entities and stations are gone; no `er__` tables remain for B's entities.
5. `npx portalai org delete <B> --env local` again → exit 8, "not found".
6. Start a long sync in an org, then `org delete` it while the job is `active` → exit 7, the message naming the running job; the org is untouched.
7. `npx portalai org delete <id> --env prod --yes --confirm-prod` → refused, exit 6.
8. app-dev, as the QA owner: create a throwaway org with a file upload, then `npx portalai org delete <id> --env app-dev --yes` → exit 0. In the ECS console a `portalai-api-<env>` one-off task ran `node dist/db/org-delete.js`; the upload's S3 object is gone from app-dev's bucket. — manual
9. `npx portalops db seed --env app-dev --yes` still runs its one-off task to exit 0 (the moved helper). — manual

## Out of scope

- Reclaiming data of orgs tombstoned by the old `org delete` before this fix: `org delete` refuses them as not found. Slice 1 un-strands their users; a one-off reclaim, if one is wanted, is its own ticket.
- Allowing `org delete` on prod: it stays destructive-blocked.
