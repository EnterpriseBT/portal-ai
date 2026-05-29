# REST API JSONata transform — AI suggestion — Spec

**Add a one-shot AI-assist suggestion path to the JSONata transform editor in the REST API connector's Add-endpoint form: a new sibling-of-`probe-endpoint-draft` route accepts a sample HTTP response + an optional natural-language hint, asks a Haiku-4.5-backed `JsonataSuggester` for a single JSONata expression that produces flat record objects from that sample, validates the suggestion server-side by running it through the existing `applyTransform` utility, retries once with the validation error injected into the prompt if the first attempt produces a non-array-of-objects result, and returns `{ expression, warning }` — `warning: null` on success, populated when both attempts fail validation. The frontend exposes the suggestion as a new pure UI component (`TransformSuggesterUI`) — a small prompt textarea + Suggest button rendered above the existing `TransformEditorUI` inside the form's `extractionMode === "transform"` branch — wired by the form's existing container, which already owns the preview-response state the button needs. On success, the suggestion replaces the transform textarea contents unconditionally; the optional warning surfaces via the editor's existing `<Alert severity="warning">` slot. Failures surface as a `FormAlert` driven by `toServerError(mutation.error)` per the standard pattern; the existing transform value is untouched.** After this PR, a user who has previewed an endpoint can populate the transform textarea with a working JSONata expression in one click, optionally biased by a hint like "one row per order line item."

Discovery: [`docs/REST_API_JSONATA_SUGGEST.discovery.md`](./REST_API_JSONATA_SUGGEST.discovery.md). Standing on top of [`REST_API_PRE_COMMIT_PROBE`](./REST_API_PRE_COMMIT_PROBE.discovery.md), which shipped the JSONata transform field, the editor, the preview pane that produces the sample response this feature consumes, and the precedent server-side AI-assist pattern (the column classifier).

Resolved decisions (from the discovery doc; recorded here so the spec is self-contained):

- **Route placement: sibling of `probe-endpoint-draft`.** `POST /api/connector-instances/suggest-transform` on `connectorInstanceRouter`. No path params (no persisted instance at suggest time). Edit-mode from the post-commit detail view still calls this route; there's no entity-keyed state to load on either side.
- **Request body: minimal.** `{ promptHint?: string, sampleResponse: unknown }`. No `currentExpression`, no draft endpoint config, no credentials — the server never makes an upstream HTTP call so it doesn't need them.
- **Truncation: array-slice with N=5, no depth cap.** A pre-prompt walker slices every array to its first 5 elements and adds a `__truncated: true` marker as the array's final element when the slice happened. Objects are untouched. Structure is the only thing the model needs.
- **Validation: strict array-of-objects.** The route accepts a suggestion only when `applyTransform(expr, sampleResponse)` returns `error === null && records.length > 0 && records.every(r => typeof r === "object" && r !== null && !Array.isArray(r))`. Anything else triggers the retry path.
- **Retry orchestration: route-level, one retry.** First failure → re-invoke the suggester with `previousAttempt: { expression, error }` populated. Second failure → return the second expression with a `warning` field populated; the suggestion still reaches the textarea but is flagged.
- **Error code: `REST_API_TRANSFORM_SUGGEST_FAILED`.** New code under the existing `REST_API_*` namespace. Mapped to 502 for `JsonataSuggestError` (any reason). Validation warnings (decision 4 above) do NOT use this code — they return 200 with `warning` populated.
- **UI placement: new sibling component above `TransformEditorUI`.** `TransformSuggester.component.tsx` exports a single pure `TransformSuggesterUI`. The mutation is wired in the existing `ApiEndpointForm` container (the one at `ApiEndpointForm.component.tsx:376`). `TransformEditorUI` is **not** modified.
- **Suggester file family: `jsonata-suggest.*`.** Three sibling files under `apps/api/src/adapters/rest-api/`: `jsonata-suggest.types.ts`, `jsonata-suggest.prompt.ts`, `jsonata-suggest.haiku.ts`. Names the language, leaves room for a future `sandboxed-js-suggest.*` family if the upgrade path from `REST_API_PRE_COMMIT_PROBE.discovery.md` decision 15 ever trips.
- **On success: replace the textarea contents unconditionally.** No confirm-before-overwrite, no diff/accept affordance, no merge with the existing value. Surface the warning inline if present. Browser-native Ctrl-Z in the textarea is the v1 undo.

