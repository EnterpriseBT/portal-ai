# API connector — Phase 4 — Spec

**Replace phase 1's manual "user declares columns" step with a hybrid probe-then-review flow: when the user lands on the column-mapping step, the adapter fires a single page-1 fetch against each configured endpoint, infers a column schema from the first records, and the UI renders an editable table the user reconciles before commit. Probe responses are cached for 60 seconds to keep navigation snappy; nested fields fall back to JSONB columns; mixed-type or all-null fields fall back to `string`.** After this phase, configuring a 30-field SaaS endpoint takes one click instead of 30 manual field-mapping rows. Users who have existing manually-declared mappings (from phase-1 workflows) keep them; new endpoints default to probe-driven inference.

Discovery: `docs/API_CONNECTOR.discovery.md`. Phases 1–3: `docs/API_CONNECTOR_PHASE_{1,2,3}.{spec,plan}.md`.

Resolved phase-4 decisions:

- **Probe fires per-endpoint, on demand.** Specifically: when the user navigates to the probe-review step, the frontend fires one `discoverColumns` call per configured endpoint in parallel. Adding an endpoint in step 2 does *not* trigger an immediate probe — adding an endpoint is a config action; probing is an inference action gated on the user's progression through the workflow.
- **Cache shape: in-process Node `Map<connectorEntityId, { result, expiresAt }>`** with 60-second TTL, pruned lazily on read. Not Redis — the TTL is short, the cardinality bounded by configured endpoints, and the workflow's navigation pattern is local to one user's session anyway. Restart wipes the cache; that's acceptable.
- **Sample size for inference: first page of records, capped at 25.** If phase-3 pagination is configured (e.g., `pageSize: 100`), the probe still uses only page 1 and slices to 25. If `pagination: "none"` returns 1000 records, the probe also slices to 25. Inference quality past 25 records is marginal; cost of fetching more is real.
- **Inference is type-only, not semantic.** Phase 4 maps JSON values to `ColumnDataType` enum members (string, number, boolean, json). Date detection, currency parsing, ID-format inference, etc. are deliberately out. Users see the inferred type and override it through the standard dropdown if they want something more specific (date, currency).
- **Nested objects + arrays → `json` column type.** The wide-table reconciler already handles JSONB columns; the column-inference util emits `json` for any non-scalar value at the top level of a record. Decision 2's "flatten to a JSONB column" applies here: the column is a single JSONB cell whose value is the original nested object/array verbatim.
- **Mixed scalar types collapse to `string`.** If 24 records have `age` as `number` and 1 has it as `string`, infer `string`. Same if any record has a value of the wrong type for the consensus. Conservative — prefer no data loss to clever coercion.
- **All-null / all-missing fields default to `string`.** Most heterogeneous APIs treat optional fields as null-or-string-or-missing; defaulting to `string` is the least-surprising choice.
- **Existing field_mappings are not overwritten.** When the probe-review step opens for an endpoint that already has field_mappings (typical for phase-1-era endpoints being edited), the UI shows the inferred columns *alongside* the existing mappings, with the existing ones marked as "already configured." User can adopt, override, or ignore inferences.
- **Re-probe button.** The probe-review step exposes a per-endpoint "Re-probe" button that invalidates the cache for that endpoint and re-fires. Useful for drift cases where the endpoint's shape changed since the last cached probe.
- **Empty-records and inference-failure paths fall back to manual entry.** If the probe returns 0 records or every record is a primitive (not an object), the UI degrades to the phase-1 manual entry shape ("Add column" button). No error.

After this phase: the workflow flow becomes Basics → Endpoints → Probe-review → Review. The probe-review step is the entire user-facing column-mapping experience — phase-1's `FieldMappingsStep` (which embedded the existing `FieldMappingsTable` module) goes away from this workflow (the module itself stays — other connectors still use it).

---

## Scope

### In scope

