# REST API connector — pre-commit probe + transform — Plan

**TDD-sequenced implementation of the pre-commit probe refactor + JSONata transform feature: server-side transform utility, endpoint config schema update (transform ↔ recordsPath mutual exclusion), `discoverColumnsWithSamples` factored into a shared inner pipeline, transform applied during probe + sync, new `probe-endpoint-draft` route, SDK hook + workflow auto-fire on step-3 entry, transform editor with live preview in `ApiEndpointForm`. After this PR the create flow shows real suggestions before commit and complex JSON responses are first-class.**

Discovery: `docs/REST_API_PRE_COMMIT_PROBE.discovery.md`. Standing on top of phase-4 (`docs/API_CONNECTOR_PHASE_4.{spec,plan}.md`), which landed the post-commit probe pipeline + classifier + UI components this plan reuses.

Eight slices, each behind a green test suite. Slices 1–4 are backend-only and add no user-visible change. Slice 5 lights up the new route. Slice 6 swaps the workflow into auto-fire mode (first user-visible change — step 3 now shows real suggestions in create flow). Slice 7 adds the transform editor in step 2. Slice 8 locks behavior with an end-to-end test.

Run tests with `npm run test:unit` (per repo convention — `npx jest` bypasses the `NODE_OPTIONS=--experimental-vm-modules` flag the ESM-deps need).

The slices are sequenced so that:

- **Slice 1** lands `applyTransform` (pure JSONata wrapper) — biggest unit-test surface in this PR. Pure leaf, no caller.
- **Slice 2** lands the endpoint config schema update — `transform` field + the `transform XOR recordsPath` refinement + drizzle-zod type-checks. Pure, no runtime caller.
- **Slice 3** factors `discoverColumnsWithSamples` into `buildProbeContext` + `runProbePipeline`. Pure refactor — existing post-commit route call site is rewired to use the factored helpers; no observable change.
- **Slice 4** wires `applyTransform` into the inner pipeline + the sync iterator. Probe and sync now both apply the transform when set; recordsPath-only endpoints unchanged. First slice where the transform actually does anything.
- **Slice 5** lands the new route + service + SDK type. Pre-commit probe is reachable but not yet called by the workflow.
- **Slice 6** swaps the workflow into auto-fire mode: step-3 entry triggers per-endpoint probes via the new SDK call; `reprobeDisabled` props drop; per-endpoint cache invalidation on config edit. First user-visible change.
- **Slice 7** lands the transform editor in `ApiEndpointForm` — collapsible "Advanced — transform" section, client-side JSONata live preview, mutual-exclusion validation.
- **Slice 8** lands the end-to-end integration test (mocked REST endpoint, both recordsPath and transform paths, classifier-disabled degradation, probe-failure-per-endpoint advancement, full commit) plus a manual smoke checklist for a real public API.

After every slice the repo type-checks, `npm run test:unit` is green, and (through slice 5) the workflow's user-visible behavior is unchanged.

---

## Slice 1 — `applyTransform` utility (server-side)

Pure JSONata wrapper. Biggest test surface in this PR. No caller yet.

**Files**

- New: `apps/api/src/adapters/rest-api/transform.util.ts`
- New: `apps/api/src/__tests__/adapters/rest-api/transform.util.test.ts`
- Modified: `apps/api/package.json` (add `jsonata` dep)

**Contract**

```ts
export interface TransformResult {
  records: unknown[];
  /** null on success; populated on parse / runtime failure. */
  error: { kind: "parse" | "runtime"; message: string } | null;
}

export async function applyTransform(
  expression: string,
  response: unknown,
): Promise<TransformResult>;
```

**Steps**

