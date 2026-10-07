# Tool results the model sees are byte-capped — Condensed design (#726)

**Issue:** [EnterpriseBT/portal-ai#726](https://github.com/EnterpriseBT/portal-ai/issues/726) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** "Show me lowest contours on a map" failed with `prompt is too long: 2784899 tokens > 1000000`. Tool results reach the model **verbatim**: nothing in the stack projects them (no `toModelOutput` anywhere). The inline path is bounded by row count (`INLINE_ROWS_THRESHOLD = 100`), not bytes.

`visualize_map`'s inline branch goes further: it lifts every cap. `geoInlineRows` re-runs the SQL with `RAW_CAP` and returns up to 100 full GeoJSON polygons, so 100 contour polygons is millions of tokens. That payload is then re-sent on every later step of the turn (up to 10), and replayed in later turns by `reconstructModelMessages`, which also trims only by row count.

The widget legitimately needs the full rows; the model doesn't. `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Tool → model | `services/portal.service.ts:724-731` (`streamText`) | each tool's `execute` return goes to the next step as-is |
| Map inline | `tools/visualize-map.tool.ts:361-368` ← `tools/geo-delivery.util.ts:37-40,104-113` | rows re-run with `rowCap/cellCap/payloadCap = RAW_CAP`; the comment assumes ≤100 rows is bounded |
| Other inline | `sql_query` / `visualize_d3` via `PortalSqlService.runSqlQuery` (`portal-sql.service.ts:1032-1046`) | already cell-capped (500 B) and payload-capped (100 KB) |
| Sample cap | `services/portal-sql-response.util.ts:87-100` (`capSamplePeek`, #704) | per-cell 500 B plus a 100 KB total; pure |
| Every tool wrapped | `ToolService.buildAnalyticsTools` (`wrapWithCostGate`) | the one build-time choke point for built-in and custom tools; a guard test asserts it |
| Replay | `portal.service.ts` `reconstructModelMessages` (`:1014`), `capResultRows` (`:957`), `summarizeToolResult` (`:982`) | 2 recent turns full, 50 rows each; summaries `JSON.stringify` cells uncapped |
| Error to user | `portal.service.ts:748-760` → `stream_error` | the raw provider text reaches the user |

## Decision — project the model's view, at the choke points

Options:
- **(a)** Cap `geoInlineRows`. That breaks the map, which needs the full GeoJSON.
- **(b)** Per-tool `toModelOutput` on `visualize_map`. That fixes one tool, and the next one regresses.
- **(c)** One projection, `toModelView(output)`, applied as `toModelOutput` by the build-time wrap every tool already passes through, **and** in replay.

**Chosen: (c).** The stream (SSE), persistence and the widget keep the full result; only what the model reads is bounded.

`toModelView` (new `services/model-output.util.ts`):
- **Small output:** if serialized output is ≤ `MODEL_OUTPUT_MAX_BYTES` (100 KB, the same budget as `payloadCap`), it is returned unchanged. Every tool that's fine today stays byte-identical.
- **Large output with a `rows` array:** `rows` is replaced by `rowCount` plus `samplePeek: capSamplePeek(rows)`, and a one-line `note` says the rows were omitted for the model and the user sees the full result. Other fields (`type`, `spec`, `pipeline`, `title`, `schema`) are kept, with their string cells capped the same way.
- **Anything else large:** `{ truncated: true, originalBytes, preview }`, where `preview` is the first 2 KB of the JSON.

Wiring:
- The wrap sets `toModelOutput: ({ output }) => ({ type: "json", value: toModelView(output) })` on every tool, next to `wrapWithCostGate`, and the existing guard test asserts it is present.
- `reconstructModelMessages` passes each replayed tool result through `toModelView` before its existing row trim, and `summarizeToolResult` caps cells.

## Plan — 2 slices

**Slice 1: projection + live wiring.**
- **Files:** new `services/model-output.util.ts`; edit `services/tools.service.ts` (the wrap) and the build-wrap guard test.
- **Tests:** new `__tests__/services/model-output.util.test.ts`:
  - small output unchanged;
  - 100 contour-sized GeoJSON rows → under 100 KB, with `rowCount`, `samplePeek` and `spec`/`pipeline` intact;
  - a non-rows giant → `truncated`.
- Extend `__tests__/tools/visualize-map.tool.test.ts` (inline): `execute` still returns the full rows, and the built tool's `toModelOutput` returns the capped view.

**Slice 2: replay.**
- **Files:** `services/portal.service.ts` (`reconstructModelMessages`, `summarizeToolResult`).
- **Tests:** extend `__tests__/services/portal.service.test.ts` `getPortal` coreMessages: a persisted geo block with huge geometry replays under the cap.

Run the touched tests with `npm run test:unit`, plus `type-check` and `lint`.

## Smoke (app-dev, after deploy)

1. In My Organization, ask "show me lowest contours on a map". The turn completes, the map renders the contours, and there is no "prompt is too long".
2. Ask a follow-up in the same portal ("which is the lowest?"). The replay stays under the limit and the agent answers.
3. A normal `sql_query` question answers as before.

## Out of scope

- A token pre-flight check on the whole prompt before calling the model. That's defence in depth; a separate ticket if wanted.
- Making the provider's error text friendlier for the user.
