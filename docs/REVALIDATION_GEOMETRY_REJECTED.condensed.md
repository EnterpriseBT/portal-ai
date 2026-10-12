# Revalidation reports refused geometries — Condensed design (#765)

**Issue:** [EnterpriseBT/portal-ai#765](https://github.com/EnterpriseBT/portal-ai/issues/765) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). It touches two packages: an additive optional field on a core job-result schema, written by one API processor. That's at the edge of the condensed threshold, and it follows the `mirrorDegraded` precedent.

**Why.** Since #757, revalidation leaves a geometry the audit refuses as it is (skip mode), and the count goes only to `logger.warn`. The job result is `{ total, valid, invalid, errors }`, so a run that skipped 2,000 geometries reads as clean on the job's page. CLAUDE.md (Async Job State): "keep the degradation on a field something renders: a log line alone is not a surface anyone reads."

## Current shape

| Piece | Location | Note |
|---|---|---|
| `RevalidationResultSchema` | `packages/core/src/models/job.model.ts:73` | `total`, `valid`, `invalid`, `errors[]`; no field for refused geometries |
| Refusals collected | `revalidation.processor.ts` (the `updateMany(…, "skip")` call) | each batch returns `WideTableRejection[]` (`sourceId` = the record id, `fields` = the geometry keys); only the count is kept, and it's logged |
| Where results render | `apps/web/src/views/JobDetail.view.tsx:175` | the whole `result` as JSON, the way sync's `mirrorDegraded` surfaces |
| Capped-list precedent | `bulk-geocode.processor.ts:20` | `MAX_PARTIAL_FAILURES = 50`, with `partialFailures` plus `partialFailuresOmitted` |

## Decision — one optional object, set only when something was refused

`RevalidationResultSchema` gains **`geometryRejected?: { count, omitted, records }`**:
- `count` is how many records kept their geometry because the audit refused the new value;
- `records` lists the first `REVALIDATION_MAX_GEOMETRY_REJECTIONS` (50, exported from core) as `{ recordId, fields }`, so the job page names records without the result growing with the entity;
- `omitted` is `count - records.length`.

The schema enforces the cap and whole, non-negative counts. One object, rather than two fields, means a count can't appear without its list (PR #770 review). The key is absent on a clean run, so existing results and consumers are unchanged, as with `mirrorDegraded`. The `logger.warn` stays and now names the same records. The job's status stays `completed`: the data is correct, because the refused geometry is the one the sync already refused (#316), and the result describes the degradation.

## Plan — 1 slice

**Files**
- Edit: `packages/core/src/models/job.model.ts`: the `geometryRejected` object and the cap constant, with JSDoc.
- Edit: `apps/api/src/queues/processors/revalidation.processor.ts`: collect `{ recordId, fields }` from each batch's refusals up to the cap, set `geometryRejected` when the count is above zero, and name the records in the warn log.

**Tests** (`npm run test:unit` from `packages/core` and `apps/api`, filtered)
- `apps/api/src/__tests__/queues/processors/revalidation.processor.test.ts`:
  - a run with refusals returns `geometryRejected` naming each record and its fields, and the log names them too;
  - 120 refusals: `count` 120, `omitted` 70, 50 records;
  - the schema refuses a list over the cap;
  - a clean run has no `geometryRejected` key.
- Core: the schema parses a result with and without the fields (`job.model` tests, if one covers the result schemas; else the processor test parses through `RevalidationResultSchema`).
- `revalidation.integration.test.ts` stays green.

## Smoke (manual, against your dev stack)

1. On an entity with a geometry mapping, give one record a geometry the audit refuses in its stored `data`, e.g. set `data.geometry` to `"nope"` through `psql`, since every API write path refuses it (#757). Run **Re-validate All**. On **Jobs → that job**, the result shows `geometryRejected: { count: 1, omitted: 0, records: [{ recordId: <id>, fields: ["geometry"] }] }`, and the job reads completed.
2. Run **Re-validate All** on an entity with no refused geometries. The result has no `geometryRejected` key.

## Out of scope

- A purpose-built UI for the result: the job page renders the JSON, like sync's `mirrorDegraded`.
- The `errors` list growing with the number of invalid records: pre-existing and separate.
- Refused geometries in sync, which already reports its own rejections (#316).