1. **Write the unit tests** for the full transform matrix:
   1. Empty / whitespace-only expression → `error.kind: "parse"`, `records: []`.
   2. Valid expression returning an array → `records` = the array, `error: null`.
   3. Discovery case 1 (`data.items` over `{ data: { items: [...] } }`) → records = the items array.
   4. Discovery case 2 multi-source union (`[active_users, archived_users].$$` over a response with both arrays) → records = concatenated list.
   5. Discovery case 3 projection (`data.{ "id": id, "user_name": user.name }`) → records = flattened.
   6. Discovery case 4 filter + project → records filtered + projected.
   7. Expression returning a single object (not an array) → records = `[result]` (wrap-to-array, documented in JSDoc).
   8. Expression returning a primitive (number / string / boolean) → records = `[{ value: <primitive> }]` (wrap-and-name, documented).
   9. Expression returning `null` / `undefined` → records = `[]`, `error: null`.
   10. Expression with a syntax error (e.g. `data.{`) → `error.kind: "parse"`, `records: []`, message includes the line/column.
   11. Expression that throws at runtime (e.g. divide-by-zero, `$now() / 0`) → `error.kind: "runtime"`, `records: []`.
   12. Expression evaluated against `null` response → `records: []`, `error: null`.
   13. Expression evaluated against a large response (e.g. 10 000 items) completes in < 100ms (perf smoke; uses fake timers to assert no hang).
   14. Expression cannot reach Node globals — assert `process`, `require`, `global`, `Buffer` all evaluate to `undefined` inside the expression context.
   Run; all fail.

2. **Add the dep.** `npm install jsonata --workspace=apps/api`. Lock to latest 2.x.

3. **Author the util.** Wrap `jsonata(expression).evaluate(response)`:
   - Parse errors surface via the constructor; runtime errors via `.evaluate()`.
   - Coerce result to `unknown[]` per the rules above (single object → `[obj]`; primitive → `[{ value: prim }]`; null/undefined → `[]`).
   - Catch + classify both error kinds; never throw.

4. **Run focused tests.** All 14 cases green.

5. **Lint + type-check.** Clean.

**Done when:** all 14 cases pass; no caller imports `applyTransform` yet.

---

## Slice 2 — Endpoint config schema + drizzle-zod alignment

Adds `transform` to the endpoint config; enforces mutual exclusion with `recordsPath`. No runtime caller — pure schema work.

**Files**