---

## Scope

### In scope

1. **`SuggestTransformRequestBodySchema` + `SuggestTransformResponseSchema`** in `packages/core/src/contracts/api-connector.contract.ts`. Inferred types exported alongside.
2. **`REST_API_TRANSFORM_SUGGEST_FAILED`** in `apps/api/src/constants/api-codes.constants.ts`.
3. **`JsonataSuggester` dep contract** in `apps/api/src/adapters/rest-api/jsonata-suggest.types.ts` — pure async interface so it can be stubbed in tests. `JsonataSuggestError` class with `reason: "malformed-response" | "timeout" | "network-error"`.
4. **`truncateForPrompt` utility** in `apps/api/src/adapters/rest-api/jsonata-suggest.prompt.ts` — recursive tree walker that slices every array to ≤5 elements with a `__truncated: true` sentinel. Pure, side-effect-free.
5. **`buildJsonataSuggestPrompt` prompt builder** in the same file. Pure, deterministic. Takes the truncated sample response, optional hint, optional previous-attempt info; returns a string. Mirrors `buildApiClassifierPrompt`'s structure (heading lines + sections + a closing instruction).
6. **`createDefaultJsonataSuggester` factory** in `apps/api/src/adapters/rest-api/jsonata-suggest.haiku.ts` — Anthropic provider via `AiService.providers.anthropic`, default model `claude-haiku-4-5-20251001`, `generateObject` with a Zod-validated response schema, Pino logger. Maps every model exception to `JsonataSuggestError`. **No `pLimit` / no batching** — single-shot per call.
7. **New POST route** at `/api/connector-instances/suggest-transform` on `connectorInstanceRouter`. Body validation via the new schema; orchestrates the validate-then-retry loop; returns `{ expression, warning }` on 200; 400 on Zod failure; 502 on `JsonataSuggestError`. Logging at route + (optional) service layer per the API style guide.
8. **`suggestTransform` SDK endpoint** under `apiConnector.endpoints` in `apps/web/src/api/api-connector.api.ts`. `useAuthMutation<SuggestTransformResponse, SuggestTransformRequestBody>` — same pattern as `probeDraft` and `previewPage`.
9. **`TransformSuggesterUI` pure UI component** at `apps/web/src/workflows/RestApiConnector/TransformSuggester.component.tsx`. Props per the *Frontend surface* section below. Rendered inside `ApiEndpointFormUI`'s `extractionMode === "transform"` branch, directly above `TransformEditorUI` (`ApiEndpointForm.component.tsx:287`).
10. **Wire the mutation in `ApiEndpointForm`'s existing container** (line 376). Manage `promptHint` as new local state; pass `disabled={!previewResponse}` to the UI; on success call `setDraft(d => ({ ...d, transform: result.expression }))` and stash any `result.warning` so the editor's existing `serverError`-style slot surfaces it.
11. **Unit tests** for: `truncateForPrompt`, `buildJsonataSuggestPrompt`, `createDefaultJsonataSuggester`, the route, the SDK consumer (mutation shape), `TransformSuggesterUI` (pure component), and the container wiring (existing `ApiEndpointForm` test file).

### Out of scope

- **Multi-suggestion picker.** `expressions: string[]` would be additive but is explicit out-of-scope per the issue. v1 returns exactly one expression.
- **Inline diff/accept affordance.** No "here's what you had vs. what we propose" UI. The textarea is replaced unconditionally on success; Ctrl-Z is the undo.
- **Auto-suggest on Preview** without an explicit click. The user invokes Suggest deliberately.
- **Refining from the current expression.** `JsonataSuggesterInput` has a `previousAttempt` field for the retry path, but the SDK request body does not expose `currentExpression` to the user as a "use my draft as a starting point" affordance. If a user wants a different suggestion, they retype the hint and click again.
- **Caching by sample-response hash.** Two consecutive clicks with the same payload both pay for a model call. If real-world telemetry shows duplicate clicks, layer a 60-second in-process cache the same way `probe-cache.util.ts` does. Out of v1.
- **Confidence score** in the response. The classifier emits one because it's choosing from a catalog; the suggester is emitting free-form text where a confidence number isn't meaningfully grounded. The `warning` field is the user-facing equivalent of "this might not be right."
- **Storybook stories** for `TransformSuggesterUI`. The component is small and the unit tests cover its visual states. If a future Storybook pass picks up the workflow's pure UI components broadly, this one joins.
- **Telemetry beyond logging.** The route logs success/failure with token counts and latency (same shape as the classifier). No Pino-to-Prometheus bridge; no per-org rate limiting.
- **Sample-response cleanup beyond `__truncated` markers.** No PII redaction, no secret-key stripping. The sample came from the same probe pipeline that ships the full body to the user's browser; the server has no additional sensitivity context to apply.