1. **`inferColumns` util** (`apps/api/src/adapters/rest-api/inference.util.ts`, new) — pure function that takes a record array and emits `DiscoveredColumn[]` plus a per-column sample-value map. Implements the inference rules in *Concept changes* below.
2. **`ProbeCache`** (`apps/api/src/adapters/rest-api/probe-cache.util.ts`, new) — tiny in-process cache with 60-second TTL, `get(key)` + `set(key, value, ttlMs?)` + `invalidate(key)`. Pure modulo `Date.now()`.
3. **`RestApiAdapter.discoverColumns` implementation.** Replaces the phase-1 stub that returned `[]`. Flow:
   1. Resolve the endpoint config by `entityKey`.
   2. Cache lookup keyed by `connectorEntityId`; cache hit returns immediately.
   3. Cache miss: drive the phase-3 pagination iterator for exactly one page (`.next()` once, then discard the iterator). Apply auth + templating + retries as the rest of the adapter does.
   4. Walk `recordsPath`; slice to 25 records.
   5. `inferColumns(records)` → `{ columns, samples }`.
   6. Cache the result; return.
4. **`discoverColumns` route surface.** Two route options here (resolved below in *Surface*): either widen the shared `/test-connection` route to optionally return inference, or add a dedicated `POST /:id/api-endpoints/:entityId/discover-columns`. **Lean: dedicated route.** Test-connection (phase 2) is for connectivity validation; probe is for schema inference. Same underlying machinery (single page fetch) but different intent, different cacheability, different consumers.
5. **`DiscoverColumnsResult` Zod schema** in `packages/core/src/contracts` — `{ columns: DiscoveredColumn[], samples: Record<string, unknown[]>, source: "cache" | "live", recordsScanned: number }`. `source` lets the UI surface a "cached 38s ago" hint; `recordsScanned` carries the actual count probed (e.g., 25 when capped, or fewer if the endpoint returned less).
6. **Shared adapter helper: `fetchFirstPage`** (`apps/api/src/adapters/rest-api/fetch-first-page.util.ts`, new) — pulls out the "drive iterator once, get records out" code that both `testConnection` and `discoverColumns` use. Reduces duplication; keeps one place to fix auth/template/retry behavior for probe-shaped calls.
7. **Frontend `ProbeReviewStep`** (`apps/web/src/workflows/RestApiConnector/ProbeReviewStep.component.tsx`, new) — replaces `FieldMappingsStep` in the workflow. Per-endpoint section showing:
   - Loading state (probe in flight).
   - Inferred columns table — one row per column with editable `normalizedKey`, `type` (dropdown), `required` (checkbox), `sample value` (read-only preview); a "Re-probe" button to invalidate cache and refire; an "Add column" button for manual additions.
   - Error state with fallback-to-manual button.
   - Empty state (probe returned no records) with the same manual-entry affordance.
8. **Frontend SDK addition** — `useDiscoverColumns()` on `sdk.apiConnector.endpoints` via `useAuthMutation` against the new route. Triggered by `ProbeReviewStep` on mount and on Re-probe click.
9. **Workflow integration changes.** `RestApiConnectorWorkflow.component.tsx` swaps `FieldMappingsStep` → `ProbeReviewStep`. The commit-time payload writes one `field_mapping` per row that survived review (same `POST /api/field-mappings` flow that phase 1 used).
10. **Existing-mappings reconciliation.** When `ProbeReviewStep` opens for an endpoint with existing `field_mappings` (loaded via `sdk.fieldMappings.list(entityId)`), the UI overlays them on the inferred columns:
    - Matching `sourceField` between inferred + existing → existing wins (already configured); inferred type is shown as an advisory diff if different.
    - Inferred-only → marked "new from probe" with an Adopt button.
    - Existing-only → preserved as-is.
11. **Tests** — `inferColumns` unit tests (the full inference matrix), `ProbeCache` tests, `discoverColumns` adapter integration test, route test, frontend ProbeReviewStep tests covering all four states (loading / success / error / empty).

