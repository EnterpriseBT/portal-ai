# PostGIS foundation — Plan

**TDD-sequenced implementation of the epic's substrate: extension enablement, the `geometry` column type end-to-end, geometry audit with per-row reporting, the pre-flighted type transition, the `ST_AsMVT` tile endpoint, and the agent's `ST_*` surface.**

Spec: `docs/POSTGIS_FOUNDATION.spec.md`. Shared discovery: `docs/GIS_TOOLPACK.discovery.md`. Issue: #316 (epic #84). Builds on **shipped #312** (the `BlockRef` union the tile routes reuse) and **#270** (the persisted `pipeline` descriptor tiles read).

Seven slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/postgis-foundation`**, whose PR targets **`epic/gis-toolpack`, not `main`** — the epic branch is the deployment gate.

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — substrate before storage, storage before semantics, semantics before surfaces:

- **Slice 1** is the extension and the base image. It gates everything and has the widest blast radius, so it lands alone with the *entire existing suite* as its gate.
- **Slice 2** is the contract (`geometry` in the enum, `geoRole` narrowed) plus the one-line reconciler arm the compiler **forces** — see the forcing-function note below; splitting them would break the tree.
- **Slice 3** makes geometry actually storable and indexed. **Slice 4** makes it trustworthy (audit + reporting). **Slice 5** makes existing `json` columns convertible.
- **Slice 6** is the tile endpoint — the only new HTTP surface, isolated so it reviews on its own. **#314 unblocks after this slice.**
- **Slice 7** is the agent-facing surface plus the benchmark that justifies the whole child.

---

## Slice 1 — PostGIS extension + base image

The riskiest change, alone. Nothing else can be written until Postgres can hold a geometry.

**Files**

- New: `apps/api/drizzle/<n>_enable-postgis.sql` — `CREATE EXTENSION IF NOT EXISTS postgis;`
- New: `apps/api/src/__tests__/__integration__/db/postgis.integration.test.ts`
- Edit: `docker-compose.yml:53,72` — both app and test databases → a `postgis/postgis:17-*` image; `.devcontainer/*` to match.

**Steps**

1. **Tests (spec: core-substrate cases).** `SELECT postgis_version()` returns a version; `SELECT ST_SRID(ST_SetSRID(ST_MakePoint(0,0),4326))` is `4326`; running the migration twice is a no-op. Run; fail (no extension).
2. **Implement.** Verify the exact published image tag before pinning it, pull it, recreate the volumes, add the migration. Green.
3. **Boundary gate is the whole suite, not the new test** — `npm run test` across the monorepo must pass on the new image with zero regressions.
4. Lint + type-check.

**Done when:** the extension is present locally and in CI, the migration is idempotent, and every pre-existing test still passes.

**Risk:** highest of the seven. The image tag may not exist as guessed (verify, don't assume); `CREATE EXTENSION` needs elevated rights — confirm app-dev's role can do it *before* the deploy, and if not, create it out-of-band so `IF NOT EXISTS` no-ops. Existing local volumes must be recreated, not reused.

---

## Slice 2 — `geometry` in the contract (+ the arm the compiler demands)

Core enum, narrowed `geoRole`, DB column, seeds — plus the single reconciler mapping arm, because `pgTypeForColumnDefinitionType`'s `never` exhaustiveness check turns a new enum member into a **compile error**. That is a feature: it guarantees no type can be added without a storage decision. It also means these cannot be separate slices.

**Files**

- Edit: `packages/core/src/models/column-definition.model.ts` — `geometry` in `ColumnDataTypeEnum`; `GeoRoleSchema = z.enum(["lat","lng"])`; `geoRole` on the schema.
- Edit: `packages/core/src/contracts/column-definition.contract.ts:48,71` — `geoRole` on create/update bodies.
- Edit: `apps/api/src/db/schema/column-definitions.table.ts` (+ `zod.ts`, `type-checks.ts`); new migration `add-geometry-column-type` (the nullable `geo_role text` column only — `geometry` is a Zod enum member, not a pg enum).
- Edit: `apps/api/src/services/wide-table-reconciler.service.ts:63` — `case "geometry": return "geometry(Geometry, 4326)"`.
- Edit: `apps/api/src/services/seed.service.ts:31` — `geometry` / `latitude` / `longitude` system rows.
- Edit/new tests: `packages/core/src/__tests__/models/column-definition.model.test.ts`; `apps/api` seed integration.

**Steps**

1. **Tests (spec: core cases ×5, seed idempotency).** `geometry` parses; `geoRole` accepts `lat`/`lng` and **rejects `"geometry"`**; `geometry` ∉ `SORTABLE_COLUMN_TYPES`; `pgTypeForColumnDefinitionType("geometry")` → `geometry(Geometry, 4326)`; seeding twice yields three geo rows, not six. Run; fail.
2. **Implement**, apply the migration, rebuild core so `apps/*` see the new dist. Green.
3. Lint + type-check (the dual-schema assertions are the real gate).

**Done when:** the contract is live and seeded; no wide table has yet created a geometry column.

**Risk:** other `ColumnDataTypeEnum` consumers (7+ contracts, the Haiku classifier's response enum, web type lists) may need to acknowledge the new member — type-check finds them all; widen only where correct rather than silencing.

---

## Slice 3 — Storable and indexed: statement-cache expressions + GiST

Geometry becomes writable and readable. The gap the spec found: the INSERT emits bare `$n` placeholders (`wide-table-statement.cache.ts:227-231`), so a bound GeoJSON value cannot become a geometry.

**Files**

- Edit: `apps/api/src/services/wide-table-statement.cache.ts` — export `writePlaceholderExpr(pgType, index)`; use it when composing the VALUES tuples; add the geometry arm to the read-side fragment builder (`:147-158`) → `ST_AsGeoJSON(<col>)::jsonb`.
- Edit: `apps/api/src/services/wide-table-reconciler.service.ts` — create the GiST index for geometry columns; record `pgType` as `geometry(Geometry, 4326)`.
- New/edit tests: `__tests__/services/wide-table-statement.cache.test.ts`; `__integration__/db/wide-table-geometry.integration.test.ts`.

**Steps**

1. **Tests (spec: statement-cache + wide-table cases).** Unit: geometry placeholder wraps as `ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))`, every other type stays bare `$1`, read projection emits `ST_AsGeoJSON`. Integration: a geometry-typed field mapping materializes `geometry(Geometry,4326)`; a GiST index exists in `pg_indexes`; a GeoJSON value round-trips in→out unchanged; `EXPLAIN` of an `ST_Intersects` predicate shows an index scan. Run; fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** geometry writes, reads back as GeoJSON (so `sql_query` and the data-table renderer need no change), and is indexed.

**Risk:** `CREATE INDEX CONCURRENTLY` **cannot run inside a transaction** — issue it outside the reconciler's DDL transaction, or use a plain `CREATE INDEX` while tables are small and note the choice. A silent-failure trap if missed.

---

## Slice 4 — Trustworthy: geometry audit, normalization, reporting

Postgres decides validity, in one round-trip per batch, so repairs and rejections are counted and attributable rather than silently applied. Implements limits-table rows 5–7.

**Files**

- New: `apps/api/src/services/geometry-audit.service.ts` — `auditBatch(rows) → { ok, repaired, rejected }`.
- New: `apps/api/src/adapters/rest-api/geometry.util.ts` — `toGeoJsonCandidate`, `looksLikeGeometry`.
- Edit: `adapters/rest-api/inference.util.ts` (geometry shape detection → `geometry`; lat/lng name+range → roles); `transform.util.ts` (normalization hop); the sync path (write `ok ∪ repaired`, omit `rejected`, report counts).
- Edit: `constants/api-codes.constants.ts` — `GEOMETRY_INVALID_ON_IMPORT`, `GIS_SRID_UNSUPPORTED`.
- New tests: `__tests__/adapters/rest-api/geometry.util.test.ts`; `__integration__/services/geometry-audit.integration.test.ts`.

**Steps**

1. **Tests (spec: geometry.util + audit cases).** Unit: ArcGIS rings → Polygon, paths → LineString, GeoJSON passthrough, garbage → `null`; `looksLikeGeometry` positives and negatives; inference sets `geometry` and lat/lng roles, and does **not** tag an out-of-range numeric. Integration: audit classifies clean / invalid / unparseable; a rejected row is **absent** from the wide table (not `NULL`); the sync summary carries `{ repaired, rejected }` with `sourceId`s; an unknown SRID returns `GIS_SRID_UNSUPPORTED`. Run; fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** a mixed-quality import lands clean geometry, repairs what it can, and *names* what it refused.

**Risk:** the fail-closed choice drops a row's other columns along with its bad geometry — deliberate per the spec, but confirm it against real ArcGIS data during smoke rather than assuming rejection is rare.

---

## Slice 5 — Converting existing columns: pre-flighted `json → geometry`

Unlike the existing re-label transitions, this one converts data — and Postgres aborts the whole `ALTER` on the first bad row with an opaque error. So it pre-flights.

**Files**

- Edit: `apps/api/src/constants/column-definition-transitions.constants.ts` — `json: ["geometry"], geometry: ["json"]`.
- Edit: `apps/api/src/routes/column-definition.router.ts` — pre-flight via `GeometryAuditService`; any rejects ⇒ `422 GEOMETRY_CONVERSION_FAILED` with count + bounded `sourceId` sample, and **no `ALTER`**.
- Edit: `wide-table-reconciler.service.ts` — the `ALTER … USING ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(<col>::text), 4326))` path + index creation.
- Edit: `constants/api-codes.constants.ts` — `GEOMETRY_CONVERSION_FAILED`; `apps/web/src/components/EditColumnDefinitionDialog.component.tsx:34` — mirror the pair.
- Tests: extend the column-definition route integration suite; web dialog unit.

**Steps**

1. **Tests (spec: transition cases).** Bad rows → 422 with count + sample, column still `json`, no index created; clean data → converts, `pg_indexes` shows the GiST index, values readable as GeoJSON; `geometry → json` reverses; the web dialog offers the transition. Run; fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** a mis-inferred `json` column can be upgraded in place, or is told precisely why it can't.

**Risk:** none structural — the pre-flight makes the destructive step unreachable when it would fail.

---

## Slice 6 — `ST_AsMVT` tile endpoint

The only new HTTP surface, isolated for review. **#314 unblocks after this.**

**Files**

- New: `apps/api/src/routes/portal-map.router.ts`; mounted at `routes/protected.router.ts` as `/portal-map`.
- Edit: `constants/api-codes.constants.ts` — `MAP_TILE_NOT_FOUND`, `MAP_TILE_TIMEOUT`; `config/swagger.config.ts` — the route's `@openapi` components.
- New tests: `__tests__/routes/portal-map.router.test.ts`; `__integration__/routes/portal-map.router.integration.test.ts`.

**Steps**

1. **Tests (spec: tile-route cases).** Unit: `z/x/y` bounds rejected (`z>22`, `x ≥ 2^z`, negatives); unknown block → 404; **cross-org → 404, not 403** (no existence leak); `statement_timeout` → 504; `X-Portal-Tile-Simplified` present when tolerance > 0; `X-Portal-Tile-Truncated` present when the feature cap clips; empty envelope → 204. Integration: a real tile decodes as MVT and its feature count matches the envelope; a foreign org gets 404. Run; fail.
2. **Implement** the route (`ST_AsMVT` over `ST_AsMVTGeom` + `ST_TileEnvelope`, `&&` predicate for index use, zoom-derived `ST_SimplifyPreserveTopology`), the codes, and the OpenAPI block. Green.
3. Lint + type-check.

**Done when:** a persisted, pipeline-carrying block serves decodable tiles, and every degradation announces itself.

**Risk:** **no `geo` blocks exist until #314**, so these tests address a pipeline-carrying `d3` block fixture. That is deliberate and worth stating in the contract: the route gates on *"the block has a durable pipeline"*, not on `type === "geo"` — which keeps #316 independently testable and costs nothing, since only the map widget ever requests tiles.

---

## Slice 7 — Agent surface, benchmark, doc sync

**Files**

- Edit: `tools/station-context.tool.ts:266,310` — emit `geometry` + SRID per column.
- Edit: `prompts/system.prompt.ts` — the `ST_*` vocabulary and the compute-upstream idiom (`ST_MakeLine`, `ST_HexagonGrid`, `ST_Union`, `ST_SimplifyPreserveTopology`).
- New: `docs/POSTGIS_FOUNDATION.benchmark.md` — recorded numbers.
- Edit: `packages/core/README.md` / `apps/api/README.md` where they describe column types or storage.
- Tests: `system.prompt.test.ts`; an integration case asserting `transform-entity-records.tool.ts:239`'s `ST_Area(geometry::geography)` example **executes** through the read-only path.

**Steps**

1. **Tests (spec: prompt + agent-surface cases).** `station_context` includes a geometry column with its SRID; prompt names the `ST_*` idioms; the previously-broken `ST_Area` example now runs. Run; fail.
2. **Implement**; run the benchmark (parcel query turf-vs-PostGIS at current size and 500k synthetic; tile latency at z8/z12/z16) and commit the numbers.
3. Full monorepo `npm run lint && npm run type-check && npm run test`.

**Done when:** the agent can see and use geometry, and the child's central claim is backed by measurements in the repo rather than by argument.

**Risk:** none — additive.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | Extension + base image | **Entire existing suite** green on PostGIS |
| 2 | `geometry` type + `geoRole` narrowing + migration + seeds + forced reconciler arm | core suite + dual-schema type-check |
| 3 | Write/read expressions + GiST index | geometry round-trips; `EXPLAIN` shows index scan |
| 4 | Audit + normalization + reporting | rejects named, absent from table; counts surfaced |
| 5 | Pre-flighted `json → geometry` | 422 with sample on bad data; clean data converts |
| 6 | Tile endpoint | decodable MVT; 404/504/headers — **#314 unblocks** |
| 7 | Agent surface + benchmark + docs | full monorepo green; numbers committed |

## Cross-slice notes

- **Compiler forcing function.** Adding `geometry` to `ColumnDataTypeEnum` breaks `pgTypeForColumnDefinitionType`'s `never` check by design; slice 2 must carry that arm. Expect the same signal from other enum consumers — treat each as a real decision, not a cast to silence.
- **Migration ordering.** Slice 1's `CREATE EXTENSION` must precede every geometry DDL, including slice 3's runtime index creation and slice 5's `ALTER`.
- **Core rebuild.** `apps/api` and `apps/web` consume core's built dist — rebuild core after slice 2 or the type-check lies.
- **Tile addressing gates on a pipeline, not a block type** (slice 6) — the reason #316 can test tiles before any `geo` block exists.
- **Limits table is the acceptance spine.** Rows 2–7 are implemented across slices 3, 4, and 6, and each needs a test asserting the **notice**, not merely the behaviour. Any new cap found while implementing joins the table in the same PR.
- **Doc-sync surfaces** (slice 7): `system.prompt.ts`, `station_context`, both READMEs where they describe column types. Glossary/FAQ geo entries belong to #314, which ships the user-visible map.
- **PR base is `epic/gis-toolpack`.** Before this child merges, merge `main` into the epic branch (keep-pace rule) so the final epic → `main` integration is never a big bang.

## Next step

Implementation begins on `feat/postgis-foundation` — slice 1, tests-first, one commit per slice — once the spec and this plan are confirmed. Slice 1 should be walked carefully: verify the published image tag and app-dev's `CREATE EXTENSION` privilege before committing to it.
