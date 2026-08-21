# app-dev API task sizing — Condensed design (#424)

**Issue:** [EnterpriseBT/portal-ai#424](https://github.com/EnterpriseBT/portal-ai/issues/424) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `portalai-dev-backend` runs at `Cpu=256` / `Memory=512` — the original April-2026 defaults — while `backend.yml` has said `1024`/`8192` since `777218c9`. Both bumps were no-ops for app-dev because **no backend deploy passes `Cpu` or `Memory`**, and `aws cloudformation deploy` reuses whatever the stack was created with. Meanwhile `--max-old-space-size=7000` is hardcoded in the template *body*, so it deployed immediately: V8 is authorised to grow ~14× past the cgroup, guaranteeing SIGKILL (`exit 137`, a bare 502) instead of a catchable heap error. Infrastructure only — `backend.yml`, both deploy workflows, one guard test.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `Cpu` / `Memory` parameters | `infra/cloudformation/backend.yml:30-38` | Defaults `1024`/`8192`; `Description` explains the 8 GB reasoning as though in force |
| V8 heap flag | `backend.yml:490-494` | `--max-old-space-size=7000` — a literal in the body, not a parameter, so it cannot drift *and* cannot adapt |
| Dev backend create | `.github/workflows/deploy-dev.yml:160-179` | 15 parameters passed; **no `Cpu`, no `Memory`** |
| Dev backend update | `deploy-dev.yml:406-411` | `BuildVersion` + `BuildSha` only |
| Prod backend create | `deploy-prod.yml:205-227` | **also no `Cpu`/`Memory`** |
| Prod backend update | `deploy-prod.yml:492-501` | States `DesiredCount=2` explicitly |
| Deliberate inheritance | `deploy-prod.yml:189-201` | The `scale` step omits `DesiredCount` on purpose — "no scale-down, no outage" |
| "State it explicitly" precedent | `packages/devops-cli/src/__tests__/deploy-parity.test.ts:263` | `MultiAZ`: *"an omission silently reads as a deliberate choice"* — prod-only today |

Live, confirmed today: dev `256`/`512`/`1`, prod `1024`/`8192`/`2`.

**Prod is correct by timing, not by statement.** Its stack was created fresh once the defaults were already `1024`/`8192`, so it picked them up. Nothing in prod's workflow asserts that sizing — the same latent bug, one recreation away from biting.

## Decision 1 — app-dev runs 512 / 4096, as a recorded cost choice

Not prod parity. `0.5` vCPU + 4 GB is ~$28/mo against prod-parity's ~$55/mo and today's ~$9/mo (Fargate us-east-1, `DesiredCount: 1`). It is a valid Fargate combo (0.5 vCPU permits 1–4 GB) and it ends the `exit 137` class of outage, which is what #423 surfaced.

The trade-off is accepted and must stay written down: **app-dev memory and latency results do not transfer to prod.** A smoke walk that passes at 4 GB / 0.5 vCPU says nothing definitive about 8 GB / 1 vCPU, in either direction. What this fixes is a sizing nobody chose; it does not make app-dev a load-testing surrogate.

## Decision 2 — the heap ceiling comes from a Mapping, not a literal or arithmetic

CloudFormation has **no arithmetic intrinsic**, so "~85% of `Memory`" cannot be computed in-template. A `Mappings` table keyed by `Memory` with `!FindInMap` is better than arithmetic anyway: `!FindInMap` **fails the deploy** on an unmapped `Memory`, so a sizing whose heap nobody considered cannot ship. `AllowedValues` on `Memory` is pinned to the same key set, so the two cannot disagree and the error arrives as parameter validation rather than a resource failure.

At ~85%: `512→435`, `1024→870`, `2048→1740`, `3072→2611`, `4096→3481`, `8192→6963`. Prod's effective heap therefore moves `7000 → 6963` — a 0.5% reduction, strictly further below its ceiling, and it converts a magic number into a derived one.

## Decision 3 — the guard requires `Cpu` and `Memory`, not "every parameter"

Extend `deploy-parity.test.ts` so **every** workflow deploying `backend.yml` states both — dev and prod, closing prod's latent case too. Scoped deliberately:

- **Not "all parameters stated."** `DesiredCount` and `ImageTag` inheritance is *intentional* on the prod create path; a blanket rule would forbid a decision the repo made on purpose.
- **"At least one invocation," not every one** — mirroring the existing `CertificateArn` guard (`:181-192`): `deploy` reuses recorded values, so only the create path must carry it.

## Plan — one slice

**Files**
- Edit `infra/cloudformation/backend.yml` — add `Mappings.NodeHeapByMemory`; `AllowedValues` on `Memory` matching its keys; replace the literal `7000` with `!FindInMap [NodeHeapByMemory, !Ref Memory, HeapMb]`; correct both parameter `Description`s so they describe per-environment sizing rather than asserting 8 GB.
- Edit `.github/workflows/deploy-dev.yml` — add `Cpu=512 Memory=4096` to the create invocation, with a comment recording it as a cost choice.
- Edit `.github/workflows/deploy-prod.yml` — add `Cpu=1024 Memory=8192` to the create invocation, stating what it already runs.

**Tests** — `packages/devops-cli/src/__tests__/deploy-parity.test.ts`: every workflow deploying `backend.yml` states `Cpu=` and `Memory=` at least once; the heap flag is a `!FindInMap`, never a bare integer; every `AllowedValues` entry for `Memory` has a `NodeHeapByMemory` key, and each mapped heap is **below** its container size (the invariant the bug violated).

Then `npm run test:unit`, `npm run lint`, `npm run format:check`.

**No manual stack surgery.** Once the workflow states the parameters, the next `Deploy Dev` applies them — the ticket's "correct the live stack" step happens by merging, not by a hand-run `aws cloudformation deploy`.

## Smoke (manual, against app-dev)

1. Merge → `Deploy Dev` green.
2. `aws cloudformation describe-stacks --stack-name portalai-dev-backend` → `Cpu=512`, `Memory=4096`.
3. `aws ecs describe-task-definition --task-definition portalai-api-dev` → `cpu: "512"`, `memory: "4096"`, and `NODE_OPTIONS=--max-old-space-size=3481`.
4. The service reaches steady state with the new revision; `https://api-dev.portalsai.io/api/health` returns 200.
5. `MemoryUtilization` for the service drops from ~38% (of 512 MB) to roughly 5% (of 4096 MB) at idle.
6. Re-run the #423 repro — a large connector-instance delete — and confirm no `exit 137` and no 502.
7. Deploy a no-op change twice; the sizing stays `512`/`4096` rather than reverting to inherited values.

## Out of scope

- The unbounded `RETURNING *` in the delete cascade — that is #423's fix, already merged; sizing only changes the volume at which it hurts.
- Prod sizing and `DesiredCount` — prod is correct; this only makes it *stated*.
- Autoscaling policies, and making the parse path streaming (`docs/LARGE_FILE_PARSE_STREAMING.plan.md`).
- Sizing for the worker/queue tasks, if they diverge later.
