# Empty-geometry record is invisible — Condensed design (#757)

**Issue:** [EnterpriseBT/portal-ai#757](https://github.com/EnterpriseBT/portal-ai/issues/757) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** A manual write with a geometry the wide-table audit can't parse (the web dialog sends `""` for an empty Geometry field) returns 201. But `wideTable.upsertMany` drops that row into `rejected`, the caller ignores it, and the transaction commits an `entity_records` row with no `er__<entity>` mirror. The record counts toward totals, but every read (list, detail, edit, delete) misses it. The dialog also can't send a *valid* geometry: it renders geometry as a plain text field and sends the text as a string, and the audit only accepts objects. Packages: `apps/api`, `apps/web`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Fail-closed audit | `apps/api/src/db/repositories/wide-table.repository.ts:393` `auditGeometry` | A value `toGeoJsonCandidate` can't read (any non-object, e.g. `""`) → `rejected`, and the row is not written. `null`/absent → NULL column |
| Shape check | `apps/api/src/adapters/rest-api/geometry.util.ts:114` | Objects only: GeoJSON, or ESRI rings/paths/x,y |
| Manual create | `apps/api/src/routes/entity-record.router.ts:833` | Ignores `upsertMany`'s result → the bug |
| Manual import | `apps/api/src/routes/entity-record.router.ts:1031` | Same, batch of rows |
| Agent create tool | `apps/api/src/tools/entity-record-create.tool.ts:190` | Same, per entity |
| PATCH / agent update | `entity-record.router.ts:1329`, `tools/entity-record-update.tool.ts:190` → `wideTable.updatePartial` (`:513`) | No audit. Feeds the value straight to `ST_GeomFromGeoJSON`, so `""` should raise a PG error and answer 500 (to pin with a red test) |
| Sync adapters | `adapters/rest-api/rest-api.adapter.ts:909` | Skip and report (`geometryRejected` counts): the intended bulk posture, unchanged |
| Web serializer | `apps/web/src/utils/record-field-serialization.util.ts:7` | No `geometry` case → `default` sends the raw string (`""`, or typed GeoJSON as text) |
| Web field | `apps/web/src/components/DynamicRecordField.component.tsx:260` | Geometry falls to the single-line `default` TextField. In edit mode an object value renders as `[object Object]` |

## Decision — a manual write never commits a record its mirror refused

- **A. Normalize `""` → `null` on the API.** This hides the symptom only: `"abc"` or a malformed object still vanishes.
- **B. Refuse the write (chosen).** A manual write path (create, import, agent create) throws inside its transaction when `rejected` is non-empty, which rolls back the `entity_records` insert. The answer is `400 GEOMETRY_INVALID_ON_IMPORT` naming the field (and, for import, the first rejected `sourceId`s, capped like #745's echo) and the audit's reason. Import is all-or-nothing, matching #745's "never half-applied". PATCH/update runs the same audit before `updatePartial`, so a bad value is a 400, not a 500. One helper, `assertNoRejectedGeometry(result, …)`, is shared by the call sites. Sync keeps skip-and-report: there is no user present to fix a row.
- **Web:** add a `geometry` case. In the serializer, `""` → `null`, and text → `JSON.parse` (a parse error is a field error, `Invalid GeoJSON: …`). In `initializeRecordFields`, an object → pretty JSON. In `DynamicRecordField`, geometry renders multiline like `json`. So an empty field saves as NULL, and a pasted GeoJSON object round-trips.

## Plan — 2 slices

**Slice 1 — API refuses an unwritable geometry (fix(api)).**
- Files: `apps/api/src/utils/wide-table-rejection.util.ts` (new helper), `routes/entity-record.router.ts` (create, import, PATCH), `tools/entity-record-create.tool.ts`, `tools/entity-record-update.tool.ts`.
- Tests (red first): `src/__tests__/__integration__/routes/entity-record.router.integration.test.ts`, on an entity with a geometry mapping:
  - create with `geometry: ""` → 400 naming `geometry`, and no `entity_records` row;
  - create with `null` → 201 and visible in the list;
  - create with a valid GeoJSON object → 201 and readable;
  - import with one bad row → 400, and nothing written;
  - PATCH `geometry: ""` → 400 (was 500), with the row unchanged.
  - Plus `src/__tests__/tools/entity-record-create.tool.test.ts` and `entity-record-update.tool.test.ts`.
- Run: `cd apps/api && npm run test:unit`, then `AUTH_API_RATE_LIMIT_PER_MIN=1000000 npm run test:integration -- --testPathPattern entity-record`.

**Slice 2 — dialog sends geometry it can write (fix(web)).**
- Files: `utils/record-field-serialization.util.ts`, `components/DynamicRecordField.component.tsx`.
- Tests: `src/__tests__/record-field-serialization.test.ts`:
  - `""` → `null`;
  - GeoJSON text → object;
  - bad text → field error;
  - init of an object → JSON text.
  - Plus `src/__tests__/CreateEntityRecordDialog.test.tsx`: an empty Geometry submits `null`.
- Run: `cd apps/web && npm run test:unit -- --testPathPattern 'record-field|EntityRecordDialog'`.

Docs: the validation-message surface (`record-field-serialization.util.ts`) is the only user copy touched. Add the field's `helperText` ("GeoJSON geometry, e.g. {\"type\":\"Point\",\"coordinates\":[lng,lat]}").

## Smoke (manual, against your dev stack)

1. On an entity with a geometry column, create a record, leaving Geometry empty → 201. The record appears in the list and opens in detail, and Geometry is empty.
2. Create one with `{"type":"Point","coordinates":[-122.4,37.8]}` → it appears, and detail shows the point.
3. Edit that record → the Geometry field shows the JSON (not `[object Object]`). Save unchanged → 200.
4. Type `not json` in Geometry → the field error shows `Invalid GeoJSON`, and nothing is sent.
5. `curl` create with `"geometry":""` → 400 `GEOMETRY_INVALID_ON_IMPORT` naming `geometry`, and the record count is unchanged. PATCH the same → 400, not 500.
6. Import (`POST …/records/import`) two rows, one with a bad geometry → 400, and neither row is written.

## Out of scope

- Sync adapters' skip-and-report posture (by design, #316).
- `record-import.util.ts` (only the demo seed calls it, with known-good data).
- Records already stranded by this bug: local only (`fe9d1302…`, gone with the DB reset). With no production data, no backfill is needed.