### Out of scope

- **Probe-on-sync drift detection.** Out of v1 per discovery's "what this doesn't decide" — re-probe on drift is a follow-up.
- **Date / enum / format inference.** Phase 4 only emits the scalar `ColumnDataType` members. Smarter inference is a v2 polish.
- **Cross-page schema differencing.** Probe uses only page 1; if pages 2–N have different shapes, the user catches it in review or in production. Documenting this explicitly so a future ticket can pick it up.
- **Probe persistence.** Cache is in-process; no DB-backed cache table. The 60-second window is meant to absorb tab-switching navigation, not to survive a worker restart.
- **Streaming inference.** The probe runs on the buffered response (same path as the sync). Lifting the per-response 50 MB cap is tracked in #72.

---

## Concept changes

### Inference rules

Given `records: unknown[]` (already sliced to ≤ 25):

1. If `records.length === 0` → return `{ columns: [], samples: {} }`. Caller (UI) renders the empty state.
2. If any record is a non-object (`typeof !== "object"` or `Array.isArray`) → return `{ columns: [{ key: "value", label: "Value", type: "json", required: false }], samples: { value: records.slice(0, 5) } }`. The whole record is treated as one column.
3. Otherwise, collect the union of all top-level keys across records. For each key:
   - Gather values from every record (undefined-for-missing → null).
   - Classify each value: `null` (or undefined), `string`, `number`, `boolean`, `object` (includes arrays).
   - Compute the type per the truth table below.
4. Emit one `DiscoveredColumn` per key. Per-column samples: the first 5 distinct non-null values from across records (preserving insertion order).
5. `required` flag: `true` if every record has a non-null value at this key; `false` otherwise.

| Observed value classes (after filtering nulls/missing) | Inferred `ColumnDataType` |
|---|---|
| Only `string` | `string` |
| Only `number` | `number` |
| Only `boolean` | `boolean` |
| Only `object` (object or array) | `json` |
| Mixed scalars (any two of string/number/boolean) | `string` |
| Mixed scalar + object | `json` |
| All values null/missing | `string` |
| No values (empty key — shouldn't happen) | `string` (defensive) |

### Cache semantics

- Key: `connectorEntityId` (one cache entry per endpoint, not per instance).
- TTL: 60 seconds from `set` time. `get` returns null on miss or after expiry.
- Invalidation: explicit on Re-probe (frontend → route → adapter calls `cache.invalidate(connectorEntityId)` before the new probe runs).
- Lifecycle: cache lives for the lifetime of the Node process. No background pruning — expired entries are removed lazily on the next `get` for that key.
- Concurrency: if two parallel probe requests for the same endpoint arrive within the TTL, both fire (no in-flight deduplication). Acceptable at v1 scale; in-flight dedup is a v2 polish if it ever matters.

### Workflow flow change

Phase 1 workflow:
```
Basics (none-auth)  →  Endpoints  →  Field mappings (manual)  →  Review
```

Phase 4 workflow (after slice 5 lands):
```
Basics (all auth)   →  Endpoints  →  Probe-review (auto-probe; manual fallback)  →  Review
```

The Endpoints step is unchanged in this phase; the Field-mappings step is removed; the Probe-review step takes its place.

---

## Surface

### `inferColumns` util

**File:** `apps/api/src/adapters/rest-api/inference.util.ts` (new)

```ts
import type { DiscoveredColumn, ColumnDataType } from "@portalai/core/models";

export interface InferenceResult {
  columns: DiscoveredColumn[];
  samples: Record<string, unknown[]>;       // up to 5 non-null sample values per column key
}

export const MAX_RECORDS_SCANNED = 25;
export const MAX_SAMPLES_PER_COLUMN = 5;

export function inferColumns(records: unknown[]): InferenceResult {
  // 1. Empty / non-object records → see Concept changes §Inference rules.
  // 2. Collect union of top-level keys.
  // 3. Per key, classify value types, apply the truth table.
  // 4. Emit DiscoveredColumn + sample list.
}
```

### `ProbeCache`

**File:** `apps/api/src/adapters/rest-api/probe-cache.util.ts` (new)

```ts
export interface CacheEntry<T> {
  value: T;
  expiresAt: number;       // epoch ms
}

export class ProbeCache<T> {
  constructor(private defaultTtlMs: number = 60_000) {}

  get(key: string): T | null;
  set(key: string, value: T, ttlMs?: number): void;
  invalidate(key: string): void;
  size(): number;          // debug-only; not part of the contract
}
```

One singleton per process, instantiated in the adapter registry alongside `RestApiAdapter` and injected through its constructor.

### `RestApiAdapter.discoverColumns`

Replaces the phase-1 stub. Signature unchanged (per `ConnectorAdapter`):

```ts
async discoverColumns(
  instance: ConnectorInstance,
  entityKey: string
): Promise<DiscoveredColumn[]> {
  // 1. Resolve endpoint config by entityKey.
  // 2. Cache lookup by connectorEntityId.
  // 3. Cache miss: fetchFirstPage(endpoint, instance, credentials).
  // 4. walkRecordsPath + slice to MAX_RECORDS_SCANNED.
  // 5. inferColumns(records).
  // 6. Cache { columns, samples }; return columns.
}
```

Sample values are cached alongside but `discoverColumns`'s return type only exposes `columns` (per the existing interface). The new `discoverColumnsWithSamples` method (or the route's response builder) reads from the cache to enrich the wire payload.