- Modified: `packages/core/src/models/api-connector.model.ts` (`ApiEndpointConfigBaseSchema` + `ApiEndpointConfigSchema`)
- Modified: `apps/api/src/db/schema/api-endpoints.table.ts` (if endpoint config is stored as a typed JSONB column with its own Drizzle-side schema; otherwise the JSONB column is opaque and the Zod schema is the only source of truth — confirm during the slice)
- Modified: `apps/api/src/db/schema/type-checks.ts` (compile-time assertion that the Drizzle column shape matches the Zod schema, per the repo's dual-schema policy)
- New: `packages/core/src/__tests__/models/api-connector.model.test.ts` cases for the new refinement (extend the existing test file if it exists)

**Steps**

1. **Write the schema tests** in `packages/core`:
   1. Config with `recordsPath: "data.items"` and no `transform` → parses.
   2. Config with `transform: "data.items"` and no `recordsPath` → parses.
   3. Config with `transform: "data.items"` and `recordsPath: ""` (empty string default) → parses (empty string counts as unset).
   4. Config with both `transform: "x"` and `recordsPath: "y"` (both non-empty) → fails with `path: ["transform"]` and a message naming both fields.
   5. Config with neither → parses (current behavior: empty `recordsPath` means "the response IS the array").
   6. Config with `transform: ""` (empty string) → parses, treated as unset.
   7. Config with `transform` longer than the (chosen) max length, e.g. 4096 chars → fails with size-limit message.
   Run; all fail.

2. **Update `ApiEndpointConfigBaseSchema`.** Add `transform: z.string().optional()`. Decide + document a max-length cap (4 KB is a sensible default — way more than a user-typed transform but caps abuse).

3. **Update `ApiEndpointConfigSchema`.** Layer a second `.refine` on top of the existing `bodyTemplate vs method` refine: `transform` and `recordsPath` must not both be non-empty.

4. **Drizzle-zod alignment.** If the endpoint config has Drizzle-side typing in `api-endpoints.table.ts`, add the `transform` column shape and the corresponding `IsAssignable` check in `type-checks.ts`. If config is stored as opaque JSONB the Drizzle side has no work; document this in the slice commit.

5. **No migration needed.** `transform` is a new optional field on a JSONB column. Existing rows have no `transform` key; that parses cleanly as `undefined`.

6. **Run tests.** All 7 cases green; existing schema tests still pass.

**Done when:** schema accepts the new field, refinement fires correctly, drizzle-zod checks compile.

---

## Slice 3 — Factor `discoverColumnsWithSamples` into shared inner pipeline

Pure refactor. Pulls "build adapter context → drive iterator one page → slice → infer → classify → tag degradation" out of the post-commit entry point and into reusable helpers. The existing route call site is rewired; behavior is unchanged.

**Files**

- Modified: `apps/api/src/adapters/rest-api/rest-api.adapter.ts` (extract helpers)
- Modified: `apps/api/src/__tests__/adapters/rest-api/rest-api.adapter.test.ts` (existing tests stay green; add one new test asserting the refactor)

**Contract**

```ts
interface ProbeContext {
  organizationId: string;
  endpointKey: string;
  config: { baseUrl: string; auth: AuthConfig };
  credentials: CredentialsPayload | null;
  endpoint: ApiEndpointConfig;
}

async function buildProbeContextFromInstance(
  instance: ConnectorInstance,
  endpointKey: string,
): Promise<ProbeContext>;

async function runProbePipeline(
  ctx: ProbeContext,
  opts: { forceRefresh?: boolean; cacheKey: string },
): Promise<DiscoverColumnsResult>;
```

`discoverColumnsWithSamples(instance, entityKey, opts)` becomes a one-liner that builds the context and delegates.

**Steps**

1. **Add a "refactor invariant" test.** Pick three existing scenarios from the adapter test suite (happy path, classifier-disabled, classifier-failure) and assert their outputs match snapshots. These act as the gate: anything the refactor breaks shows up here.

2. **Extract `buildProbeContextFromInstance`.** No behavior change. Existing call sites swap to it.

3. **Extract `runProbePipeline`.** Move the iterator-drive + slice + infer + classify body. Cache key stays `connectorEntityId` for the post-commit caller (no change yet).

4. **Rewire `discoverColumnsWithSamples`.** Two-line function. Existing tests must pass unchanged.

5. **Run the full adapter test suite.** Snapshots match; no other test churn.

**Done when:** the inner pipeline is reachable as a standalone helper; the post-commit route still works; no test changed except the new snapshot guard.

---

## Slice 4 — Apply transform in probe + sync

Wires `applyTransform` into `runProbePipeline` and into the sync iterator. Endpoints with `transform` set bypass `recordsPath`; endpoints with `recordsPath` only are unchanged. Failures classify as a degradation.

**Files**

- Modified: `apps/api/src/adapters/rest-api/rest-api.adapter.ts` (probe pipeline)
- Modified: `apps/api/src/adapters/rest-api/pagination/*.ts` or wherever the sync iterator unwraps pages (the place that currently walks `recordsPath`)
- Modified: `apps/api/src/__tests__/adapters/rest-api/rest-api.adapter.test.ts`

**Discovery decision recap.** Decision 10: mutually exclusive. Decision 12: both probe and sync apply the transform server-side. Degradation tag joins the existing `"llm-failed" | "llm-disabled" | null` shape — extend to `"llm-failed" | "llm-disabled" | "transform-failed" | null`.

**Steps**

1. **Write the integration tests against the adapter:**
   1. Endpoint with `recordsPath: "data.items"` and no `transform` → unchanged behavior (existing tests cover this).
   2. Endpoint with `transform: "data.items"` and empty `recordsPath` → records extracted via transform; inference runs on the transformed records.
   3. Endpoint with `transform` that produces a flat 25-record array from a nested response → AI classifier receives the flat records (assert on the classifier-stub's `candidates` arg).
   4. Endpoint with `transform` that has a parse error → `DiscoverColumnsResult` carries `degradation: "transform-failed"` + `recordsScanned: 0` + the error message in a new `transformError` field on the result; columns array is empty.
   5. Endpoint with `transform` that throws at runtime → same as above.
   6. Endpoint with `transform` that returns `[]` → `DiscoverColumnsResult` with `recordsScanned: 0`, no degradation (empty is a valid result, not a failure).
   7. Sync iterator (separate test): endpoint with `transform` yields transformed records page-by-page; the wide-table reconciler sees flat records.
   8. Sync iterator transform failure on a page: page fails with the existing adapter-error path; assert the sync job records the failure with `transform-failed` context.
   Run; all fail.

2. **Extend `DiscoverColumnsResult`.** Add `transformError?: { kind: "parse" | "runtime"; message: string } | null` and broaden `degradation` to include `"transform-failed"`. Adjust the Zod schema for the response type.

3. **Wire `applyTransform` into `runProbePipeline`.** Branch:
   - `transform` non-empty → call `applyTransform(transform, rawResponse)`. On error, return early with `degradation: "transform-failed"` + empty columns + the error message.
   - `transform` empty → fall through to the existing `recordsPath` walker.

4. **Wire `applyTransform` into the sync iterator.** Same branch shape; transform errors propagate as adapter errors that the sync processor already knows how to surface.

5. **Run the adapter + sync tests.** All 8 new cases pass; existing tests still pass.

**Done when:** transform-bearing endpoints work end-to-end through the post-commit `discoverColumns` route; `recordsPath`-only endpoints behave identically to today.

---

## Slice 5 — Probe-draft route + service + SDK type

New `POST /api/connector-instances/probe-endpoint-draft` route. Reuses the inner pipeline from slice 3; reuses the transform wiring from slice 4.

**Files**

- New: `apps/api/src/routes/connector-instances.router.ts` route handler (or new file `api-connector-probe-draft.router.ts` if the existing router is already crowded — confirm during the slice)
- Modified: `apps/api/src/adapters/rest-api/rest-api.adapter.ts` (add `probeEndpointDraft` that builds a `ProbeContext` from the request body instead of a DB row)
- Modified: `packages/core/src/models/api-connector.model.ts` (`ProbeEndpointDraftRequestBodySchema` + the existing response type)
- New: `apps/web/src/api/api-connector.api.ts` SDK call wiring (the existing `discoverColumns` lives here)
- Modified: `apps/api/src/__tests__/routes/api-connector.router.test.ts` (or the matching route test file)

**Body schema**

```ts
ProbeEndpointDraftRequestBodySchema = z.object({
  config: z.object({ baseUrl: z.string().url(), auth: AuthConfigSchema }),
  credentials: CredentialsPayloadSchema.nullable(),
  endpoint: ApiEndpointConfigSchema.extend({
    // probe doesn't need a persisted key/label, but we accept them for
    // future use and to keep the type aligned with the commit shape
    key: z.string().min(1),
    label: z.string().min(1),
  }),
});
```

`organizationId` comes from auth context, not the body.

**Steps**

1. **Write the route tests:**
   1. Authed POST with valid body + an endpoint that returns flat records → 200 with a `DiscoverColumnsResult` matching the post-commit shape.
   2. Unauthed POST → 401.
   3. POST with a body that violates `transform XOR recordsPath` (slice 2 refinement) → 400 with the Zod issues echoed.
   4. POST with `transform` that errors → 200 with `degradation: "transform-failed"` (same shape as the post-commit route).
   5. POST against an endpoint that's unreachable (mocked fetch throws) → 200 with `degradation: …` or the appropriate failure shape (mirror what the post-commit route does today).
   6. Credentials in the body are **never** persisted — assert by inspecting any audit-log writes or by capturing the credentials repository's `create` calls (none should fire).
   7. Cache key — fire two identical requests within 60 seconds; assert the second hits the cache (no second outbound HTTP). Cache key is `sha256(orgId + JSON.stringify(endpoint config + credentials))`.
   8. `forceRefresh: true` in the body bypasses the cache.
   Run; all fail.

2. **Add `probeEndpointDraft` on the adapter.** Builds a `ProbeContext` from the request body using `auth.util`, calls `runProbePipeline` with the derived cache key.

3. **Add the route handler.** Body validation via `ProbeEndpointDraftRequestBodySchema.safeParse`. Auth via the existing middleware. Logging at route + service per the API style guide.

4. **Add the SDK call.** Mirror `discoverColumns` shape:

   ```ts
   sdk.apiConnector.endpoints.probeDraft.useAuthMutation(...)
   ```

5. **Run the route tests.** All 8 cases green.

**Done when:** an SDK consumer can call `probeDraft({ config, credentials, endpoint })` and get suggestions back; the workflow doesn't call it yet.

---

## Slice 6 — Workflow auto-fires probe on step-3 entry

First user-visible change. The create flow's probe-review step now shows real suggestions.

**Files**

- Modified: `apps/web/src/workflows/RestApiConnector/RestApiConnectorWorkflow.component.tsx`
- Modified: `apps/web/src/workflows/RestApiConnector/ProbeReviewStep.component.tsx` (drop `reprobeDisabled` / `reprobeDisabledHint` props)
- Modified: `apps/web/src/workflows/RestApiConnector/EndpointColumnReview.component.tsx` (same prop drop)
- Modified: `apps/web/src/workflows/RestApiConnector/__tests__/RestApiConnectorWorkflow.test.tsx` (or whatever the workflow's existing test file is named)
- Possibly modified: SDK keys file for the new mutation

**State shape (container-side)**

```ts
type EndpointProbeState =
  | { kind: "idle" }
  | { kind: "loading"; hash: string }
  | { kind: "success"; hash: string; result: DiscoverColumnsResult }
  | { kind: "error"; hash: string; serverError: ServerError };

const [probeStateByKey, setProbeStateByKey] = useState<Record<string, EndpointProbeState>>({});
```

`hash` is `sha256(JSON.stringify(endpoint config + auth + credentials))` — stale when the user edits step 2. Re-fire fires for endpoints whose `hash !== probeStateByKey[key].hash`.

**Steps**

1. **Write workflow tests:**
   1. Mount workflow with two endpoints; advance to step 3; assert the SDK `probeDraft` mutation fires twice (once per endpoint) in parallel.
   2. Probe returns success → `EndpointColumnReview` for that endpoint renders `state: "success"` with inferred rows + suggestion chips.
   3. Probe returns failure for one endpoint → that section renders `state: "error"`; the OTHER endpoint's section still renders success; the step's Next button is **not** disabled (decision 7).
   4. User clicks Back to step 2, edits an endpoint's path, returns to step 3 → that endpoint re-probes; the unchanged endpoint hits the cache (no second SDK call).
   5. User clicks the per-endpoint Re-probe button → that endpoint re-fires with `forceRefresh: true`; other endpoints unaffected.
   6. User commits in step 4 with all suggestions accepted → `connectorInstances.create` and per-endpoint `createForInstance` fire with the user-reviewed columns array (existing commit path, unchanged from today).
   7. `reprobeDisabled` / `reprobeDisabledHint` props are gone from `ProbeReviewStep` and `EndpointColumnReview` — assert by reading the prop types.
   Run; all fail.

2. **Wire the workflow.** Add the `probeStateByKey` reducer. On step-3 entry (`useEffect` keyed on `step === 2 && endpoints`), iterate endpoints; for any whose hash doesn't match its current state's hash, fire `probeDraft.mutateAsync` and update state on settle.

3. **Drop the `reprobeDisabled` plumbing.** Remove props + the "Save the connector to enable probing" hint. The button is always enabled in create flow now.

4. **Hook up real Re-probe.** The button on `EndpointColumnReview` now fires `probeDraft.mutateAsync({ ..., forceRefresh: true })` for that endpoint only.

5. **Run the workflow tests.** All 7 cases green; existing workflow tests still pass.

**Done when:** create-flow step 3 shows real suggestions; back/forward without edit hits the cache; edits invalidate per-endpoint; Re-probe works.

---

## Slice 7 — Transform editor in `ApiEndpointForm`

Last functional slice. Collapsible "Advanced — transform" section, client-side JSONata live preview.

**Files**

- Modified: `apps/web/src/workflows/RestApiConnector/ApiEndpointForm.component.tsx`
- New: `apps/web/src/workflows/RestApiConnector/TransformEditor.component.tsx` (the pure UI for the editor + preview pair; per the Component File Policy this is its own file with its own UI / impl split)
- Modified: `apps/web/src/workflows/RestApiConnector/utils/rest-api-validation.util.ts` (extend the endpoint validation to enforce the mutual exclusion client-side too)
- Modified: `apps/web/package.json` (add `jsonata`)
- New: `apps/web/src/workflows/RestApiConnector/__tests__/TransformEditor.test.tsx`
- Modified: `apps/web/src/workflows/RestApiConnector/__tests__/ApiEndpointForm.test.tsx`

**UI shape**

```
┌─ ApiEndpointForm ─────────────────────────────────┐
│  Key, Label, Path, Method, …                      │
│                                                   │
│  Records path: [data.items______________]         │
│                                                   │
│  ▾ Advanced — transform (use JSONata if records   │
│     are not at a single path)                     │
│                                                   │
│    Transform expression                           │
│    ┌────────────────────────────────────────────┐ │
│    │ data.items.{                               │ │
│    │   "id": id,                                │ │
│    │   "user_name": user.name                   │ │
│    │ }                                          │ │
│    └────────────────────────────────────────────┘ │
│                                                   │
│    ┌─ Last probe response ─┐ ┌─ Transformed ───┐ │
│    │ { "data": { … } }     │ │ [{ "id": 1, …}] │ │
│    └───────────────────────┘ └─────────────────┘ │
│                                                   │
│    ✓ 25 records  (or:  ✗ parse error at line 2)  │
└───────────────────────────────────────────────────┘
```

Expanding the section hides + clears `recordsPath`. Collapsing it (or unsetting transform) restores `recordsPath`.

**Steps**

1. **Add the dep.** `npm install jsonata --workspace=apps/web`.

2. **Write the editor tests** (`TransformEditor.test.tsx`):
   1. Renders the textarea + placeholder hint.
   2. Typing fires `onChange` with the expression.
   3. With no `lastProbeResponse` prop, the preview pane shows a "Probe an endpoint first to see a live preview" hint.
   4. With a `lastProbeResponse` and a valid expression, the preview pane renders the transformed records (limited to the first 10 for display sanity).
   5. With a parse error, the editor surfaces "Parse error: …" inline.
   6. With a runtime error, the editor surfaces "Runtime error: …" inline.
   Run; all fail.

3. **Author `TransformEditor`.** Client-side `jsonata(...)` parse + eval, wrapped in try/catch matching the server-side `applyTransform` shape. Preview pane uses `JSON.stringify(..., null, 2)` for both sides.

4. **Write `ApiEndpointForm` integration tests:**
   1. Form opens with neither `recordsPath` nor `transform` set → "Advanced" section is collapsed; `recordsPath` field visible.
   2. User types into `recordsPath`, submits → draft submits with `recordsPath: "..."`, `transform: undefined`.
   3. User expands "Advanced", types a transform expression, submits → `recordsPath` was cleared on expand; draft submits with `transform: "..."`, `recordsPath: ""`.
   4. User edits an existing endpoint that has `transform` set → form opens with the section pre-expanded; `recordsPath` hidden.
   5. User edits an existing endpoint with `recordsPath` → section collapsed; expanding it warns "This will clear records path" with a confirm button before swapping (UX guardrail; refine wording during the slice).
   6. Client-side validation refuses submit if somehow both fields end up non-empty (shouldn't be reachable through the UI, but the validator runs anyway as a backstop).
   Run; all fail.

5. **Wire the editor into the form.** Use the existing `useDialogAutoFocus` pattern; first field after expansion focuses the transform textarea.

6. **Plumb `lastProbeResponse`.** The form receives the last raw HTTP response from the workflow container (held alongside `probeStateByKey` from slice 6). When editing an endpoint that's been probed, the preview pane has data to show.

7. **Run the editor + form tests.** All cases green.

**Done when:** users can author transforms with live preview; mutual exclusion is enforced client-side; recordsPath-only flow is unchanged.

---

## Slice 8 — End-to-end integration test + manual smoke

Lock the new behavior with an integration test against a mocked REST endpoint. Manual smoke against a real public API.

**Files**

- New: `apps/web/src/workflows/RestApiConnector/__tests__/RestApiConnector.integration.test.tsx` (or extend the existing workflow test)
- New (or extended): `apps/api/src/__tests__/integration/rest-api-pre-commit-probe.integration.test.ts`
- New: `docs/REST_API_PRE_COMMIT_PROBE.smoke.md` (manual checklist for a public-API run-through)

**Integration test scenarios (web side)**

1. Open the workflow, fill basics, add two endpoints (one with `recordsPath`, one with `transform`), advance to step 3 → both probes fire; success cards render with suggestions per endpoint; one card uses the transform path, the other the recordsPath path.
2. Edit the transform endpoint's expression in step 2 → step 3 re-probes that endpoint only.
3. Force a probe failure on one endpoint (mock the SDK call to reject) → that endpoint shows the error state; the other still works; Next is enabled.
4. Force a `transform-failed` degradation → the per-endpoint card shows "Transform failed: …" + manual-entry table beneath.
5. Commit in step 4 → assertions on the network calls: `connectorInstances.create` then per-endpoint `createForInstance` with the reviewed columns.

**Integration test scenarios (api side)**

1. End-to-end through `POST /api/connector-instances/probe-endpoint-draft` with a stubbed fetch → real response shape, real Zod validation, real classifier-stub wiring.
2. Same with `transform` returning flat records → assert the classifier receives flat candidates.
3. Same with `transform` parse error → 200 + `degradation: "transform-failed"`.

**Manual smoke checklist (separate doc)**

- Pick a real public REST API (GitHub Search, OpenWeatherMap historical, etc. — final pick during the slice).
- Walk the create flow end-to-end with both `recordsPath` and `transform` endpoints.
- Confirm: suggestions render, Adopt works, edits invalidate cache, commit lands in the detail view with sync-ready entities.

**Done when:** integration tests green; smoke doc committed; PR ready to graduate from draft.

---

## What this PR is NOT

Cross-checked against the discovery's "Out of scope" notes:

- **Edit-mode workflow refactor.** Stays on the post-commit `discoverColumns` route. The split is naturally driven by `EndpointRow.entityId`.
- **Monaco-grade editor.** v1 ships with a `<textarea>` + inline error surfacing. Monaco is a clean follow-up.
- **Sandboxed-JS escape hatch.** JSONata only; revisit after real usage if anyone hits a wall.
- **Transform snippet library.** Deferrable.
- **Probe failure blocking step advancement.** Per decision 7, failures warn but don't block.
- **App-layer encryption of credentials over the wire.** Per decision 5, this is theater; TLS + no-persistence + React-only draft state cover the real threat model.
