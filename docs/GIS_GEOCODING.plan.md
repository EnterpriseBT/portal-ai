# GIS Geocoding (#315) — Plan

**Implements the geocoding child of the GIS epic TDD-first: the Mapbox provider + zero-unit address cache, the two `metered` geocode tools, the `expensive` `bulk_geocode` job (ack-gate → lock → bill-on-success), and the agent/doc surfaces.**

Spec: `docs/GIS_TOOLPACK.spec.md` (epic-level; the geocoding contract is §"apps/api — tools", §"bulk geocode job", §"codes, env, inference", and rows 12–13 of the *Visibility of limits* table). Issue: #315 (epic #84, **blocked-by #314** which is merged into the epic). Branch: `feat/gis-geocoding`, base `epic/gis-toolpack`.

This is the epic plan's **slices 6–7 + the geocoding doc surfaces** — slices 1–5 (the `gis` pack, `visualize_map`, the map renderer, `geoRole`) already merged via #314/#316. 5 slices, each behind a green suite and compilable at its boundary; commits on `feat/gis-geocoding`, PR into `epic/gis-toolpack`.

Run tests per package (never raw jest — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd packages/core && npm run test:unit
```

Each slice: (1) failing tests; (2) smallest change to green; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

**Current-state deltas from the spec's citations** (verified on this branch, they predate #314/#316/#337/#346/#350/#352 merges):
- `environment.ts` is `apps/api/src/environment.ts` (not `config/`); `TAVILY_API_KEY` at `:49`.
- Cost gate: `cost-gate.service.ts` — `CostResolver = (input) => number | Promise<number>` `:43`, `registerCostResolver` `:53`, `resolveCallCost` `:70`, `commitCharge(charge, now?)` `:232`.
- `deferChargeToJob` is a **boolean flag** set in `tools.service.ts:763` from `capability.resultKind === "progress"` — not a function.
- Entity-target lock conflicts throw **`BULK_JOB_TARGET_LOCKED`** (`job-lock.service.ts:193`), *not* `ENTITY_LOCKED_BY_JOB` — the acceptance criterion's "409" holds; the code is the bulk-target one, mirroring `bulk_transform`.
- `GIS_PACK` (`builtin-toolpacks.ts:258`) lists **only `visualize_map`**; `geocode` / `reverse_geocode` / `bulk_geocode_records` and the two `GEOCODE_*` api-codes are all net-new.
- Redis: `redis.util.ts:getRedisClient()` `:10`; TTL pattern `redis.set(key, val, "EX", ttlSec)` / `redis.get(key)` (per `cost-acknowledgement.service.ts:95,123`).

Sequencing rationale — **S1** lands the provider + cache + codes + env with no tool wiring (leaf; both later tool slices import it). **S2** wires the two interactive tools + the zero-unit resolver on top of S1. **S3** adds the `bulk_geocode` job type + the ack/lock tool. **S4** adds the processor (bill-on-success) that S3's job type dispatches to — split from S3 so the ack/lock unit tests green before the integration suite. **S5** is text-only agent/doc surfaces + infra. No forward deps.

---

## Slice 1 — Geocoding provider + zero-unit cache + typed codes + env

The paid-third-party seam, with no tool consuming it yet.

**Files**

- New: `packages/core/src/constants/large-data-ops.constants.ts` — `GEOCODE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000` (spec §constants).
- New: `apps/api/src/services/geocoding/provider.ts` — `GeocodingProvider` interface (`geocode(address): Promise<GeocodeHit>`, `reverseGeocode(lat, lng): Promise<ReverseHit>`) + `GeocodeHit` / `ReverseHit` types.
- New: `apps/api/src/services/geocoding/mapbox.ts` — `MapboxGeocodingProvider` (only impl; hits the Mapbox geocoding API via `fetch`; maps provider error → `GEOCODE_PROVIDER_UNAVAILABLE`, empty result → `GEOCODE_ADDRESS_UNRESOLVED`).
- New: `apps/api/src/services/geocoding/cache.ts` — `normalizeAddress` (lowercase/trim/collapse-whitespace), `cacheKey` (`geocode:v1:mapbox:<normalized>`), `cacheGet` / `cacheSet` (TTL `GEOCODE_CACHE_TTL_MS`) / `cacheHas`, over `getRedisClient()`.
- Edit: `apps/api/src/environment.ts` — add `GEOCODING_API_KEY: process.env.GEOCODING_API_KEY` beside `TAVILY_API_KEY` (`:49`).
- Edit: `apps/api/src/constants/api-codes.constants.ts` — add `GEOCODE_PROVIDER_UNAVAILABLE`, `GEOCODE_ADDRESS_UNRESOLVED` to the `ApiCode` enum + their `ApiCodeDefaultRecommendation` entries.
- New tests: `apps/api/src/__tests__/services/geocoding/cache.test.ts`, `.../mapbox.test.ts`; `packages/core` constant covered by existing constant test if any (else assert via a small case).

**Steps**

1. **Tests (spec: geocode unit cases).** `normalizeAddress` collapses case/whitespace; `cacheKey` stable; `cacheHas`/`cacheGet` round-trip a set value with TTL (mock ioredis). Mapbox: a mocked `fetch` OK response → `{lat,lng,formattedAddress,confidence}`; a network/5xx → throws typed `GEOCODE_PROVIDER_UNAVAILABLE`; an empty-features response → `GEOCODE_ADDRESS_UNRESOLVED`. Run; fail.
2. **Implement** the provider + cache + codes + env. Green.
3. Lint + type-check; `npm run build --workspace @portalai/core` (new constant into the git-ignored dist).

**Done when:** provider + cache exist with typed failures; nothing wires them yet.

**Risk:** none live — the Mapbox test mocks `fetch`; no real key needed until smoke.

---

## Slice 2 — `geocode` + `reverse_geocode` tools + zero-unit resolver + pack/capabilities

The two interactive `metered` tools, charging 0 on a cache hit.

**Files**

- New: `apps/api/src/tools/geocode.tool.ts`, `apps/api/src/tools/reverse-geocode.tool.ts` — `Tool` subclasses mirroring `web-search.tool.ts:9-18`: `build()` throws on missing `environment.GEOCODING_API_KEY`; `execute` = cache-lookup → provider-on-miss → `{lat,lng,formattedAddress,confidence,cached}` (reverse: `{address,components,confidence,cached}`), setting the cache on a miss.
- Edit: the tool-construction site that builds `gis`-pack tools (where `visualize_map` is wired) — register the two tools.
- Edit: `apps/api/src/services/cost-gate.service.ts` (or a `geocoding` registration imported at build) — `registerCostResolver("geocode", async (input) => (await cacheHas((input as {address:string}).address)) ? 0 : 1)` and the same for `reverse_geocode` (keyed on its `lat,lng`).
- Edit: `packages/core/src/registries/builtin-toolpacks.ts` — add `geocode`, `reverse_geocode` to `GIS_PACK.tools` (`:266`) + two `CAPABILITIES` entries (`costHint: "metered"`, `consumption: none`, `production: {kind:"value"}`, `resultKind: scalar/value`, `computeShape: map`) mirroring the matrix; hand-authored description mirrors.
- Tests: `apps/api/src/__tests__/tools/geocode.tool.test.ts` (+ reverse) — provider hit; **cache hit → `cached:true`**; missing key → `build()` throws; provider down → typed result. `packages/core` `builtin-toolpacks.test.ts` — pack now carries the two tools + capabilities; costHint pin extended. `cost-gate` resolver test — cache hit yields 0 units.

**Steps**

1. **Tests (spec: geocode + pack + resolver cases).** Run; fail.
2. **Implement** tools + resolver registration + pack/capability entries. Green.
3. Lint + type-check; rebuild core (pack + capability into dist).

**Done when:** `geocode`/`reverse_geocode` resolve end-to-end, a repeat is `cached:true` at **0 units**, and the pack lists them with the cost-gate wrap guard passing.

**Risk:** the resolver must key on the same normalized address the tool caches under, or a hit still charges — the shared `normalizeAddress`/`cacheHas` from S1 prevents drift (one code path).

---

## Slice 3 — `bulk_geocode` job type + `bulk_geocode_records` tool (ack + lock + enqueue)

The `expensive` bulk path's front half: the job contract and the tool that gates + enqueues it.

**Files**

- Edit: `packages/core/src/models/job.model.ts` — the documented 5-step add (`:426-428`): `JobTypeEnum` (`:38-46`) + `"bulk_geocode"`; `BulkGeocodeMetadataSchema` (JSDoc naming the locked ids) `{ connectorEntityId, sourceColumnKey, targetColumnKey, portalId, expectedRecords }`; `BulkGeocodeResultSchema` `{ geocoded, cached, failed, durationMs }`; `JobTypeMap.bulk_geocode` (`:430`); `JOB_TYPE_SCHEMAS.bulk_geocode` (`:459`); `JOB_LOCK_KEYS.bulk_geocode` (`:520`) locking the target entity + `portalId`, mirroring `bulk_transform:523`. **Lock-field decision:** the lock service reads an array field via `findRunningByTargetEntityIds`; carry the locked id as the field `JOB_LOCK_KEYS` names (align with `bulk_transform`'s `targetConnectorEntityIds` shape — confirm the exact field the lock query reads before finalizing, `job-lock.service.ts:164`).
- New: `apps/api/src/tools/bulk-geocode-records.tool.ts` — ack-gate (`costHint === "expensive"` && `acknowledgeCost !== true` → `CostAcknowledgementService.recordRejection` + throw `BULK_DISPATCH_COST_NOT_ACKNOWLEDGED`; acked → `validate` → `BULK_DISPATCH_COST_ACKNOWLEDGEMENT_INVALID` on missing/stale), mirroring `transform-entity-records.tool.ts:586-620`; `assertConnectorEntityUnlocked([connectorEntityId], organizationId)` (`job-lock.service.ts:137`); enqueue via `JobsService`; return `{ jobId, expectedRecords, blockKind: "bulk-job-progress", blockContent }`.
- Edit: `builtin-toolpacks.ts` — add `bulk_geocode_records` to `GIS_PACK.tools` + capability (`costHint: "expensive"`, **`resultKind: "progress"`** so `tools.service.ts:763` sets `deferChargeToJob`); mirror description.
- Tests (unit): `apps/api/src/__tests__/tools/bulk-geocode-records.tool.test.ts` — first call → `BULK_DISPATCH_COST_NOT_ACKNOWLEDGED` (+ estimate in message); acked → enqueues + returns the progress-block shape; a locked entity → lock error. `packages/core` job.model + builtin-toolpacks tests — new type parses, lock keys present, pack/capability pinned.

**Steps**

1. **Tests (spec: bulk ack/lock/block unit cases).** Run; fail.
2. **Implement** the job contract + tool. Green. **If `queues/processors/index.ts` is exhaustive over `JobType`**, add a minimal throwing `bulk_geocode` processor stub here so the tree compiles (S4 fleshes it) — note in the commit.
3. Lint + type-check; rebuild core (job model into dist).

**Done when:** `bulk_geocode_records` gates on the ack, refuses a locked entity, and enqueues a `bulk_geocode` job returning the progress block. No processing yet.

**Risk:** the ack estimate is surfaced via the message/recommendation (not a structured cost field) — match `transform-entity-records`'s copy so the agent relays a usable number.

---

## Slice 4 — `bulk_geocode` processor (bill-on-success, GeoJSON Points, partial-failure)

The bulk path's back half: iterate, write points, charge once.

**Files**

- New: `apps/api/src/queues/processors/bulk-geocode.processor.ts` — read the source column's addresses, geocode each (cache-aware, reusing S1's cache so repeats are free), write a **GeoJSON Point** into the target geometry-role column via the wide-table writes util, report progress through the BullMQ job; on success `CostGateService.commitCharge({ … toolName: "bulk_geocode_records", units: <successful uncached geocodes>, toolCallId: \`job:${jobId}\`, … })` (mirror `bulk-transform.processor.ts:112-127`) — retry-safe via the stable `job:<jobId>` id; partial failure → `BulkGeocodeResult { geocoded, cached, failed }` surfaced through the existing `BULK_JOB_PARTIAL_FAILURE` shape (never reports success).
- Edit: `apps/api/src/queues/processors/index.ts` — register (replace the S3 stub, if any).
- Tests (integration): `apps/api/src/__integration__/queues/bulk-geocode.integration.test.ts` (new) — acked call enqueues + locks (a competing mutation gets `409` `BULK_JOB_TARGET_LOCKED`); the processor writes GeoJSON Points into the target column and **charges once** with `toolCallId: "job:<id>"`; a re-run is idempotent (no double charge); a partially-failing run reports `{ geocoded, cached, failed }` with failed rows identifiable.

**Steps**

1. **Tests (spec: integration ~ bulk cases).** Run; fail.
2. **Implement** the processor + registration. Green.
3. Lint + type-check.

**Done when:** a bulk column geocodes to GeoJSON Points, charges exactly once (idempotent on retry), locks its entity while running, and reports partial failures honestly.

**Risk:** double-charge on retry — the `job:<jobId>` `toolCallId` + `commitCharge`'s `insertIfNew` are the guard (asserted by the re-run idempotency case). Only **successful, uncached** geocodes bill (cache hits are 0, matching the interactive path).

---

## Slice 5 — Agent + doc surfaces + infra

Teach the agent when to geocode; keep the documented surfaces in sync; provision the key.

**Files**

- Edit: `apps/api/src/prompts/system.prompt.ts` — gis-section guidance: when a user asks to map data that is **addresses/text, not coordinates**, `geocode` first (or `bulk_geocode_records` for a whole column), then `visualize_map`; never fabricate coordinates — relay the typed failure.
- Edit: `packages/core/src/registries/builtin-toolpacks.ts` — the hand-authored mirror descriptions for the three tools (kept in sync per `CLAUDE.md`).
- Edit: `apps/web/src/utils/glossary.util.ts`, `apps/web/src/utils/faq.util.ts` — geocoding entries (+ `glossary-routes.util.ts` map if a term needs a Help route).
- Edit: `apps/api/infra/cloudformation/backend.yml` — mirror `TAVILY_API_KEY`'s three sites for `GEOCODING_API_KEY` (parameter, task-role grant, container secret); `apps/api/.env.example` updated.
- Tests: `system.prompt.test.ts` (geo guidance names geocode + the no-fabrication rule), `builtin-toolpacks.test.ts` (mirror in sync), `glossary.util.test.ts` / `faq.util.test.ts` pins.

**Steps**

1. **Tests (spec: prompt + mirror + glossary/faq pins).** Run; fail.
2. **Implement** the text + infra edits. Green.
3. Lint + type-check; rebuild core.

**Done when:** the agent has geocode guidance, the mirror/glossary/FAQ are in sync, and the infra declares `GEOCODING_API_KEY`. **CloudFormation has no unit test** — verified in the app-dev deploy.

**Risk:** live geocoding needs `GEOCODING_API_KEY` provisioned in app-dev **before** the smoke's live steps — an infra prerequisite outside this PR's code.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| S1 | provider + cache + `GEOCODE_*` codes + env + TTL | geocoding cache/mapbox unit tests |
| S2 | `geocode`/`reverse_geocode` tools + zero-unit resolver + pack/caps | tool + pack + resolver unit tests |
| S3 | `bulk_geocode` job type + ack/lock/enqueue tool | job.model + bulk-tool unit tests |
| S4 | `bulk_geocode` processor (bill-on-success, points) | bulk-geocode integration suite |
| S5 | agent/doc surfaces + infra | prompt/mirror/glossary pins |

## Cross-slice notes

- **Core rebuilds** after S1/S2/S3/S5 (git-ignored dist carries the new constant, pack, capabilities, and job schemas — `project_stale_core_dist_after_branch_switch`).
- **Processor-registry exhaustiveness (S3↔S4).** Adding `bulk_geocode` to `JobTypeEnum` may force a processor entry to compile; if so, S3 lands a throwing stub and S4 implements it — never a broken tree between them.
- **Lock-code nuance.** The entity-target conflict is `BULK_JOB_TARGET_LOCKED` (not `ENTITY_LOCKED_BY_JOB`); the acceptance criterion's "409" is satisfied — pin the exact code in the S4 integration assertion.
- **Bill-on-success, never refund** (`feedback_bill_on_success_no_refunds`): only successful uncached geocodes bill, charged once from the processor on completion; cache hits and failures are free.
- **No new prompt safety gate** (`feedback_no_prompt_safety_gates`): the ack-gate and cost enforcement are **server-side** (the cost-ack service + cost gate), not prompt instructions.
- **Doc-sync is S5, in-PR** (three tool surfaces + glossary/FAQ), per `CLAUDE.md` → "Keeping Documentation in Sync".

## Next step

Once the plan is confirmed, implementation begins on `feat/gis-geocoding` — Slice 1 first, tests-first, one commit per slice, PR into `epic/gis-toolpack`. `GEOCODING_API_KEY` must be provisioned in app-dev before the live smoke steps; slices 1–4 test against a mocked provider.
