# Remove the legacy Redis cache and cutover params — Condensed design (#872)

**Issue:** [EnterpriseBT/portal-ai#872](https://github.com/EnterpriseBT/portal-ai/issues/872) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** #852 moved both environments to the encrypted group `portalai-<env>-tls` (app-dev 2026-10-23, prod 2026-10-24). The templates still carry the cutover: `cache.yml` keeps the plaintext group behind `RedisCutoverPhase`, and `backend.yml` picks `redis://` or `rediss://` by `RedisEndpointSource`. Prod's plaintext `portalai-prod` still exists, because the CLI guard refuses destructive ops on prod. #871's review found that its file evidence can't tell whether a default still routes to plaintext. This change makes encrypted the only shape. It touches `infra/`, `.github/`, `packages/devops-cli` and one site test.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Phase param + conditions | `infra/cloudformation/cache.yml:53-67` | `HasLegacy`/`HasEncrypted`/`LegacySingle`/`LegacyReplicated` |
| Legacy resources + exports | `cache.yml:102-139`, `173-189` | `RedisCluster`, `RedisReplicationGroup`, `RedisEndpoint`/`RedisPort` |
| Encrypted group + TLS exports | `cache.yml:145-171`, `191-201` | conditional on `HasEncrypted` |
| Endpoint switch | `backend.yml:52-60`, `149`, `617-630` | `RedisEndpointSource`, `UseEncryptedRedis`, `REDIS_URL` `!If` |
| Mid-cutover task count | `deploy-prod.yml:604-620` | keeps the count while phase is `both` |
| CLI | `packages/devops-cli/src/commands/cache.ts`, `templates.ts`, `bin.ts:330-395` | `cache status/phase/switch/refresh-template` |
| Template guards | `src/__tests__/cache-encryption.test.ts`, `cache.test.ts`, `bin.test.ts` | pin the phases |
| Claim evidence | `apps/site/src/lib/security-controls.ts` | `contains` only |
| Runbook | `docs/REDIS_ENCRYPTION_CUTOVER.runbook.md` | pointed to by `AWS_CLI_OPS.md:71`, `jobs.ts:9`, `cache.yml`, `deploy-prod.yml` |

## Decision 1 — one release, cache stack first, with no extra ordering step

Both backends already import the TLS exports. CloudFormation treats an `ImportValue` in the untaken branch of an `!If` as unused, which is how app-dev's legacy exports were removed on 2026-10-24 while `backend.yml` still named them. So the deploy's existing order works: the cache stack deletes `RedisReplicationGroup` and its exports, then the backend stack drops the `!If`. If a backend were still on legacy, its import would be live, and CloudFormation would refuse to remove the export and roll back the cache update. That fails safely, so no preflight step is needed.

**On prod this deletes `portalai-prod` in the release's Deploy Prod run.** That's the cleanup #852 deferred to here. It holds only finished-job queue entries and nothing connects to it. On app-dev the cache stack has no resource change (its legacy cache is already gone), so `aws cloudformation deploy` skips it, and the stack keeps its old template with `RedisCutoverPhase=encrypted`. That leaves the same resources, and the stack picks up the new template at its next resource change. The backend deploys on both envs land, because the image tag changes.

## Decision 2 — retire the cutover commands, keep the generic ones

- **Remove** `cache phase`, `cache switch` and `cache refresh-template` (with `templates.ts` and `CacheCutoverConflictError`). They act only on the removed parameters. `refresh-template` can't land a template-only change either (it refuses one), so it has no remaining use.
- **Keep** `cache status`, minus `phase`/`endpointSource`. It still describes both the legacy and the `-tls` IDs, so it shows a leftover plaintext cache. #871's claim comment points at it.
- **Keep** `service scale` and `jobs redispatch`. They're generic: `cache.yml`'s #383 note sends a planned node replacement through `redispatch`.
- **Delete** `REDIS_ENCRYPTION_CUTOVER.runbook.md`. Rolling back to plaintext is no longer possible by design, and git keeps the record. Fix its four pointers.

## Decision 3 — the evidence asserts that plaintext is gone

`Evidence` becomes `{ path, contains } | { path, lacks }`. The at-rest and in-transit claims gain `lacks` entries: `cache.yml` has no `AWS::ElastiCache::CacheCluster` (it can't encrypt at rest), and `backend.yml` has no `"redis://`. `cache-encryption.test.ts` is rewritten to check the structure. Every ElastiCache resource in `cache.yml` must be an unconditioned ReplicationGroup with at-rest and transit encryption on and mode `required`. The `REDIS_URL` must be an unconditional `rediss://` built from the TLS exports.

## Plan — 2 slices

1. **Templates + workflow + guards.** Edit `cache.yml`, `backend.yml` and `deploy-prod.yml` (drop the decide step; the backend deploy always passes `DesiredCount=2`). Rewrite `cache-encryption.test.ts` and update `deploy-parity.test.ts` if it pins the step. Add the site `lacks` evidence and its test case. Tests: `cd packages/devops-cli && npm run test:unit`, `cd apps/site && npm run test:unit`.
2. **CLI + docs.** Edit `cache.ts`, `bin.ts`, `cache.test.ts` and `bin.test.ts`; delete `templates.ts`. Update `COMMANDS.md`, `CLAUDE.md` + `.github/copilot-instructions.md` (devops-cli row, exit-code note), `AWS_CLI_OPS.md:71` and `jobs.ts:9`; delete the runbook. Tests: devops-cli `test:unit`, `lint`, `type-check`; root `lint:doc-pointers`.

## Smoke (manual, against the deployed envs)

1. After merge, Deploy Dev is green. `npx portalops cache status --env app-dev` lists only `portalai-dev-tls` (at-rest true, transit true, `required`) and service 1/1. `curl https://api-dev.portalsai.io/api/health/ready` returns `{"db":true,"redis":true}`.
2. app-dev: start an import or sync in the app and confirm it reaches `completed`.
3. After the next prod release: Deploy Prod's cache step shows `portalai-prod` deleted (`DELETE_COMPLETE` in the stack events). `cache status --env prod --confirm-prod` lists only `portalai-prod-tls`, service 2/2, ready 200 with redis true, and no `Redis connection error` in the API logs.
4. Prod: a new job runs end to end. This is also #852's open verify item.

## Out of scope

- Multi-AZ/DR or KMS changes to the encrypted group. `Redis` and `multi-AZ` stay in `FORBIDDEN_CLAIMS`.
- Forcing app-dev's cache stack onto the new template (no resource change; harmless drift, Decision 1).
- `AUTH0_WEBHOOK_SECRET` (#873).
