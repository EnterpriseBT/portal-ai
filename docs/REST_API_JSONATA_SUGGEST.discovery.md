# REST API JSONata transform — AI suggestion — Discovery

**Issue:** [EnterpriseBT/portal-ai#76](https://github.com/EnterpriseBT/portal-ai/issues/76)

**Why this exists.** The REST API connector workflow shipped JSONata as the escape hatch for response shapes that `recordsPath` can't express (see `REST_API_PRE_COMMIT_PROBE.discovery.md` decisions 9–14). But the editor today is a bare monospace textarea with a link to [docs.jsonata.org](https://docs.jsonata.org/) — the user is expected to read the JSONata reference and hand-write a working expression against the response shape they just previewed. For the cases JSONata was *adopted* to solve (multi-source-array flattening, nested-object projection, predicate-and-project), this is a real onboarding cliff: users either fall back to `recordsPath` and lose the feature, or commit a broken transform and discover it at sync time.

This is the AI-assist affordance that bridges "I previewed the response and see what I want" → "the textarea holds a working JSONata expression that produces it."

## The current shape

### REST API AI-assist precedent — the column classifier

This is the architecture the suggester will mirror almost line-for-line.

| Concern | Where | What it does |
|---|---|---|
| Dep contract | `apps/api/src/adapters/rest-api/classifier.types.ts:74` | `ColumnDefinitionClassifier.classify(candidates, catalog): Promise<ApiColumnClassification[]>` — pure async interface so the adapter can be stubbed in tests with a fake impl |
| Error type | `apps/api/src/adapters/rest-api/classifier.types.ts:87` | `ClassifierError` with `reason: "malformed-response" \| "timeout" \| "network-error"` — adapter catches regardless of reason and degrades; reason is telemetry-only |
| Default impl | `apps/api/src/adapters/rest-api/classifier.haiku.ts:87` | `createDefaultClassifier()` factory — wires `AiService.providers.anthropic` (default model `claude-haiku-4-5-20251001`), `generateObject` from the `ai` SDK, `pLimit(8)`, Pino logger. Maps every model exception to a `ClassifierError` |
| Response schema | `apps/api/src/adapters/rest-api/classifier.haiku.ts:74` | `ClassificationResponseSchema` — Zod-validated structured-output contract `generateObject` enforces |
| Prompt builder | `apps/api/src/adapters/rest-api/classifier.prompt.ts:56` | `buildApiClassifierPrompt({ candidates, catalog })` — pure deterministic string. Sorts catalog entries by `normalizedKey` for stability; truncates sample values to 80 chars |
| Tests | `apps/api/src/__tests__/adapters/rest-api/classifier.haiku.test.ts`, `classifier.prompt.test.ts` | Mocks `generateObject`; tests batch splitting, confidence clamping, hallucinated-field dropping, malformed-response → `ClassifierError("malformed-response", …)` |
| UI surfacing | `apps/web/src/workflows/RestApiConnector/SuggestionChip.component.tsx:21` | Compact `Chip` per suggestion with rationale + confidence in tooltip; click calls `onAdopt()` — precedent for an AI-assist affordance, though shape is per-column not per-textarea |

### Transform editor + endpoint form

| Concern | Where | What it does |
|---|---|---|
| Pure UI | `apps/web/src/workflows/RestApiConnector/TransformEditor.component.tsx:40` | `TransformEditorUI` — `{ value, onChange, lastProbeResponse?, serverError? }` over a monospace `TextField` (multiline, `minRows={4}`) + JSONata docs link + optional `<Alert severity="warning">` when `serverError` is set. `lastProbeResponse` prop is legacy — the editor doesn't read it (line 35 comment) |
| Host form (UI) | `apps/web/src/workflows/RestApiConnector/ApiEndpointForm.component.tsx:98` | `ApiEndpointFormUI` — modal with extraction-mode radio (`recordsPath` vs `transform`, line 245). Renders `TransformEditorUI` inside `Box` at line 287, then a Preview button + `PreviewPaneUI` directly below |
| Host form (container) | `apps/web/src/workflows/RestApiConnector/ApiEndpointForm.component.tsx:376` | `ApiEndpointForm` — owns `previewResponse` state (line 390, populated by `onPreview` callback at line 432). This is **the** state we read for `sampleResponse` |
| Preview source | `apps/web/src/workflows/RestApiConnector/PreviewPane.component.tsx:30` | Pure pane — receives `response: unknown \| null` + `truncated` from the form's local state. Body comes from `sdk.apiConnector.endpoints.previewPage()` via the workflow's `onPreview` callback |

### Server-side transform utility

| Concern | Where | What it does |
|---|---|---|
| JSONata wrapper | `apps/api/src/adapters/rest-api/transform.util.ts:32` | `applyTransform(expression, response): Promise<TransformResult>` — pure, non-throwing. Returns `{ records: unknown[], error: { kind: "parse" \| "runtime", message: string } \| null }`. Parse-fails on empty / unparseable expression; runtime-fails on evaluate throw; coerces array/object/primitive/null to `unknown[]` |
| Tests | `apps/api/src/__tests__/adapters/rest-api/transform.util.test.ts` | Existing — covers parse/runtime/coercion paths |

### Endpoint router + new route placement

| Concern | Where | What it does |
|---|---|---|
| Existing `discover-columns` | `apps/api/src/routes/api-endpoints.router.ts:1007` | `POST /api/connector-instances/:instanceId/api-endpoints/:entityId/discover-columns` — `getApplicationMetadata` middleware → `requireRestApiInstance(instanceId, organizationId)` → Zod body parse → adapter call → `HttpService.success`. Errors wrap in `ApiError(…)` and delegate to `next(error)` |
| Pre-commit precedent | `apps/api/src/routes/connector-instance.router.ts:826` | `POST /api/connector-instances/probe-endpoint-draft` — the draft-side route. Zod-validates `ProbeEndpointDraftRequestBody` (org + draft endpoint config + credentials), calls `restApiAdapter.probeEndpointDraft`. No `instanceId` in the path — the suggester is also draft-side (the user is mid-form), so this is the closer precedent |
| Preview-page sibling | `apps/api/src/routes/connector-instance.router.ts:868` | `POST /api/connector-instances/preview-endpoint-page` — the route the Preview button already calls. Body schema = `PreviewEndpointPageRequestBodySchema` (= `ProbeEndpointDraftRequestBodySchema` minus `forceRefresh`) |

### SDK pattern

| Concern | Where | What it does |
|---|---|---|
| SDK surface | `apps/web/src/api/api-connector.api.ts:65` | `apiConnector.endpoints.*` — all REST API endpoints grouped here |
| Mutation precedent | `apps/web/src/api/api-connector.api.ts:148` | `probeDraft: () => useAuthMutation<DiscoverColumnsResult, ProbeEndpointDraftRequestBody>({ url, method: "POST" })` — the draft-side mutation shape we'll mirror |
| Hook util | `apps/web/src/utils/api.util.ts` | `useAuthMutation<TRes, TVars>({ url, method, body? })` — returns `{ mutateAsync, isPending, error, … }`; `error` feeds `toServerError()` for `<FormAlert />` |
| Contracts source | `packages/core/src/contracts/api-connector.contract.ts:111` | `ProbeEndpointDraftRequestBodySchema` / `PreviewEndpointPageRequestBodySchema` — where the new `SuggestTransformRequestBodySchema` will live |

### Existing `REST_API_*` error code namespace

`apps/api/src/constants/api-codes.constants.ts:305–419` — the suggester's error code joins this list. Existing neighbours: `REST_API_TRANSFORM_FAILED` (sync-time transform error), `REST_API_INVALID_CONFIG` (Zod body), `REST_API_OPERATION_FAILED` (catch-all 500), `REST_API_FETCH_FAILED` / `REST_API_AUTH_FAILED` / `REST_API_RATE_LIMITED` (upstream). No existing AI-assist code — the classifier degrades silently and never surfaces an `ApiError`.

## The design space

### Decision 1 — Where the new route lives

The suggester is invoked while the user is *inside* the Add-endpoint modal, holding a preview response in client state and no persisted `connectorEntityId`. Three placement options:

- **A. Sibling of `probe-endpoint-draft`** — `POST /api/connector-instances/suggest-transform`, mounted on `connectorInstanceRouter`. No path params (no instance yet); body carries the sample + hint.
- **B. Sibling of `discover-columns`** — `POST /api/connector-instances/:instanceId/api-endpoints/:entityId/suggest-transform` on `apiEndpointsRouter`. Requires instance + entity to exist.
- **C. Mount under a new `rest-api` namespace** — `POST /api/rest-api/suggest-transform`, a fresh router scoped to AI-assist endpoints.

| | A (draft-side sibling) | B (entity-bound) | C (new namespace) |
|---|---|---|---|
| Works pre-commit | ✅ | ❌ — needs an instance | ✅ |
| Reuses existing middleware | ✅ — same `getApplicationMetadata` | ✅ — `requireRestApiInstance` | New wiring needed |
| Convention fit | ✅ — exactly mirrors `probe-endpoint-draft` | Tempting (next to `discover-columns`) but wrong: it's not entity-scoped data | Out-of-pattern for the codebase |
| Edit-mode (existing instance) | ✅ — request still works | ✅ but more friction (need ids) | ✅ |

**Lean: A.** The suggester runs in the same workflow surface as `probe-endpoint-draft` and against the same sample response; mirroring its mount keeps the mental model "this is what the draft-side workflow calls." Edit-mode from the post-commit detail view still routes here — there's no entity-keyed state to load.

### Decision 2 — Request body shape

The route needs: the sample response, the user's optional prompt hint, and (per issue acceptance criteria) enough context for the prompt builder to know what it's transforming. Three shapes:

- **A. Minimal** — `{ promptHint?: string, sampleResponse: unknown }`. Server is told nothing about extraction mode or existing `recordsPath`.
- **B. With extraction context** — `{ promptHint?: string, sampleResponse: unknown, currentExpression?: string }`. Lets the prompt builder show the model "here's what the user already has" for a refine-from-here flow.
- **C. Full draft context** — `{ promptHint?: string, draft: { endpoint: ApiEndpointConfig, baseUrl, auth, credentials, … }, sampleResponse: unknown }`. Mirrors `ProbeEndpointDraftRequestBody` exactly.

| | A | B | C |
|---|---|---|---|
| Bytes on wire | Smallest | Small | Largest (carries credentials needlessly) |
| Prompt quality | Adequate — model has the sample and the hint | Slightly better for "refine my expression" | No gain for v1 |
| Security surface | None | None | Credentials in a body that never *needs* them — anti-pattern |
| Issue acceptance criteria | ✅ | ✅ + refine path (out of scope per "single suggestion only for v1") | Overkill |

**Lean: A.** The issue explicitly scopes "single suggestion only for v1" and "first cut just replaces the textarea contents" — so the refine-from-current-expression flow (option B) isn't load-bearing yet. The route never makes an upstream HTTP call (the sample is already in hand), so credentials don't belong in the body — that's the smell that rules out C.

### Decision 3 — Sample response truncation strategy

Sample responses come from `previewPage`, capped at ~256 KB server-side already. That's still too large to send to Haiku verbatim (~64K tokens of raw JSON). The issue explicitly calls out "truncated/sanitized — strip large arrays past N items." Two interpretations:

- **A. Truncate arrays inline** — walk the response tree, slice every array to ≤ N elements (say N=5), leave objects untouched. Preserves structure-defining shape ("there's an `items` array, with this kind of element").
- **B. Truncate by character budget** — serialize, slice to a max char count, indicate truncation in the prompt. Simpler but produces broken JSON the model has to reason about.
- **C. Truncate + token-count budget** — same as A but also enforce a hard token cap by walking depth-first and dropping deeply-nested branches if the budget is exhausted.

| | A (array-slice) | B (char-slice) | C (array-slice + depth-cap) |
|---|---|---|---|
| Preserves structure | ✅ | ❌ — yields invalid JSON | ✅ |
| Implementation | ~30-line recursive walker | One-liner | ~50-line walker with budget |
| Worst-case prompt size | Bounded by N × depth × breadth | Bounded by char cap | Hard-bounded by budget |
| Sample-response realism | Real-looking shape — same fields, fewer rows | Looks corrupted | Real-looking shape |

**Lean: A.** v1 only needs to handle the response shapes our preview already caps at 256 KB. An array-slice walker (N=5, no depth cap) covers the realistic cases and stays simple. C is the upgrade path if real prompts ever exceed the model's effective input window; not needed at v1. Add a token-count log line so we can see if real-world prompts ever push the limit.

### Decision 4 — Server-side validation strategy

The issue is specific: "Validate the suggested expression server-side by running it through the existing `transform.util.ts` against the sample response before returning. If it parses but throws or returns a non-array, retry once with the validation error in the prompt; if still invalid, return the raw suggestion with a `warning` field so the UI can flag it."

Three sub-questions inside that:

**4a. What counts as "valid"?** `applyTransform` returns `{ records, error }`. The function returns `{ records: [{ value: prim }], error: null }` for a primitive result — technically not an error, but useless as a transform. We have to decide:

- **Strict** — `error: null` *and* at least one record (`records.length > 0`).
- **Loose** — `error: null` is enough.
- **Strict + array-of-objects** — `error: null` *and* `records.every(r => typeof r === "object" && !Array.isArray(r))`.

**Lean: Strict + array-of-objects.** The transform's contract downstream (`inference.util.ts:107` walks `Object.keys(record)` on the first record's top-level keys) needs object-shaped records. A primitive-yielding expression like `$count(data)` is parseable JSONata but useless — failing the validation forces a retry against something the inference pipeline can actually consume.