---

## Concept changes

### Truncation algorithm (`truncateForPrompt`)

Pure function. Input: arbitrary JSON-shaped `unknown`. Output: structurally similar `unknown` with arrays capped.

Rules:

1. If the input is a primitive (`string`, `number`, `boolean`, `null`, `undefined`) → return as-is.
2. If the input is an array of length ≤ 5 → return a new array with each element recursively truncated.
3. If the input is an array of length > 5 → return a new array containing the first 5 elements (each recursively truncated) followed by the literal sentinel value `"__truncated__"` (string — easy for the model to recognize). Choice of sentinel: a string is robust to the model paraphrasing structural keys, and unambiguous in context (real data rarely contains the literal string `"__truncated__"` as an array element).
4. If the input is a plain object → return a new object with each value recursively truncated. Keys are preserved verbatim, key order is preserved (sorted serialization happens at JSON-stringify time inside the prompt builder if needed; the prompt builder does not currently sort keys — symmetry with `buildApiClassifierPrompt` which sorts only the catalog).
5. Non-plain objects (Date, RegExp, etc.) — should not occur from a JSON HTTP response, but defensively pass through unchanged. (`JSON.stringify` will reduce them to the same shape the network does, e.g. `null` for non-serializable values.)

No depth cap. v1 trusts that the 256 KB upstream cap on `previewPage` plus per-array slicing keeps prompts inside Haiku's input window. The prompt builder logs `JSON.stringify(truncated).length` for monitoring; if real-world prompts ever exceed ~32 KB we add a depth cap.

### Prompt structure (`buildJsonataSuggestPrompt`)

Deterministic — same input always produces the same string. Mirrors `buildApiClassifierPrompt`'s style (heading lines + sections + closing instruction).

Input:

```ts
interface BuildJsonataSuggestPromptInput {
  sampleResponse: unknown;      // already truncated by truncateForPrompt
  promptHint?: string;
  previousAttempt?: { expression: string; error: string };
}
```

Output (rendered string):

```text
You are writing a JSONata expression that transforms a JSON HTTP response
into an array of flat record objects. The expression must:
- Return an array (each element a plain object, never a primitive).
- Project nested fields into top-level keys so downstream inference can
  enumerate them — e.g. `data.{ "id": id, "user_name": user.name }`.
- Reference [docs.jsonata.org] syntax only. No JavaScript, no I/O.

## Sample response
<JSON.stringify(sampleResponse, null, 2) — pre-truncated>

## User hint
<promptHint, if present — otherwise "(no hint provided)">

## Previous attempt
<rendered when previousAttempt is set — shows the prior expression and the
 validation error from applyTransform, with an instruction to fix it>

Return JSON: { "expression": "<jsonata expression string>" }.
Emit exactly one expression. No commentary, no alternatives, no markdown.
```

When `previousAttempt` is unset, the "## Previous attempt" section is omitted entirely (not an empty section header).

### Server-side validation + retry orchestration

Owned by the route handler (not the suggester dep, not a shared service module — the orchestration is route-shaped). Pseudocode:

```ts
async function suggestRoute(req, res, next) {
  const { promptHint, sampleResponse } = parseBody(req);
  const truncated = truncateForPrompt(sampleResponse);

  // Attempt 1
  const first = await suggester.suggest({ sampleResponse: truncated, promptHint });
  const v1 = await applyTransform(first.expression, sampleResponse);
  if (isValid(v1)) {
    return ok({ expression: first.expression, warning: null });
  }

  // Attempt 2 — feed the failure back
  const second = await suggester.suggest({
    sampleResponse: truncated,
    promptHint,
    previousAttempt: { expression: first.expression, error: formatValidationError(v1) },
  });
  const v2 = await applyTransform(second.expression, sampleResponse);
  if (isValid(v2)) {
    return ok({ expression: second.expression, warning: null });
  }

  return ok({
    expression: second.expression,
    warning: { kind: "validation-failed", message: formatValidationError(v2) },
  });
}
```

`isValid(result)` is the strict array-of-objects check (`error === null && records.length > 0 && records.every(r => typeof r === "object" && r !== null && !Array.isArray(r))`).

`formatValidationError(result)` returns a model-readable string. When `result.error` is non-null, return `"applyTransform reported a {kind} error: {message}"`. When `result.error` is null but the strict check failed, classify and explain:

- `records.length === 0` → `"the expression returned 0 records; the response shape needs an expression that produces at least one record"`.
- `records.some(r => Array.isArray(r) || typeof r !== "object" || r === null)` → `"the expression returned non-object records (got primitives or nested arrays); each record must be a plain object"`.