### `fetchFirstPage` helper

**File:** `apps/api/src/adapters/rest-api/fetch-first-page.util.ts` (new)

```ts
export async function fetchFirstPage(
  endpoint: { entity: ConnectorEntity; config: ApiEndpointConfig },
  instance: ConnectorInstance,
  credentials: ApiCredentials | null,
  vars: TemplateVariables = { cursor: "", pageNumber: 1 }
): Promise<{ records: unknown[]; rawPage: FetchedPage }> {
  // Drives the configured pagination iterator's first iteration only.
  // Returns the parsed records + the raw fetched page (so callers
  // doing extra inspection — testConnection's diagnostics, e.g. —
  // can read headers/status). Auth + template + retry applied via
  // the same plumbing as syncInstance.
}
```

Used by both `testConnection` and `discoverColumns`. Replaces inline duplicated code in those methods.

### New route: `POST /api/connector-instances/:id/api-endpoints/:entityId/discover-columns`

| Method | Path | Body | Response | Error codes |
|---|---|---|---|---|
| `POST` | `/discover-columns` | `{ forceRefresh?: boolean }` | `DiscoverColumnsResult` | `REST_API_ENDPOINT_NOT_FOUND`, `INSTANCE_NOT_FOUND`, `REST_API_FETCH_FAILED`, `REST_API_AUTH_FAILED`, `REST_API_RESPONSE_TOO_LARGE`, `REST_API_INVALID_JSON`, `REST_API_RECORDS_PATH_NOT_FOUND`, `REST_API_RECORDS_PATH_NOT_ARRAY` |

`forceRefresh: true` → adapter's cache is invalidated for this entity before the probe runs (powers the Re-probe button). Default `false` honors cache.

Response shape (also Zod-validated):

```ts
{
  columns: DiscoveredColumn[];
  samples: Record<string, unknown[]>;        // keyed by column.key
  source: "cache" | "live";
  recordsScanned: number;                    // 0..MAX_RECORDS_SCANNED
  cachedAt?: number;                         // epoch ms; only when source === "cache"
}
```

### Frontend `ProbeReviewStep`

**File:** `apps/web/src/workflows/RestApiConnector/ProbeReviewStep.component.tsx` (new — container + `ProbeReviewStepUI` pair)

Top-level component renders a list of per-endpoint sections. Each section is itself a small component:

