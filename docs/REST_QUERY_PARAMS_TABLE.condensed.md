# REST API connector: query-params table — Condensed design (#808)

**Issue:** [EnterpriseBT/portal-ai#808](https://github.com/EnterpriseBT/portal-ai/issues/808) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** An endpoint's query string can only be typed into **Path** (`/foo?a=b&c=d`), so users hand-encode `&`, `=`, `#`, spaces and `+`, and a stray `&` silently splits a value. The record-total probe's **Count query params** is the same raw `a=b&c=d` box. The contract already supports structured params: `config.queryParams` and `totalCount.queryParams` are `Record<string, string>`. The adapter's `buildUrl` encodes them with `URLSearchParams.set`, and `{{cursor}}` / `{{pageNumber}}` substitute into them. The wizard never sets the endpoint's. This adds a reusable key/value table and binds both to it. `apps/web` only; the core model, API and migrations are unchanged.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Endpoint draft + form | `workflows/RestApiConnector/ApiEndpointForm.component.tsx:36` (`EndpointDraft`), `:205` (`field("path", …)`), `:411` (`totalCountParams` text field) | Draft is flat strings; `totalCountParams: string` |
| Draft → config on create | `RestApiConnectorWorkflow.component.tsx:~630` | Builds `config` inline; `totalCountDraftToConfig` parses the count string with `URLSearchParams` |
| Draft → config for preview / probe / probe hash | `RestApiConnectorWorkflow.component.tsx:862` `projectEndpointForHash` | Carries **no params at all** today, so the new params must flow through it or preview and probe won't send them |
| Validation | `utils/rest-api-validation.util.ts:258` `validateEndpoint`, `:125` `totalCountDraftToConfig` | `validateWithSchema(ApiEndpointConfigSchema, …)` plus field checks |
| Endpoint edit list | `EndpointsStep.component.tsx:154` `onEdit` | Re-opens a **draft** in the wizard |
| Saved-endpoint editing | `api/api-connector.api.ts:115` `endpoints.update` | Exists in the SDK, but **no UI calls it**: saved endpoints aren't editable anywhere |

## Decision — draft shape and where the logic lives

The params become rows: `KeyValueRow = { id, key, value }`, with `id` a stable React key. `EndpointDraft.queryParams: KeyValueRow[]` is new, and `totalCountParams` changes from `string` to `KeyValueRow[]`. The row type and the generic row helpers (`newKeyValueRow`, `keyValueRowsToRecord`, `validateKeyValueRows`) live in `apps/web/src/utils/key-value-rows.util.ts`, because #809's headers table reuses them. The REST-specific ones live in `rest-api-validation.util.ts`:
- `splitPathQuery(path)`: `{ path, rows }`, decoding through `URLSearchParams`.
- `queryParamsConfig(rows)`: `{ queryParams }` for the create body and the preview/probe request, or nothing when no row survives (fully empty rows are dropped).
- `validateKeyValueRows(rows, field)` (shared): returns `FormErrors` keyed `<field>.<i>.key`.
  - A value with no key is an error ("Key is required").
  - A duplicate key is an error on the later row ("Duplicate key").
- `previewRequestUrl(path, rows)`: the encoded `path?k=v`, with `{{cursor}}` / `{{pageNumber}}` restored unencoded.

Both `projectEndpointForHash` and the create mapping add `queryParams`, so a params edit changes the probe hash and re-probes, exactly as a path edit does.

## Decision — the "existing endpoint with `?`" criterion

No UI edits a *saved* endpoint, so the PRD's on-open migration can only apply to a draft re-opened in the wizard. Splitting on paste/blur already keeps `?` out of drafts. The migration still runs when the form opens (`splitPathQuery` on the initial draft), which is cheap and covers any draft with `?` from before the change. Saved endpoints keep working as they are, because the API stays tolerant of `?` in `path`. When an edit surface for saved endpoints ships, it reuses this same open-time split.

## Decision — the table component

`components/KeyValueTable.component.tsx` exports `KeyValueTableUI` (pure, single export), a general primitive under `components/` because #809's headers table reuses it.
- **Props:** `rows`, `onChange`, `onBlurRow`, `errors` + `touched` (keyed by row index), and `keyLabel` / `valueLabel` / `addLabel` / `emptyHint`.
- **Each row:** two `TextField`s with `aria-invalid` and `helperText`, plus a remove `IconButton` with `aria-label="Remove parameter <key>"`.
- **Below the rows:** an `Add parameter` button (`type="button"`). The empty state is just that button and a one-line hint.
- **Enter:** Enter in a field follows the `Modal`'s rules: it submits only when Save could, and never adds a row.

## Plan — 2 slices

1. **Table + helpers.**
   - New: `components/KeyValueTable.component.tsx`, `stories/KeyValueTable.component.stories.tsx`, `__tests__/KeyValueTable.component.test.tsx` (add, remove, edit, the error and `aria-invalid`, accessible remove names, Enter doesn't add a row).
   - Helpers, with tests in `workflows/RestApiConnector/__tests__/rest-api-validation.util.test.ts`:
     - `splitPathQuery` splitting and decoding, including `%26` and `+`;
     - the encode round trip of `a&b=c d#e` and `100%`;
     - template tokens left unencoded in the preview;
     - duplicate and key-less rows; empty rows dropped.
2. **Wire into the endpoint form.**
   - **Query parameters** section under Path, with the preview line under it.
   - The count table replaces the count text field.
   - Path paste/blur split, and the open-time split.
   - `validateEndpoint` gains both row validations.
   - Both config builders carry `queryParams`.
   - Copy: the Path placeholder (`/users`, no query string) and the count caption, so `returnCountOnly=true` now reads as a table row.
   - Tests in `__tests__/ApiEndpointForm.test.tsx` (UI): paste `?` → rows, a duplicate blocks Save, an opened `?` draft migrates. The workflow's create and preview builders both spread `queryParamsConfig`, which is tested in the util suite. The container itself has no test harness, so the mapping is tested where it lives.
   - Run: `npm run test:unit -- --testPathPattern "KeyValueTable|rest-api-validation|ApiEndpointForm|RestApiConnectorWorkflow"`, `type-check`, `lint`.

## Smoke (manual, against your dev stack)

1. Connectors → add a REST API connector with base URL `https://httpbin.org` and no auth.
2. Add an endpoint, paste Path `/anything?fooz=baz&foot=b%26t`. Path becomes `/anything`, with two rows: `fooz=baz` and `foot=b&t` (decoded).
3. Add a row `q` = `a&b=c d#e`. The preview line shows `/anything?fooz=baz&foot=b%26t&q=a%26b%3Dc+d%23e`.
4. Preview the endpoint. httpbin's echoed `args` show the three values exactly as typed, and its `url` shows them encoded.
5. Add a second `fooz` row. It errors inline as a duplicate, gets `aria-invalid`, and Save is blocked. Remove it, and each remove button reads "Remove parameter …" to a screen reader.
6. Set a count row `returnCountOnly=true` with count path `args.returnCountOnly`, then finish the wizard. The saved endpoint's `config.queryParams` holds the three rows and its `path` is `/anything` (check via `GET /api/connector-instances/:id/api-endpoints`).
7. Sync the connector. The request goes out with the params, and `{{pageNumber}}` in a value (if paginated) is substituted per page.

## Out of scope

- Repeated or array-valued keys (`ids=1&ids=2`), which would be a contract change. Request headers (#809). Server-side rejection of `?` in `path`. The API-key auth "query parameter" placement.
- An edit surface for saved endpoints (none exists; see the second decision).