`JsonataSuggestError` from either attempt propagates up to the `ApiError` handler — a model failure means **no expression to return**, distinct from a validation failure (which produces an expression that's flagged but still returned).

Validation runs against the **full** sample response, not the truncated version. The model never sees the full response, but the validator does — this catches expressions that work on the first 5 elements of an array but choke on element 6 (e.g. an unexpected null in a `.user.name` access). When this happens, the retry's `previousAttempt.error` carries the runtime-error message, which is the right information for the model to fix on the next try.

### `JsonataSuggester` contract

```ts
export interface JsonataSuggesterInput {
  /** Pre-truncated sample. The suggester does not re-truncate. */
  sampleResponse: unknown;
  /** Optional natural-language hint from the user. */
  promptHint?: string;
  /**
   * Set on retry. Carries the prior model output + the validation error
   * `applyTransform` produced for it. The prompt builder renders this as
   * a "## Previous attempt" section so the model can correct course.
   */
  previousAttempt?: { expression: string; error: string };
}

export interface JsonataSuggesterOutput {
  expression: string;
}

export interface JsonataSuggester {
  suggest(input: JsonataSuggesterInput): Promise<JsonataSuggesterOutput>;
}

export class JsonataSuggestError extends Error {
  override readonly name = "JsonataSuggestError" as const;
  readonly reason: JsonataSuggestErrorReason;
  constructor(reason: JsonataSuggestErrorReason, message: string, options?: ErrorOptions);
}

export type JsonataSuggestErrorReason =
  | "malformed-response"
  | "timeout"
  | "network-error";
```

The route catches `JsonataSuggestError` and translates to `ApiError(502, REST_API_TRANSFORM_SUGGEST_FAILED, …)` — the `reason` discriminator goes into the structured log line, not into the API response body (telemetry-only, mirrors the classifier).

The Haiku-backed implementation enforces a Zod response schema on `generateObject`'s output:

```ts
const SuggesterResponseSchema = z.object({
  expression: z.string().min(1),
});
```

A schema failure raises `JsonataSuggestError("malformed-response", …)`. A network/timeout error from the SDK raises `JsonataSuggestError("network-error" | "timeout", …)`, branching on `(err as Error).name === "AbortError"` exactly like the classifier.

---

## Surface

### HTTP

```text
POST /api/connector-instances/suggest-transform
```

Mounted on `connectorInstanceRouter` (the existing router in `apps/api/src/routes/connector-instance.router.ts`). `getApplicationMetadata` middleware provides `organizationId` (required for auth scoping, even though the route does not load any org-scoped rows).

Request body (`SuggestTransformRequestBodySchema`):

```ts
z.object({
  promptHint: z.string().max(2000).optional(),
  sampleResponse: z.unknown(),
});
```

`sampleResponse: z.unknown()` is deliberate — the route cannot validate the shape of an arbitrary HTTP response, only that the field exists. The `z.unknown()` parse succeeds for any JSON-decodable value including `null`.

Response body — `SuggestTransformResponseSchema`:

```ts
z.object({
  expression: z.string(),
  warning: z
    .object({
      kind: z.literal("validation-failed"),
      message: z.string(),
    })
    .nullable(),
});
```

Status codes:

| Status | Body | When |
|---|---|---|
| 200 | `{ expression, warning: null }` | First or second attempt validated. |
| 200 | `{ expression, warning: { kind, message } }` | Both attempts produced expressions that failed validation; second expression returned with the warning. |
| 400 | `ApiErrorResponse` with `code: REST_API_INVALID_CONFIG` | Zod body validation failure (e.g. `promptHint` over 2000 chars, `sampleResponse` field missing). |
| 401 | `ApiErrorResponse` | Auth middleware rejects. |
| 502 | `ApiErrorResponse` with `code: REST_API_TRANSFORM_SUGGEST_FAILED` | `JsonataSuggestError` from either attempt (model timeout / network / malformed response). |
| 500 | `ApiErrorResponse` with `code: REST_API_OPERATION_FAILED` | Unhandled exception (defensive catch-all). |

OpenAPI doc comment in `connector-instance.router.ts` follows the existing `probe-endpoint-draft` shape.

### SDK

```ts
// apps/web/src/api/api-connector.api.ts
apiConnector.endpoints.suggestTransform = () =>
  useAuthMutation<SuggestTransformResponse, SuggestTransformRequestBody>({
    url: "/api/connector-instances/suggest-transform",
    method: "POST",
  });
```

Consumed in the container as:

```ts
const { mutateAsync: suggestTransform, isPending, error: suggestError } =
  sdk.apiConnector.endpoints.suggestTransform();
```

No `queryClient.invalidateQueries` call — the route writes nothing, no React Query cache lines are stale.

### Frontend — `TransformSuggesterUI`

```ts
// apps/web/src/workflows/RestApiConnector/TransformSuggester.component.tsx
export interface TransformSuggesterUIProps {
  /** Current prompt-hint textarea value. */
  promptHint: string;
  onPromptHintChange: (value: string) => void;

  /** Fires the suggest mutation. Container owns the call. */
  onSuggest: () => void;

  /** True while the mutation is in flight. Disables the button + flips its label. */
  isSuggesting: boolean;

  /**
   * True when the button must remain disabled regardless of pending state —
   * i.e. when there's no sample response captured yet. Tooltip uses
   * `disabledReason` for the explanation.
   */
  disabled: boolean;
  disabledReason?: string;

  /** ServerError from the mutation, or null. Renders <FormAlert /> when set. */
  serverError?: ServerError | null;
}
```

Render shape:

- A `<TextField>` (multiline, `minRows={1}`, `maxRows={3}`, `fullWidth`) for `promptHint`. Placeholder per the issue: `Describe what records you want (optional) — e.g. "one row per order line item"`. `aria-label="Suggestion hint"`.
- A `<Button variant="contained" size="small">` next to (or beneath) the textarea. Label: `Suggesting…` when `isSuggesting`, else `Suggest`. Disabled when `disabled || isSuggesting`. When `disabled` is true, wrap in a `<Tooltip>` with `disabledReason` as the tooltip body.
- A `<FormAlert serverError={serverError} />` rendered below the button when `serverError != null`.

No internal state. The container manages `promptHint`, `isSuggesting`, `disabled`, `serverError`, and `onSuggest`. Storybook stories are deferred (Out of scope) — unit tests cover the visual matrix.

### Frontend — wiring in `ApiEndpointForm`

The existing container at `apps/web/src/workflows/RestApiConnector/ApiEndpointForm.component.tsx:376` already owns:

- `previewResponse: unknown | null` (line 390) — the sample response.
- `setDraft(d => ({ ...d, transform: ... }))` — the write path into the form's transform field.

New container additions:

1. `const [promptHint, setPromptHint] = useState("")` — local state, reset on modal open per the existing `useEffect` at line 410 (extend the reset block).
2. `const [suggestionWarning, setSuggestionWarning] = useState<{ kind: "validation-failed"; message: string } | null>(null)` — local state, also reset on modal open.
3. `const { mutateAsync: suggestTransform, isPending: isSuggesting, error: suggestErrorRaw } = sdk.apiConnector.endpoints.suggestTransform()`. Compute `const suggestServerError = toServerError(suggestErrorRaw)`.
4. New handler `handleSuggest`:
   ```ts
   const handleSuggest = async () => {
     if (!previewResponse) return; // defensive — button is disabled in this case
     try {
       const result = await suggestTransform({
         promptHint: promptHint.trim() || undefined,
         sampleResponse: previewResponse,
       });
       setDraft((d) => ({ ...d, transform: result.expression }));
       setSuggestionWarning(result.warning);
     } catch {
       // The mutation's `error` (now non-null) drives the FormAlert.
       // No additional handling needed — the warning state stays as it was.
     }
   };
   ```
5. Pass to `ApiEndpointFormUI`:
   - `promptHint`, `onPromptHintChange={setPromptHint}`
   - `onSuggest={handleSuggest}`
   - `isSuggesting`
   - `disabled={!previewResponse}`, `disabledReason="Run Preview first to capture a sample response."`
   - `suggestServerError`
   - `suggestionWarning`
6. `ApiEndpointFormUI` receives these and renders `TransformSuggesterUI` directly above `TransformEditorUI` inside the existing `extractionMode === "transform"` branch (the conditional block at `ApiEndpointForm.component.tsx:286-293`).
7. `TransformEditorUI`'s existing `serverError` prop is repurposed to surface the validation warning: when `suggestionWarning` is non-null, pass `{ kind: "runtime", message: suggestionWarning.message }` to the editor's `serverError` prop. (The existing prop shape is already `{ kind: "parse" | "runtime"; message: string } | null`; "runtime" is the closer match for "the expression we got back didn't produce valid records.") When the user edits the transform value, clear the warning.

The form's existing `Modal` is already a `form` element (per CLAUDE.md's Form & Dialog Pattern); the new Suggest button must use `type="button"` to avoid form submission.

