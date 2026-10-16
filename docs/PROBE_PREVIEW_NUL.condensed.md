# REST probe preview strips U+0000 — Condensed design (#810)

**Issue:** [EnterpriseBT/portal-ai#810](https://github.com/EnterpriseBT/portal-ai/issues/810) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** #805 strips U+0000 from REST records on their way into `entity_records` (`toStorableRecord`), but the connector workflow's **Probe & review** step infers columns from the raw records. So its SAMPLE column shows values with an invisible NUL that a sync won't store (`Al\u0000ice`, `b\u0000`). The same raw input reaches column inference, so a NUL in an upstream **key** yields a column whose `key`/`sourceField` contains the NUL. That key would never match the stripped key a sync writes, and any request that later carries it (a field mapping built from the probe) is refused by #805's boundary middleware (`400 REQUEST_INVALID_CHARACTERS`). Smoke step 4 checks that the commit goes through. `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Probe pipeline | `apps/api/src/adapters/rest-api/rest-api.adapter.ts:1469` (`runProbePipeline`) | Every probe path goes through it |
| Raw records into inference | `rest-api.adapter.ts:1524–1525` | `fetched.records.slice(0, MAX_RECORDS_SCANNED)` → `inferColumns(scanned)` |
| Samples to the AI classifier | `rest-api.adapter.ts:1550` | `inference.samples[col.key]`, sent to the model |
| Samples to the client | `rest-api.adapter.ts:1593` | `samples: inference.samples[col.key]`, the SAMPLE column |
| Callers | `discoverColumnsWithSamples` (`:1610`), `probeEndpointDraft` (`:1630`), `discoverColumns` (`:1778`, via `discoverColumnsWithSamples`) | Post-commit discover, pre-commit draft probe, column list |
| Sync-side strip (#805) | `toStorableRecord` in `rest-api.adapter.ts` | `stripNulDeep` + plain-object spread, before source id and checksum |
| Raw preview pane | `previewEndpointPage` (`rest-api.adapter.ts`, after `:1680`) | Shows the upstream body as "Raw response (page 1)"; no inference. The client runs records-path / JSONata feedback on it and sends it back as `sampleResponse` to suggest-transform |
| Test connection | `testConnection` (`rest-api.adapter.ts:1327`) | Returns `fetched.records.slice(0, 5)` to the endpoint test dialog |
| Shared first-page fetch | `fetchFirstPage` (`adapters/rest-api/fetch-first-page.util.ts:177`) | Its only callers are the three previews above (test connection, probe, Preview pane); sync doesn't use it |

## Decision — strip once, in the shared first-page fetch (revised after code review)

Options:
- **Strip each column's samples when building the response.** Fixes the display only; keys and the classifier input keep the NUL.
- **Strip the scanned records before `inferColumns`.** Keys, types, samples, classifier candidates and the cached result all come from the same stripped records. This is exactly what a sync stores.

**Decision: strip the page in `fetchFirstPage`.** It returns `body` and `records` through `stripNulDeep` (`utils/nul-character.util.ts`), after the pagination iterator has inspected the raw response, so cursor and Link-header extraction are unaffected. Its only callers are previews, so every one of them now shows what a sync stores:
- **Probe & review:** samples, column keys, the classifier's input and the cached result.
- **Endpoint test dialog:** `testConnection`'s sample.
- **Preview pane:** the body, the client's records-path / JSONata feedback built on it, and the `sampleResponse` it sends to suggest-transform, which #805's boundary would otherwise refuse with a 400.

The count isn't surfaced: previews write nothing.

*Revised after code review.* The first cut stripped only in `runProbePipeline` and kept the Preview pane raw ("it's labelled the raw upstream response"). Review showed what that cost. Suggest-transform 400'd on such an endpoint, the test dialog still showed the NUL, and the Preview pane's extracted records disagreed with the Probe step's keys. A character the app will never store is exactly what this ticket stops showing, so the Preview pane is no longer an exception.

## Plan — 1 slice

**Files**
- Edit: `apps/api/src/adapters/rest-api/fetch-first-page.util.ts`: `fetchFirstPage` returns `body` and `records` NUL-stripped, after the iterator's inspection.
- Edit: `apps/api/src/__tests__/adapters/rest-api/fetch-first-page.util.test.ts`: body and records stripped (keys and values); body stripped when extraction is skipped (the Preview pane); a clean page unchanged.
- Edit: `rest-api.adapter.test.ts`, `testConnection` and `previewEndpointPage` blocks: a stripped sample, a stripped preview body.
- Edit: `apps/api/src/__tests__/adapters/rest-api/rest-api.adapter.test.ts`, in the `restApiAdapter.probeEndpointDraft` block (`:2011`):
  - Upstream `[{ id: "a", name: "Al\u0000ice" }, { id: "b\u0000", name: "Bob" }]`: the `name` column's samples are `["Alice", "Bob"]` and the `id` column's are `["a", "b"]`. No sample contains U+0000.
  - Upstream with a NUL in a key (`[{ id: "a", "na\u0000me": "x" }]`): the column key and `sourceField` are `name`.
  - With a stub classifier: its candidates' `sourceField` and `samples` carry no U+0000.
  - A stripped key colliding with an existing one (`{"na\u0000me": "first", name: "second"}`) resolves to `second`, the way a sync's `stripNulDeep` does.
  - A clean upstream's result is unchanged (the existing first case stays green).
- `cd apps/api && npm run test:unit -- --testPathPattern rest-api.adapter`, then `npm run lint && npm run type-check`.

## Smoke (manual, against your dev stack)

1. Run the mock from #810's repro: `node -e 'require("http").createServer((q,r)=>{r.setHeader("content-type","application/json");r.end(JSON.stringify({items:[{id:"a","na\u0000me":"Al\u0000ice"},{id:"b\u0000","na\u0000me":"Bob"}]}))}).listen(4805)'`
2. Connectors → Catalog → REST API, base URL `http://localhost:4805`; add an endpoint (path `/`, records path `items`, id field `id`); go Next to **Probe & review**.
3. The SAMPLE column reads `a, b` and `Alice, Bob`, and the source fields read `id` and `name` (no stray character; Playwright: `innerText` has no `\u0000`).
4. Next → Commit → the connector commits without a `400 REQUEST_INVALID_CHARACTERS`. Its first sync completes with `nulStrippedValues`, and the records read `a` / `Alice`, `b` / `Bob` under a `name` mapping.
5. The Add-endpoint form's **Preview** pane shows the body without the NUL (`name: "Alice"`, `id: "b"`); its "Extracted via items" list matches the Probe step's keys.
6. In the same form, switch to transform mode and click **Suggest**: the suggest-transform request answers 200, not `400 REQUEST_INVALID_CHARACTERS` (needs the AI classifier configured; otherwise record that).
7. On the committed connector, open an endpoint's **Test** dialog: the sample reads `id: "b"`, `name: "Bob"` with no NUL.

## Out of scope

- Surfacing a strip count on the probe result. The probe writes nothing; the sync's `nulStrippedValues` reports what was changed when data is stored.
- Other connectors' previews. Spreadsheet previews already read from the stripped workbook cache (#805).
