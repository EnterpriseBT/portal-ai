# Remove the dead UUIDv5 / NAMESPACE surface — Condensed design (#396)

**Issue:** [EnterpriseBT/portal-ai#396](https://github.com/EnterpriseBT/portal-ai/issues/396) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `SystemUtilities.id.v5` is an exported, documented API that throws `TypeError: Invalid UUID` on first use in every environment, because `UUIDv5Factory` requires a UUID-shaped namespace and `NAMESPACE` is `portalai-dev-namespace` in local/app-dev. It has **zero real callers** (only doc comments), so it has never fired — a disguised trap for anyone reaching for deterministic ids. We remove the unused capability rather than keep speculative infra without a caller. Touches `@portalai/core`, `@portalai/api`, `@portalai/devops-cli`, and `infra/` + the prod runbook.

**Correction to the issue body.** The issue claims `SYSTEM_ID` / `id.system` is "read by nothing." It is wrong — `SystemUtilities.id.system` is the system-actor id used across `webhook`, `billing`, `application`, `seed`, and `wide-table-reconciler` services (~15 sites). Its `"SYSTEM"` value never touches `v5` and never throws. **`SYSTEM_ID` and `id.system` are out of scope and stay untouched.** Only the `v5` / `NAMESPACE` surface is the bug.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The throwing factory | `packages/core/src/utils/id-factory.ts:47-75` | `UUIDv5Factory`; `generate()` calls `v5(input, namespace)` with no validation |
| API wiring | `apps/api/src/utils/system.util.ts:35-36,51` | `_v5Factory = new UUIDv5Factory(environment.NAMESPACE!)`, exposed as `id.v5`; doc example at `:16`, `:44` |
| Env read | `apps/api/src/environment.ts:5` | `NAMESPACE: process.env.NAMESPACE` (SYSTEM_ID at `:36` stays) |
| Env sample | `apps/api/.env.example:58-59` | `NAMESPACE=portalai-dev-namespace`, mislabeled "Used in uuidv5 for securing ids" |
| SSM catalog | `packages/devops-cli/src/catalog.ts:74` | `ssm("NAMESPACE", "namespace")` |
| ECS task env | `infra/cloudformation/backend.yml:611-612` | `NAMESPACE` valueFrom SSM (SYSTEM_ID at `:613-614` stays) |
| Prod runbook | `docs/PROD_PROVISIONING.runbook.md:30,262-271,388` §7 | provisions NAMESPACE as write-once; repeats the same wrong "id.system has no call sites" claim |
| Unit tests | `packages/core/src/__tests__/utils/id-factory.util.test.ts:42-64`, `apps/api/src/__tests__/utils/system.util.test.ts:46-80` | v5 describe blocks |
| Test env seeds | `apps/api/src/__tests__/setup.ts:16`, `__integration__/setup.ts:30`, `services/billing.service.endpoints.test.ts:59` | set `NAMESPACE` to a UUID — dead after removal |

`UUIDv5Factory` has no importers outside `system.util.ts` and the two test files (barrel re-exports via `export *`). No external contract change.

## Decision — delete the dead v5 surface (chosen)

Two directions existed: (1) keep v5, make `NAMESPACE` a real UUID everywhere + validate at construction; (2) delete the unused surface. **Chosen: (2).** `v5` has no caller, so option 1 keeps — and now boot-validates — a capability nothing uses, and would force an app-dev SSM change just to keep dead code alive. Removal is the smaller, honest diff and matches the standing "no speculative infra without a concrete caller" rule. `UUIDv4Factory`, `IDFactory`, `id.v4`, `SYSTEM_ID`, and `id.system` are all retained. If deterministic ids are ever genuinely needed, re-add `UUIDv5Factory` with a valid namespace and construction-time validation at that point.

## Plan — 2 slices

**Slice 1 — remove the capability from code.**
- **Files:** `packages/core/src/utils/id-factory.ts` (drop `UUIDv5Factory`, drop `v5` from the `uuid` import, keep `v4`); `apps/api/src/utils/system.util.ts` (drop the `UUIDv5Factory` import, `_v5Factory`, `v5:` from the `id` getter, and the `v5` lines from the class/example JSDoc at `:16`,`:44-45`); `apps/api/src/environment.ts` (drop `NAMESPACE`).
- **Tests:** `packages/core/src/__tests__/utils/id-factory.util.test.ts` (remove the `UUIDv5Factory` describe + `v5`/`UUIDv5Factory` imports + now-unused `TEST_NAMESPACE`); `apps/api/src/__tests__/utils/system.util.test.ts` (remove the `v5` describe block + `v5`/`UUIDv5Factory` imports + `ENV_NAMESPACE`). Run `npm run test:unit -- --testPathPattern "id-factory|system.util"` from each package.

**Slice 2 — remove the config / infra / catalog surfaces + docs.**
- **Files:** `apps/api/.env.example` (drop the NAMESPACE line + comment); `packages/devops-cli/src/catalog.ts` (drop the `NAMESPACE` ssm entry); `infra/cloudformation/backend.yml` (drop the `NAMESPACE` env block, keep SYSTEM_ID); `docs/PROD_PROVISIONING.runbook.md` §7 (remove NAMESPACE provisioning/readback/table row + the `Nothing here is reversible` mention at `:30`; correct the `id.system has no call sites` note — `id.system` IS the system actor, its `"SYSTEM"` sentinel is intentional and non-UUID); `apps/api/src/__tests__/setup.ts` + `__integration__/setup.ts` + `services/billing.service.endpoints.test.ts` (drop the now-dead `NAMESPACE` env seeds).
- **Tests:** `packages/devops-cli/src/__tests__/catalog.test.ts` (drop `"NAMESPACE"` from the expected key list) and `vars.test.ts` (swap the `NAMESPACE=plain` fixture for another still-valid ssm catalog key, e.g. `AUTH0_DOMAIN`). Run `npm run test:unit -- --testPathPattern "catalog|vars"` from `packages/devops-cli`.
- **Operator note (not code):** the `/portalai/<env>/namespace` SSM parameter becomes orphaned but harmless (nothing reads it); optional later cleanup via `portalops vars`, not required for merge.

## Smoke (manual, against your dev stack)

1. From `apps/api/`, `npm run type-check` and `npm run test:unit -- --testPathPattern "system.util"` → both green; `SystemUtilities.id.v4` and `id.system` still present, `id.v5` gone.
2. From repo root, `grep -rn "UUIDv5Factory\|id\.v5\|NAMESPACE" apps packages infra --include=*.ts --include=*.yml --include=*.example | grep -v node_modules | grep -v "/dist/" | grep -vi "sync.lock\|dissolve\|lock_namespace"` → no output (all v5/NAMESPACE surfaces removed; the unrelated `*_LOCK_NAMESPACE` advisory-lock constants remain).
3. From `packages/devops-cli/`, `npm run test:unit -- --testPathPattern "catalog|vars"` → green (catalog no longer lists NAMESPACE).
4. Boot the API against your local `.env` (with the NAMESPACE line removed) → starts clean; a system-actor write (e.g. trigger a seed/webhook path) still uses `id.system` = `"SYSTEM"`.
5. Read `docs/PROD_PROVISIONING.runbook.md` §7 → no longer instructs provisioning NAMESPACE; SYSTEM_ID guidance intact; the id.system claim is corrected.

## Out of scope

- **`SYSTEM_ID` / `id.system`** — in active use, not broken, untouched (issue's claim otherwise is corrected above).
- **Deleting the orphaned `/portalai/<env>/namespace` SSM parameter** — harmless once unreferenced; optional operator cleanup, no code dependency.
- **Any new deterministic-id capability** — re-introduce `UUIDv5Factory` with a valid namespace + boot validation when a real caller exists.