**4b. Where does the retry happen?** The suggester orchestrates retries, not the prompt builder.

- The Haiku-backed `JsonataSuggester` exposes a single `suggest({ promptHint, sampleResponse }): Promise<{ expression: string }>`.
- The route (or a thin service between the route and the suggester) handles the validate → retry-once → fallback loop. The retry calls the same suggester again with an enriched prompt input that includes the previous failure.

This keeps the dep contract pure (it doesn't know about validation) and matches how the classifier dep contract avoids retry concerns.

**Lean: route-level orchestration with a `previousAttempt?: { expression, error }` field on the suggester contract.** That field is what the prompt builder reads to add the "the previous expression failed with X — try again" instruction. The dep stays single-shot (cleaner for stubs).

**4c. What does the response shape look like?**

```ts
// Success — first attempt validated
{ expression: "data.items", warning: null }

// Success after retry
{ expression: "data.items.{ id, name }", warning: null }

// Returned with warning — both attempts produced an expression that didn't validate
{ expression: "data.items[].$$",
  warning: { kind: "validation-failed", message: "Expression returned 0 records" } }
```

The `warning` field is the load-bearing piece: the UI populates the textarea regardless and surfaces the warning inline. Per the issue, "obviously broken suggestions don't reach the textarea" — but the "didn't reach the textarea" case is the suggester *failing* (network/timeout/malformed), not "the expression we got back fails validation." For validation failures we *do* return the suggestion, just flagged.

The 4xx/5xx error paths still exist for genuine failures: `400` on Zod body issues, `502` on suggester failure (e.g. Haiku timeout — mirroring how `discover-columns` would 5xx if it could).

### Decision 5 — Error code naming

The issue floats `REST_API_JSONATA_SUGGEST_FAILED` — that fits the existing `<DOMAIN>_<FAILURE>` pattern. Adjacent codes for reference:

- `REST_API_TRANSFORM_FAILED` — runtime transform error during sync (already exists).
- `REST_API_INVALID_CONFIG` — 400 body validation.
- `REST_API_OPERATION_FAILED` — catch-all 500.

Two options:

- **A. New code `REST_API_TRANSFORM_SUGGEST_FAILED`** — names what failed (suggestion) and the domain (transform). Maps to 502 (upstream model unreachable / malformed).
- **B. Reuse `REST_API_OPERATION_FAILED`** — generic catch-all; we already have it.

**Lean: A (`REST_API_TRANSFORM_SUGGEST_FAILED`).** Specific code makes telemetry easier ("how often does the suggester die?") and gives the UI's `FormAlert` a precise label to surface. The issue's `REST_API_JSONATA_SUGGEST_FAILED` works equally well — but our existing namespace uses `TRANSFORM` rather than `JSONATA` (e.g. `REST_API_TRANSFORM_FAILED`), and naming consistency wins. Validation-warning cases (decision 4) don't go through the error path — they return a 200 with the warning field.

### Decision 6 — UI placement: prompt textarea + Suggest button

The issue says "Add an optional **prompt textarea** (multiline, small) … Add a **Suggest** button next to the textarea." Three placements:

- **A. Inside `TransformEditorUI`** — extend the pure component's props with `promptHint`, `onPromptHintChange`, `onSuggest`, `isSuggesting`, `suggestServerError`. The editor becomes the AI-assist surface.
- **B. As a sibling component above `TransformEditorUI`** — new `TransformSuggesterUI` rendered by `ApiEndpointFormUI` directly above the editor. Pure too. The editor stays focused on the expression itself.
- **C. As a sibling component nested into the form's container** — new `TransformSuggester` (container) that internally owns the mutation, exports a pure `TransformSuggesterUI`. The form embeds the container.

| | A | B | C |
|---|---|---|---|
| TransformEditorUI stays focused | ❌ | ✅ | ✅ |
| Storybook story for the suggester UI | Same as editor | Standalone | Standalone |
| Container can sit close to `ApiEndpointForm`'s `previewResponse` state | Yes (via props) | Yes (via props) | Yes (via own hook) |
| Component File Policy compliance | Two components per file means UI + container — editor's container doesn't exist today; opening this door makes the file a 4-component pile if we ever add one | Clean: one pure UI per file | Clean: container + UI in one file |

**Lean: B + container in `ApiEndpointForm.tsx`.** The Component File Policy is the binding constraint. `TransformEditor.component.tsx` is currently a one-file pure-UI component; folding the suggester into it forces either (a) inline helper component (forbidden by the policy) or (b) splitting `TransformEditor` into container + UI to also host the suggester — confusing because the editor *itself* doesn't need a container. A new file `TransformSuggester.component.tsx` exporting `TransformSuggesterUI` (pure) keeps each file simple. The mutation wiring lives in `ApiEndpointForm`'s existing container — it already owns `previewResponse`, which is the source of truth for "is the button enabled?"

### Decision 7 — Suggester contract + prompt-builder file shape

Mirror the classifier exactly:

```
apps/api/src/adapters/rest-api/
  jsonata-suggest.types.ts      // JsonataSuggester interface + JsonataSuggestError class
  jsonata-suggest.prompt.ts     // buildJsonataSuggestPrompt({ sampleResponse, promptHint, previousAttempt? })
  jsonata-suggest.haiku.ts      // createDefaultJsonataSuggester() factory
```

Naming alternative: `transform-suggest.*` (matches the error code namespace) vs `jsonata-suggest.*` (names the language). Lean: **`jsonata-suggest.*`** — the language is what the model is generating; future "sandbox JS" or other transform languages (decision 15 in the prior discovery doc) would get their own file family.

The dep contract:

```ts
export interface JsonataSuggesterInput {
  sampleResponse: unknown;
  promptHint?: string;
  previousAttempt?: { expression: string; error: string };
}
export interface JsonataSuggesterOutput {
  expression: string;
}
export interface JsonataSuggester {
  suggest(input: JsonataSuggesterInput): Promise<JsonataSuggesterOutput>;
}
```

`JsonataSuggestError` follows `ClassifierError` (reason: `"malformed-response" | "timeout" | "network-error"`).

### Decision 8 — Replace-vs-merge behaviour on success

Issue is explicit: "replace the transform textarea value with the returned expression." No diff/accept UI, no merge with existing value. Just `onChange(suggestion.expression)`.

Open question: do we confirm before replacing if `value !== ""`? The issue's "Out of scope: Inline 'diff/accept' affordance — first cut just replaces the textarea contents" answers this: no confirm. The user invoked Suggest deliberately.

**Lean: Replace unconditionally on success, surface the warning (if any) inline.** Track an undo opportunity via the existing browser undo behaviour on `<TextField>` — Ctrl-Z in the textarea already works.

## Tradeoff comparison

|  | D1: Route lives next to `probe-endpoint-draft` | D2: Minimal body `{ promptHint?, sampleResponse }` | D3: Array-slice truncation (N=5) | D4: Strict array-of-objects validation, route orchestrates retry, `warning` in 200 response | D5: New code `REST_API_TRANSFORM_SUGGEST_FAILED` | D6: New `TransformSuggester.component.tsx` (UI) + wire in `ApiEndpointForm` container | D7: `jsonata-suggest.{types,prompt,haiku}.ts` |
|---|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Spread to plan slicing | Slice "route + suggester" together | Same | Slice "prompt builder + truncation util" | Slice "validation + retry orchestration" | Single-line constants edit | Slice "UI component + container wiring" | Three sibling files in one slice |
| Risk of churn | Low | Low — extending body later is additive | Low — slice cap N is tunable | Medium — retry behaviour might want tuning post-launch | Low | Low | Low |

## Recommendation

1. **New route `POST /api/connector-instances/suggest-transform`** on `connectorInstanceRouter`, alongside `probe-endpoint-draft`. `getApplicationMetadata` middleware, Zod body parse, adapter call, `HttpService.success`.
2. **Request body `SuggestTransformRequestBody = { promptHint?: string, sampleResponse: unknown }`**. Schema lives in `packages/core/src/contracts/api-connector.contract.ts`.
3. **Response body `SuggestTransformResponse = { expression: string, warning: { kind: "validation-failed", message: string } | null }`**. Lives in the same contract file.
4. **Sample-response truncation** via a new `truncateForPrompt(response, { maxArrayLen: 5 })` util in `apps/api/src/adapters/rest-api/jsonata-suggest.prompt.ts`. Walks the tree, slices arrays to 5 items, leaves objects intact, attaches a `__truncated: true` marker on truncated arrays so the prompt can note it.
5. **Suggester dep contract** `JsonataSuggester` in `jsonata-suggest.types.ts`; default `createDefaultJsonataSuggester()` in `jsonata-suggest.haiku.ts` mirroring the classifier factory's wiring (Anthropic provider, Haiku 4.5 default model, `generateObject` with a Zod-validated `{ expression: string }` response schema, pino logger). `JsonataSuggestError` with the same `reason` discriminator.
6. **Prompt builder** `buildJsonataSuggestPrompt({ sampleResponse, promptHint?, previousAttempt? })` in `jsonata-suggest.prompt.ts`. Truncates via the new util, includes a short "the user wants flat records — JSONata expression returning array of objects" instruction, plus the hint and any previous-attempt failure.
7. **Route-level retry orchestration**: invoke `suggester.suggest()`, run the result through `applyTransform(expr, sampleResponse)`, check `error === null && records.length > 0 && records.every(r => typeof r === "object" && !Array.isArray(r))`. On failure, re-invoke once with `previousAttempt: { expression, error }`. If second attempt also fails validation, return the second expression with `warning`.
8. **New `REST_API_TRANSFORM_SUGGEST_FAILED`** in `api-codes.constants.ts`. Used for 502 on `JsonataSuggestError` (any reason) — telemetry-keyed via the route logger including `reason`.
9. **SDK mutation** `apiConnector.endpoints.suggestTransform()` in `apps/web/src/api/api-connector.api.ts`, mirroring `probeDraft()` — `useAuthMutation<SuggestTransformResponse, SuggestTransformRequestBody>({ url: "/api/connector-instances/suggest-transform", method: "POST" })`.
10. **New pure UI component** `apps/web/src/workflows/RestApiConnector/TransformSuggester.component.tsx` exporting `TransformSuggesterUI` with props `{ promptHint, onPromptHintChange, onSuggest, isSuggesting, disabled, disabledReason?, serverError? }`. Renders multiline `<TextField>` (1–2 rows) + `<Button>Suggest</Button>` (disabled with tooltip when `disabled`) + `<FormAlert serverError={serverError} />`.
11. **Wire the suggester in `ApiEndpointForm` container** (the existing one, line 376): destructure `sdk.apiConnector.endpoints.suggestTransform()`'s `mutateAsync` and `error`; manage local `promptHint` state; pass `disabled={!previewResponse}` and `disabledReason="Run Preview first to capture a sample response."` to the UI; on success `setDraft(d => ({ ...d, transform: result.expression }))` and surface `result.warning` via the existing `lastTransformError`-style slot on `TransformEditorUI`.
12. **Render the suggester** above `TransformEditorUI` inside the existing `extractionMode === "transform"` branch in `ApiEndpointFormUI` (line 287 area).
13. **Tests** mirror the classifier's: `jsonata-suggest.haiku.test.ts` (mocked `generateObject`, asserts request shape + parse error handling), `jsonata-suggest.prompt.test.ts` (truncation, hint inclusion, previous-attempt inclusion), route test under `apps/api/src/__tests__/routes/` (200 with valid suggestion, 200 with `warning` after retry, 400 on Zod failure, 502 on `JsonataSuggestError`), and a UI test for `TransformSuggesterUI` (button disabled without `disabled=false`, clicks invoke `onSuggest`, `FormAlert` renders when `serverError` set).

## Open questions

1. **Should the retry use a fresh model call or a follow-up "you got it wrong, try again" turn in the same call?** Two model calls is more tokens but matches the classifier pattern (independent calls per batch). A two-turn conversation would need richer prompt assembly. **Lean: fresh call with `previousAttempt` injected into the prompt.** Matches the classifier's per-batch model; simpler dep contract; no conversation state to manage server-side.
2. **Confidence score from the model?** The classifier emits a confidence; the suggester's response could mirror that. But unlike a column classification (multiple choice over a catalog), the suggester emits free-form JSONata — a confidence number wouldn't be meaningfully grounded. **Lean: no confidence in v1.** The validation result already serves as "is this likely good?" The `warning` field is the user-facing equivalent.
3. **Do we cache suggestions by sample-response hash?** A user clicking Suggest twice in a row against the same preview pays for the model call both times today. **Lean: no caching in v1.** The button is explicit (the user just clicked it); they probably wanted a fresh attempt. If real-world usage shows duplicate clicks are common, add a 60-second in-process cache keyed by `hash(sampleResponse + promptHint)` later — same shape as the existing probe cache (`probe-cache.util.ts`).
4. **What happens when the model returns a non-string for `expression`?** The Zod response schema rejects it; `JsonataSuggestError("malformed-response", …)` is thrown; the route returns 502 with `REST_API_TRANSFORM_SUGGEST_FAILED`. **Lean: this is exactly the malformed-response path — no special handling.**
5. **Truncation marker leak.** The prompt-builder util slices arrays to 5 items, but the issue says "strip large arrays past N items" — does that mean prefix-N, sample-N, or something else? **Lean: prefix-N (first 5 elements).** Sampling is more representative but more code; first-N is what callers naturally write when they want to see "what does this shape look like" and is the path of least surprise. If the model produces expressions that work on the first 5 elements but break on the 6th, the validation pass would catch it (a separate concern from prompt construction).

## What this doesn't decide

- **Multi-suggestion picker.** Issue: "Out of scope — single suggestion only for v1." Architecture allows it later (the response is already structured; making it `expressions: string[]` is additive).
- **Diff/accept affordance** showing what `value` looked like before vs after Suggest. Issue: out of scope; explicit Ctrl-Z is the v1 undo.
- **Auto-suggest on Preview** without an explicit click. Issue: "Out of scope — keep it explicit."
- **Caching suggestions** by sample-response hash (open question 3). Defer until usage data justifies it.
- **Confidence score** in the response (open question 2). Defer until there's a UI affordance that uses it.
- **Refining from the current expression** (decision 2 option B). The dep contract has the `previousAttempt` slot, but the SDK request doesn't expose `currentExpression` to the user as "use my draft as a starting point." Out of scope per "single suggestion only for v1."
- **Tuning the Haiku model / prompt for non-flat shapes** beyond the four primer cases in `REST_API_PRE_COMMIT_PROBE.discovery.md`. The prompt builder ships with the same case-coverage the docs already explain; real-world usage will inform model/prompt tuning.

## Next step

Spec at `docs/REST_API_JSONATA_SUGGEST.spec.md` codifies the wire-level contract: `SuggestTransformRequestBodySchema`, `SuggestTransformResponseSchema`, the `JsonataSuggester` dep, `JsonataSuggestError`, and the route's request/response semantics. Plan at `docs/REST_API_JSONATA_SUGGEST.plan.md` slices the work, roughly: (1) contracts + types + error code, (2) prompt builder + truncation util + tests, (3) Haiku suggester + tests, (4) route + retry orchestration + route tests, (5) SDK endpoint, (6) `TransformSuggesterUI` + Storybook + unit test, (7) wire into `ApiEndpointForm` container + integration test. ~7 slices, no DB migrations, no schema changes — pure additive across `core` / `api` / `web`.