- `EndpointColumnReview.component.tsx` (new) — one section per endpoint. Wires `useDiscoverColumns(instanceId, entityId)` on mount, renders the right state.
- `InferredColumnsTable.component.tsx` (new) — table with editable rows (normalized key, type, required, sample preview).

Container state holds per-endpoint draft column lists; commit-time it materializes them as field-mapping inserts.

### Frontend SDK addition

**File:** `apps/web/src/api/api-connector.api.ts` (edit)

- `useDiscoverColumns()` — `useAuthMutation` against `POST .../discover-columns`. Mutation rather than query because the call has side effects (cache lookup + potential network fetch + cost), and because `forceRefresh: true` is a meaningful imperative trigger.

### Removed in this phase

- `apps/web/src/workflows/RestApiConnector/FieldMappingsStep.component.tsx` (deleted — its functionality is absorbed into the probe-review step's manual-entry fallback).
- The corresponding test + story files.

---

## Failure modes

| Failure | Surface | User-facing copy |
|---|---|---|
| Probe returns 0 records | `DiscoverColumnsResult` with empty `columns` array | (Inline UI) "No records returned by the endpoint. Add columns manually below." + Add-column button. |
| Probe returns records that aren't objects (e.g. all strings) | `columns: [{ key: "value", type: "json", … }]` | (Inline) "Records aren't structured as objects; storing each record as a JSON blob. Configure differently below if needed." |
| Probe 4xx / 5xx | Existing `REST_API_FETCH_FAILED` / `REST_API_AUTH_FAILED` | (`<FormAlert>` in the endpoint's section) error code + message + Retry button. Falls back to manual entry. |
| Probe times out | `REST_API_FETCH_FAILED` with `details.cause: "timeout"` | Same as above. |
| Probe trips the 50 MB cap | `REST_API_RESPONSE_TOO_LARGE` | "Endpoint returned > 50 MB on probe. Configure pagination with a smaller page size, or wait for streaming support (#72)." |
| User clicks Re-probe twice rapidly | Both requests fire (no dedup); the later wins (UI shows the later result) | (No surfaced copy; the rapid-click race is acceptable.) |
| Endpoint config invalid (no pagination, no recordsPath) | Per phase 1/3 validation; the probe route 400s | "Endpoint config is invalid — fix it in the Endpoints step." |

---

## What this phase doesn't decide

- **Probe on a schedule.** v1 only probes on demand (workflow navigation or Re-probe button). Scheduled drift checks against a stored "last known schema" are a v2 follow-up.
- **Saved inferences across sessions.** The cache is in-process. The user's reviewed-and-adopted columns persist as `field_mappings`; the *probe result* itself does not. A future ticket could persist probes to a `discovered_columns` table for inspection / diffing — out of scope here.
- **Concurrency dedup for parallel probes.** If two browser tabs probe the same endpoint within the TTL, both fire. Acceptable at v1 scale.
- **Sample-value privacy.** Probe responses may contain PII; samples are stored in the cache (in-process memory only) and surfaced in the UI. v1 trusts that the user driving the workflow is authorized to see the endpoint's data. A future ticket could add a "blur samples" mode for screen-sharing scenarios.
- **Cross-endpoint column reuse.** If two endpoints have overlapping fields (`id`, `created_at`), phase 4 infers them independently per endpoint. Sharing column definitions across endpoints is already a `column_definitions` concern handled elsewhere; this phase doesn't touch that pipeline.

---

## Next step

Phase 4 plan: `docs/API_CONNECTOR_PHASE_4.plan.md`. Slicing target: ~7 slices — `inferColumns` first (leaf, biggest test surface), `ProbeCache` second (leaf), `fetchFirstPage` helper third (leaf — also retroactively refactors `testConnection`), `discoverColumns` adapter implementation fourth, new route + SDK hook fifth, frontend `ProbeReviewStep` + sub-components sixth, end-to-end test + workflow swap-in seventh.

After phase 4 lands, PR #71 is ready-for-review and the feature ships when merged. No phase 5.
