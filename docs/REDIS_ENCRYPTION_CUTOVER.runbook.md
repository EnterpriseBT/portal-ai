# Redis encryption cutover — Runbook

**Issue:** [EnterpriseBT/portal-ai#852](https://github.com/EnterpriseBT/portal-ai/issues/852) (epic [#578](https://github.com/EnterpriseBT/portal-ai/issues/578))

How an environment moves from the plaintext ElastiCache Redis to the one encrypted at rest and in transit, without losing a job. Run it once per environment: app-dev first, then prod after the release that carries #852.

**Why it's a cutover and not a flag.** ElastiCache can't turn on encryption at rest for an existing cache, and dev's cache type (`CacheCluster`) has no such setting at all. So `infra/cloudformation/cache.yml` builds a second, encrypted replication group (`portalai-<env>-tls`) beside the old one, and the API moves to it during a short maintenance window. The cluster runs `TransitEncryptionMode: required`, so it refuses plaintext: the API reaches it over `rediss://`.

**What makes it lossless.** Postgres `jobs` is the record of truth; Redis only holds the queue. After the switch, `portalops jobs redispatch` puts every live job row back on the new queue under its own id. It must run **before** the API starts against the new Redis: at boot the API's stranded-job sweep (#391) would reap queued rows whose heartbeat is older than 15 minutes as `failed`.

Every command below is `portalops` (`packages/devops-cli/COMMANDS.md` → cache, service, jobs). The examples use app-dev; for prod add `--confirm-prod` to each command and use `--env prod`.

---

## Preconditions

- [ ] The release carrying #852 is deployed to the environment. app-dev deploys on every push to `main` (or `gh workflow run deploy-dev.yml --ref <branch>`); prod deploys on a published release.
- [ ] `portalops cache status --env app-dev` shows `phase: legacy`, `endpointSource: legacy`, and the legacy cache `available`.
- [ ] Your shell has AWS credentials for the environment, and a rebuilt CLI (`npm run build --workspace @portalai/devops-cli`, since `npx portalops` runs `dist/`).
- [ ] **No deploy runs during the window.** A deploy keeps the cutover parameters, and prod's release leaves the task count alone while the cache phase is `both`, but a deploy mid-window still rolls the service and muddies the walk. Hold merges to `main` (app-dev) or don't publish a release (prod) until Verify passes.
- [ ] Note the service's current desired count (`cache status` → `service.desired`; app-dev runs 1, prod 2). You restore it at the end.

## 1. Provision (no downtime)

```bash
portalops cache phase both --env app-dev --yes
portalops cache status --env app-dev --json
```

`phase both` creates `portalai-<env>-tls` and waits for the stack (10–20 minutes). The first time, it prints a notice that it's applying the repo's `infra/cloudformation/cache.yml`. The deploy never applies #852's cache template, because that template changes no resource at the `legacy` default (#861). So run it from an up-to-date `main` checkout. Continue when `cache status` shows it `available` with `atRestEncryption: true`, `transitEncryption: true`, `transitEncryptionMode: "required"`. The API still uses the legacy cache, so nothing user-visible has changed. This step is also the first real test of the template against AWS: if the stack update fails, it rolls back on its own and the environment is untouched.

## 2. The maintenance window

Users see the API go down here; budget about 15 minutes.

1. **Drain.** `portalops jobs status --env app-dev`, repeated, until `byStatus` has no `active` count. Queued (`pending`) rows are fine: re-dispatch carries them over. Pick a quiet moment, since a long import or sync keeps a row `active` until it finishes.
2. **Stop the service.** `portalops service scale 0 --env app-dev --yes`. It refuses while any job is `active`. `--allow-active` overrides that, and those jobs then re-run from the start through re-dispatch: safe for every job type, but a `bulk_transform` whose source is also its target can apply its expression twice, so prefer waiting.
3. **Switch.** `portalops cache switch encrypted --env app-dev --yes`. It points `REDIS_URL` at `rediss://<tls endpoint>` and holds the service at 0.
4. **Re-dispatch.** `portalops jobs redispatch --env app-dev --yes --json`. It runs as an ECS one-off on the new task definition, so it talks to the new Redis. Its `summary` lists every row it re-queued under `redispatched`, and `priorStatus: "active"` marks one the scale-down interrupted. The summary is read back from the task's CloudWatch stream; if that read fails it's `null`, and the stream named in `log` holds it. A re-queued row keeps what is left of its retry budget. Re-running is safe: a row already queued is skipped.
5. **Start the service.** `portalops service scale <prior count> --env app-dev --yes`.

## 3. Verify

- [ ] `portalops cache status --env app-dev`: `endpointSource: encrypted`, `service.running` equals the restored count.
- [ ] The API's boot log shows `Redis connected` with `tls: true` (CloudWatch, `/ecs/portalai-api-<env>`).
- [ ] `GET /api/health/ready` returns 200.
- [ ] The re-dispatched rows reach a terminal status: `portalops jobs status` drains, and none of them ended `failed` with the stranded-job error.
- [ ] A new job runs end to end. Trigger a connector sync, or any job, from the app.
- [ ] The cluster refuses plaintext. From the bastion (`aws ssm start-session --target <bastion instance id>`; install the client with `sudo dnf install -y redis6` if needed), run both:
  ```bash
  redis6-cli -h <tls endpoint> -p 6379 PING          # fails: connection closed / I/O error
  redis6-cli -h <tls endpoint> -p 6379 --tls PING    # PONG
  ```
- [ ] `aws elasticache describe-replication-groups --replication-group-id portalai-<env>-tls --query 'ReplicationGroups[0].[AtRestEncryptionEnabled,TransitEncryptionEnabled,TransitEncryptionMode]'` returns `[true, true, "required"]`.

**What starts cold, by design:**
- the workbook cache, so an upload preview open during the window has to be re-uploaded;
- the rate-limit windows;
- SSE subscriptions, which reconnect on their own.

None of it is durable state.

## Rollback (until Retire)

The legacy cache stays up until step 4, so any failure in Verify is recoverable with the same window in reverse:

```bash
portalops service scale 0 --env app-dev --yes --allow-active
portalops cache switch legacy --env app-dev --yes
portalops jobs redispatch --env app-dev --yes
portalops service scale <prior count> --env app-dev --yes
```

Re-dispatch carries over the rows queued on the encrypted cache too. Entries for jobs that finished on the encrypted cache are still sitting in the legacy queue; the worker skips any entry whose row is already terminal, so they don't run again. A failed `cache phase both` needs no rollback: CloudFormation reverts the stack itself.

## 4. Retire the legacy cache

Only after Verify has passed and the environment has run cleanly for a day.

- **app-dev:** `portalops cache phase encrypted --env app-dev --yes`. It is destructive (it deletes the plaintext cache) and refuses unless the backend already uses the encrypted one.
- **prod:** the guard refuses destructive operations on prod, so prod's legacy cache goes with the **cleanup release**. That follow-up PR removes the legacy resources and both phase parameters from the templates, once every environment reads `encrypted`.

After both environments are retired, open #858, which widens the public `/security/` encryption claims to name the cache.

## Notes

- **The endpoint changes.** The TLS cluster has its own endpoint. Anything outside the stacks that names the old one (operator notes, `docs/AWS_CLI_OPS.md`) is updated in the same pass.
- **Snapshots.** Prod's encrypted group keeps `SnapshotRetentionLimit=7`. The legacy group's snapshots are deleted with it, which is fine: after the drain it held nothing durable.
- **Residency installs** don't use this runbook. The Helm chart takes a `rediss://` `redis.external.url` directly, plus `redis.external.tls.caSecret` for a private CA (`deploy/helm/portalai/README.md`).