---

## Validation

### Server-side

- Zod body schema (above). 400 with `REST_API_INVALID_CONFIG` on parse failure, mirroring `probe-endpoint-draft`.
- `applyTransform` validates the suggestion. The strict-array-of-objects check is a route-local helper, not exported from `transform.util.ts` (that util's contract stays minimal).
- The `JsonataSuggester` dep is constructor-injected on the route (or composed via a factory in the route module). Tests inject a fake suggester that emits scripted outputs; production wires `createDefaultJsonataSuggester()`.

### Client-side

- The Suggest button is disabled until `previewResponse != null` — the only user-facing precondition. Tooltip explains why.
- The `promptHint` textarea has no validation (it's free text up to 2000 chars; the server caps the same way).
- The transform-textarea's pre-existing validation (mutual exclusion with `recordsPath`, max-length) continues to apply after replacement — the form's existing `validateEndpoint` runs on submit.

### Accessibility

- Suggest button: `aria-label="Suggest a JSONata transform"`. When wrapped in a `<Tooltip>` for the disabled state, the tooltip body conveys the reason.
- Prompt-hint textarea: visible label or `aria-label="Suggestion hint"`. Placeholder text is supplementary, not a substitute for a label (existing pattern in `ApiEndpointFormUI`).
- `FormAlert` provides `role="alert"` automatically.
- The validation warning surfaces through `TransformEditorUI`'s existing `<Alert severity="warning">` block (which already meets the accessibility bar).

---

## Tests

Unit tests are required for each unit; integration tests cover the route end-to-end and the container wiring. Run via `npm run test:unit` (per CLAUDE.md — never invoke jest directly).

| Unit | File | Coverage |
|---|---|---|
| `truncateForPrompt` | `apps/api/src/__tests__/adapters/rest-api/jsonata-suggest.prompt.test.ts` (truncation section) | Primitives pass through; arrays ≤5 unchanged; arrays >5 sliced + `__truncated__` sentinel; nested objects/arrays recursed; null preserved |
| `buildJsonataSuggestPrompt` | same file | Sample renders as pretty JSON; hint section omitted when unset, present when set; "Previous attempt" section omitted when unset, present + carries error message when set; deterministic across two calls |
| `createDefaultJsonataSuggester` | `apps/api/src/__tests__/adapters/rest-api/jsonata-suggest.haiku.test.ts` | Calls `generateObject` with the schema; returns the expression on success; throws `JsonataSuggestError("malformed-response")` on Zod failure; throws `JsonataSuggestError("timeout")` on `AbortError`; throws `JsonataSuggestError("network-error")` on other thrown errors; logs success + error structured events |
| Route | `apps/api/src/__tests__/routes/suggest-transform.router.test.ts` (new) | 200 first-try valid; 200 retry-then-valid; 200 retry-fails with warning; 400 on Zod body failure; 502 on suggester error; auth required (401); validation runs against full response not truncated sample |
| SDK | `apps/web/src/__tests__/api/api-connector.api.test.ts` (extend if exists, new otherwise) | `useAuthMutation` shape correct; URL + method correct |
| `TransformSuggesterUI` | `apps/web/src/workflows/RestApiConnector/__tests__/TransformSuggester.test.tsx` (new) | Renders textarea + button; typing fires `onPromptHintChange`; clicking fires `onSuggest`; disabled state shows tooltip with `disabledReason`; button label is "Suggesting…" when `isSuggesting`; `FormAlert` renders when `serverError != null` |
| `ApiEndpointForm` container wiring | `apps/web/src/workflows/RestApiConnector/__tests__/ApiEndpointForm.test.tsx` (extend) | Suggest button disabled before Preview; clicking Preview enables Suggest; clicking Suggest replaces `transform`; warning surfaces in `TransformEditorUI`'s alert when present; suggest server error surfaces in `TransformSuggesterUI`'s `FormAlert`; modal reset clears `promptHint` + `suggestionWarning` |

Test-helper notes:

- Mock `sdk.apiConnector.endpoints.suggestTransform` via `jest.unstable_mockModule` in the container test, matching the existing `__tests__` pattern.
- The route test stubs the `JsonataSuggester` via a fake suggester injected through the route module's factory (mirrors how the classifier is stubbed in `rest-api.adapter.test.ts`).
- `truncateForPrompt` tests use small fixtures with known counts — N=5 vs N=6 vs N=10 edge cases pin the sentinel placement.

---

## Migration / rollout

- **No DB migration.** The feature is pure-compute across `core`, `api`, and `web`.
- **No environment config.** The Anthropic provider is already wired for the classifier; no new secrets, no new feature flags.
- **No backward-compatibility shims.** The feature is purely additive: new contract types, new route, new SDK endpoint, new UI component. Existing endpoints and existing transforms are untouched.
- **Telemetry.** The route logger emits a structured event per call (mirroring the classifier's `interpret.llm.call`): `event: "rest-api.transform-suggest"`, `attempts: 1 | 2`, `validatedFirstAttempt: boolean`, `warningReturned: boolean`, `inputTokens`, `outputTokens`, `latencyMs`. Errors emit `event: "rest-api.transform-suggest.error"` with the `JsonataSuggestError.reason`. No frontend telemetry beyond the existing React Query devtools surface.

---

## Open follow-ups (deferred, not blocking v1)

- **Cache by sample-response hash.** If telemetry shows duplicate clicks, add a 60-second in-process cache. Hash inputs: organizationId + `JSON.stringify(sampleResponse)` + `promptHint` (or `""`). Mirrors `probe-cache.util.ts`.
- **Per-org rate limiting.** Haiku calls are cheap but not free; if real-world usage spikes, add a token-bucket per org. Probably a request handler concern rather than route-local.
- **Refine-from-current.** Pass the user's existing `transform` value as `previousAttempt` (sans error) so the model treats it as a starting point. The dep contract already supports this; the SDK request body would gain a `currentExpression?: string` field.
- **Storybook stories for `TransformSuggesterUI`.** Join the workflow's broader Storybook pass.
- **Confidence-score support** if the response schema ever grows it. The model would have to emit one; the UI would have to render it. Out of v1.

---

## Next step

Plan at [`docs/REST_API_JSONATA_SUGGEST.plan.md`](./REST_API_JSONATA_SUGGEST.plan.md) slices the work into ~7 TDD-shaped commits on this same branch. Each slice is a green test suite gate; the only user-visible change lands in the last slice (the container wiring). No DB migrations, no schema changes — the feature is pure-additive across `core`, `api`, and `web`.
