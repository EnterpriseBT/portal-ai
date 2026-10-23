# elasticache-encryption — Smoke Suite

Manual smoke test for [#852](https://github.com/EnterpriseBT/portal-ai/issues/852): ElastiCache encryption at rest and in transit, the TLS client seam, lossless job re-dispatch, and the `portalops` cutover commands. **Branch under test:** `feat/852-elasticache-encryption` (PR [#859](https://github.com/EnterpriseBT/portal-ai/pull/859)).

This ticket has almost no browser surface: its acceptance criteria hold in AWS, the API process and the CLI. Steps tagged `— backend` are CLI/AWS/log probes, which an agent can run from the devcontainer with the operator's AWS session. Steps tagged `— manual` need a human: judging the app's behavior, the bastion session, the Helm cluster. **§3–§5 take the app-dev API down for about 15 minutes.** Run them when nobody else is using app-dev, and hold merges to `main` for the duration (a `main` push redeploys app-dev mid-window).

## Preflight

### Environment

- [ ] `git checkout feat/852-elasticache-encryption && git pull --ff-only`
- [ ] `npm install && npm run build --workspace @portalai/devops-cli` (`npx portalops` runs `dist/`). No migration.
- [ ] AWS session for app-dev in this shell: `aws sts get-caller-identity` answers. (In the devcontainer: `aws login --remote`, then `eval "$(aws configure export-credentials --format env)"`.) — backend
- [ ] `npm run dev` boots cleanly for the local sections (API :3001); its log shows `Redis connected` with `tls: false`. — backend

### Fixtures

- [ ] An app-dev org you can log into, with at least one connector you can sync (the seeded demo connector is enough).

### Reset between runs

- [ ] §1–§2 are read-only or local. §3–§6 change app-dev for real; re-running them needs §7's Rollback, or a fresh environment. Retire (§6) is one-way.

## §1 — Merging changes nothing (inert deploy)

- [ ] Deploy the branch to app-dev: `gh workflow run deploy-dev.yml --ref feat/852-elasticache-encryption`, and wait for it to go green. — backend
- [ ] `npx portalops cache status --env app-dev --json` → `"phase":"legacy"`, `"endpointSource":"legacy"`, one cache `portalai-dev` (`cache-cluster`, `atRestEncryption:false`), `service.running` = 1. — backend
- [ ] The API's new boot log line (CloudWatch `/ecs/portalai-api-dev`) reads `Redis connected` with `tls: false, customCa: false`, and contains no Redis URL or host. — backend
- [ ] The app works as before: log in, open a connector, trigger a sync; it reaches completed. — manual

## §2 — Local: job commands and the npm fix

- [ ] `npx portalops jobs status --env local --json` → `{"counts":[…],"byStatus":{…},"total":n}`. — backend
- [ ] `npx portalops jobs redispatch --env local --dry-run --json` → `{"via":"local","script":"jobs:redispatch"}`. The API's script output line shows `"dryRun":true`. — backend
- [ ] `npx portalops db upgrade --env app-dev --yes --json` → `{"via":"ecs",…,"exitCode":0}`. It ran `node dist/scripts/db-upgrade.js`, which the npm-less image could not run before (no-op when nothing is pending). — backend
- [ ] `npx portalops cache switch encrypted --env app-dev --yes` while phase is `legacy` exits **9** with `CACHE_CUTOVER_CONFLICT` ("Both caches must exist…"), and nothing changes. — backend

## §3 — Provision the encrypted cache (no downtime)

- [ ] `npx portalops cache phase both --env app-dev --yes --json` → `{"phase":"both","changed":true}` after 10–20 min. — backend
- [ ] `aws elasticache describe-replication-groups --replication-group-id portalai-dev-tls --query 'ReplicationGroups[0].[Status,AtRestEncryptionEnabled,TransitEncryptionEnabled,TransitEncryptionMode]'` → `["available", true, true, "required"]`. **(Acceptance: the encryption flags.)** — backend
- [ ] `cache status` still shows `endpointSource: legacy`, and the app still works (no downtime yet). — backend
- [ ] **A routine deploy keeps the phase:** re-run `gh workflow run deploy-dev.yml --ref feat/852-elasticache-encryption`; afterwards `cache status` still reads `phase: both`. — backend

## §4 — The window: drain, switch, re-dispatch

- [ ] Seed a queued job that must survive: in the app, trigger a sync, then `npx portalops jobs status --env app-dev` until it shows `pending` or `active`. Note the job id from the Jobs page. — manual
- [ ] `npx portalops service scale 0 --env app-dev --yes` **while that job is active** → exit **5**, naming the running job(s), and the service stays up. — backend
- [ ] Wait until `jobs status` shows no `active`. Queue one more job (trigger another sync) so a `pending` row crosses the window. `service scale 0 --env app-dev --yes` → `{"desired":0}`; `cache status` → `service.running: 0`. — backend
- [ ] `npx portalops cache switch encrypted --env app-dev --yes --json` → `{"endpointSource":"encrypted","changed":true}`, and `service.desired` stays 0. — backend
- [ ] `npx portalops jobs redispatch --env app-dev --yes --json` → `exitCode: 0`. The task's last CloudWatch line lists the queued job's id under `redispatched` with `priorStatus: "pending"`. — backend
- [ ] Run it again: the second summary has an empty `redispatched` and `present ≥ 1` (idempotent). — backend
- [ ] `npx portalops service scale 1 --env app-dev --yes` → `{"desired":1}`. — backend

## §5 — Verify on TLS

- [ ] Boot log: `Redis connected` with `tls: true`. **(Acceptance: the API boots with TLS.)** — backend
- [ ] `curl -s -o /dev/null -w '%{http_code}' https://api-dev.portalsai.io/api/health/ready` → `200`. — backend
- [ ] The job queued across the window reaches `completed` (Jobs page), never `failed` with the stranded-job error. `jobs status` drains to no `pending`/`active`. **(Acceptance: no job lost.)** — manual
- [ ] A new sync started after the window runs to completed. Live progress updates arrive, which proves SSE pub/sub over TLS. — manual
- [ ] **Plaintext is refused:** from the bastion (`aws ssm start-session --target <bastion id>`; `sudo dnf install -y redis6` if needed), `redis6-cli -h <tls endpoint> -p 6379 PING` fails (connection closed / I/O error), while `redis6-cli -h <tls endpoint> -p 6379 --tls PING` → `PONG`. **(Acceptance: plaintext refused.)** — manual
- [ ] A routine deploy (`gh workflow run deploy-dev.yml --ref feat/852-elasticache-encryption`) keeps `endpointSource: encrypted`, and the API stays on `tls: true`. — backend

## §6 — Retire the legacy cache (one-way)

- [ ] `npx portalops cache phase legacy --env app-dev --yes` → exit **9** (the backend uses the encrypted cache). — backend
- [ ] `npx portalops cache phase encrypted --env prod --yes --confirm-prod` → exit **6** (destructive is refused on prod) before any AWS write. — backend
- [ ] `npx portalops cache phase encrypted --env app-dev --yes --json` → `{"phase":"encrypted","changed":true}`. `cache status` then lists only `portalai-dev-tls`, and the app still works. — backend

## §7 — Rollback rehearsal (optional, before §6)

- [ ] With phase `both` and the API on TLS, run the runbook's Rollback: `service scale 0 --allow-active`, `cache switch legacy`, `jobs redispatch`, `service scale 1`. The boot log shows `tls: false` and readiness returns 200. Then repeat §4 to return to TLS. — backend

## §8 — Helm CA knob (residency)

- [ ] `npm run lint:helm` passes, including `external rediss:// + private CA (#852)`. — backend
- [ ] On a real cluster with an external TLS Redis signed by a private CA, `--set redis.external.url=rediss://… --set redis.external.tls.caSecret.name=<secret>`: the API pod's readiness goes green and its log shows `tls: true, customCa: true`. — manual (no customer cluster locally; deferrable to the residency epic smoke)

## §9 — Public claims unchanged

- [ ] `apps/site/src/lib/security-controls.ts` is untouched by this branch (`git diff main...HEAD --stat -- apps/site` is empty), and `Redis` is still in `FORBIDDEN_CLAIMS`. #858 widens the claims after prod. — backend

## Sign-off

- [ ] Every section above verified, or deferred with a recorded reason
- [ ] <date + name>: confirmed against app-dev

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (env, job ids, stack event ids, CloudWatch task id):
