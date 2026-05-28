# REST API connector — pre-commit probe + transform — Discovery

**Issue:** _(unfiled — to be created when spec lands)_
**Status:** Decisions locked. Ready for `docs/REST_API_PRE_COMMIT_PROBE.spec.md`.

**Why this exists.** Two coupled gaps in today's REST API connector create flow:

1. **Field-mapping suggestion + confirmation happens post-commit, not in the workflow.** Step 3 ("Probe & review") renders manual-entry tables only, because the probe + AI classifier pipeline (`POST /api/connector-instances/:id/api-endpoints/:entityId/discover-columns`) is keyed on a persisted `connectorEntityId` that doesn't exist yet. Users commit the connector blind, then re-open the detail view to actually see suggestions. Every other connector (FileUpload, GoogleSheets, MicrosoftExcel) does suggestion + confirmation **before** commit.
2. **`recordsPath` is too limiting for real-world JSON shapes.** It covers "records live at `data.items`" but falls over on multi-source-array responses, deeply nested objects, or shapes that need projection/filtering before they're useful. Users with complex APIs have no way to express the extraction; the AI classifier downstream needs flat input to do anything useful.

The two interact: a pre-commit probe is the right place to give users a live preview of an extraction expression, and the extraction is what determines whether the probe returns anything worth classifying. They ship together.

## The current shape

### REST API workflow today (commit-then-probe)

| Concern | Where | What it does |
|---|---|---|
| Workflow container | `apps/web/src/workflows/RestApiConnector/RestApiConnectorWorkflow.component.tsx:249` | Holds draft state for basics + endpoints + per-endpoint column rows. Owns `onCommit` |
| Probe-review step (create flow) | `RestApiConnectorWorkflow.component.tsx:212–232` | Passes `stateByKey: { kind: "idle" }` for every endpoint + `reprobeDisabled` with the hint "Save the connector to enable probing." No probe call fires |
| Per-endpoint review UI | `apps/web/src/workflows/RestApiConnector/EndpointColumnReview.component.tsx:27–36` | Four states: `idle` / `loading` / `success` / `empty` / `error`. Only `idle` ever shows in create flow |
| Inferred columns table | `apps/web/src/workflows/RestApiConnector/InferredColumnsTable.component.tsx` | Per-row editor: `sourceField`, `normalizedKey`, `type`, `required`, plus `SuggestionChip` when a `.suggestion` is present |
| Endpoint form | `apps/web/src/workflows/RestApiConnector/ApiEndpointForm.component.tsx` | Modal collecting key, label, path, method, recordsPath, idField, bodyTemplate, pagination |
| Commit | `RestApiConnectorWorkflow.component.tsx:306–396` | `sdk.connectorInstances.create()` → per-endpoint `sdk.apiConnector.endpoints.createForInstance()` (route handler materializes column_definitions + field_mappings) |
| Probe pipeline (post-commit only) | `apps/api/src/adapters/rest-api/rest-api.adapter.ts:559–697` | `discoverColumnsWithSamples(instance, entityKey)` — heuristic inference + optional Haiku 4.5 classifier against a one-page probe. Cached 60s by `connectorEntityId` |
| Probe HTTP surface | `apps/api/src/routes/api-endpoints.router.ts:1005–1078` | `POST /api/connector-instances/:instanceId/api-endpoints/:entityId/discover-columns` — requires both ids to exist |
| Records extraction | `recordsPath` field in endpoint config, walked in `apps/api/src/adapters/rest-api/` | Simple dotted path through the response; no projection, no flattening, no multi-source |

### Reference pattern (spreadsheet workflows: interpret-then-review)

| Concern | Where | What it does |
|---|---|---|
| Draft-only interpret route | `apps/api/src/routes/layout-plans.router.ts:65–115` | `POST /api/layout-plans/interpret` — pure-compute, no ConnectorInstance created, no rows persisted. Body carries draft config; response carries the inferred plan |
| Service-layer driver | `LayoutPlanDraftService.interpretDraft(organizationId, userId, body)` | Calls `interpret()` against draft + org column-definitions catalog |
| Atomic commit (later) | `POST /api/layout-plans/commit` | Async job creates `connectorInstance` + `layoutPlan` + `connectorEntities` + bulk `columnDefinitions` + `fieldMappings` together |
| Frontend wiring | `apps/web/src/workflows/FileUploadConnector/*`, mirrored by GoogleSheets + Excel | Step "Review & configure" fires interpret on entry; user edits via `BindingEditorPopover`; commit at the end |

## Decisions

### 1. Draft probe is a dedicated route

`POST /api/connector-instances/probe-endpoint-draft`. Body carries the full draft: `{ organizationId (from auth), config: { baseUrl, auth }, credentials?, endpoint: { key, label, path, method, recordsPath?, transform?, idField, bodyTemplate?, pagination } }`. Response is the existing `DiscoverColumnsResult`. Pure compute, no row writes, no audit log entry.

Mirrors `POST /api/layout-plans/interpret`. Rejected alternatives:

- **Two-phase commit** (`status: "draft"` on the instance, finalize/discard later). Lifecycle burden: orphan rows on cancel/network drop, cleanup job, capability gates and sync eligibility have to learn about `draft` status. Violates the atomic-commit pattern.
- **Session-scoped probe cache** (workflow session id, server-side `Map`). Multi-replica fragility (or Redis = new dep), session-lifecycle design overhead, conflated auth boundary.

### 2. Service split — share the inner pipeline

Factor `discoverColumnsWithSamples` so the inner pipeline (build adapter context → drive iterator one page → slice to 25 → run `inferColumns` heuristic → optional classifier → tag degradation) is callable from both entry points. The post-commit route still loads `connectorInstances` + `apiEndpoints` rows first; the pre-commit route synthesizes the same shape from the request body. One service module, two thin route wrappers.

### 3. Auto-fire on step entry; cache by config hash

When the user navigates to step 3, the workflow container fires one probe per endpoint in parallel. Mirrors phase-4's wording ("Probe fires per-endpoint, on demand … when the user navigates to the probe-review step"). The existing 60-second in-process probe cache extends to key on `hash(orgId, draft endpoint config)` for the pre-commit path — back/forward navigation within 60s is free.

### 4. Re-probe on endpoint config change

Workflow state holds a per-endpoint probe-input hash. Editing path/method/recordsPath/transform/auth in step 2 marks that endpoint's cached result stale; the next step-3 entry re-fires for it. Re-probe button remains as a manual override (no longer disabled in create flow).

### 5. Credentials over the wire — plaintext, no server-side cache

The probe-draft body carries credentials in the same `CredentialsPayload` shape `connectorInstances.create` accepts. The route never persists them; they live for the request duration and are GC'd. TLS protects them on the wire (already true for the commit POST today). Server-side decrypted-credential caching is a security smell with no UX win — explicitly rejected.

**On client-side encryption of the credentials payload.** Considered and rejected. Any app-layer encryption we add has to be reversible by the server, because the server has to call the user's API with those credentials — meaning the server has to hold (or be able to derive) the decryption key. That puts us right back where TLS already has us: the server can read the credentials. App-layer encryption on top of TLS only helps if TLS itself is compromised, in which case the user has bigger problems than this one workflow. The meaningful protections — never log credentials, never persist them on the probe route, keep workflow draft state in React `useState` rather than `localStorage` — are already in place. Encrypting at the application layer would be theater; we're not adding it.

### 6. Commit shape unchanged

Step 4 still calls `sdk.connectorInstances.create()` then per-endpoint `createForInstance()` with the user-reviewed `columns` array. The only difference from today is that the user actually had real suggestions to review.

### 7. Probe failures surface as per-endpoint warnings; advancement allowed

Per-endpoint `EndpointColumnReview` shows the existing `error` state (`FormAlert` + manual-entry table) when its probe fails. Step-3-to-step-4 advancement is **not** blocked — one broken endpoint doesn't gate the others, and a user who knows the endpoint shape can commit with manual rows. The warning replaces today's silent fall-through to manual.

### 8. Edit-mode workflow stays on the post-commit route

The split is naturally driven by `EndpointRow.entityId`: set → route through `discoverColumns(instanceId, entityId)`; unset (create flow) → route through `probe-endpoint-draft`. Both share the inner service (decision 2). No edit-mode refactor in this PR.

### 9. Transform language: JSONata

A JSONata expression (`jsonata` npm package, pure JS) takes the raw HTTP response and returns the records array. Safe by design — no I/O, no globals, no eval. Same library runs server-side (probe + sync) and browser-side (live preview in the editor). Stored as text in the endpoint config JSONB.

Rejected:

- **jq** (WASM or `node-jq`): Bash-y syntax, harder UX, binary/WASM dependency.
- **JMESPath** (AWS-style): simpler than JSONata but awkward for multi-source-array flattens, which is the case driving this work.
- **Sandboxed JS** (`isolated-vm`): full power, but native dep, per-call CPU/memory caps to enforce, audit surface to maintain. Reserved as the upgrade path if JSONata ever proves insufficient.
- **Server-side `eval`** of user JS: RCE. Hard no.

#### JSONata primer (for reviewers + future doc authors)

JSONata is a query and transformation language designed specifically for JSON. Reference: [jsonata.org](https://jsonata.org/) — playground at [try.jsonata.org](https://try.jsonata.org/). The mental model is "XPath for JSON" plus projection, filtering, conditionals, and a small set of built-in functions. It is **not** a general-purpose programming language — no I/O, no loops you can write, no access to the host environment. That's the property that makes it safe to run on user-provided input.

A transform expression in our world is: a JSONata string whose evaluation against the raw HTTP response returns an **array of flat objects**. The server runs it once per probe (preview) and once per page during sync. Downstream inference + AI classifier always sees a flat records array, regardless of how complex the source response is.

The four shapes that motivate adding this:

**Case 1 — records nested under one path (`recordsPath` equivalent).**

```jsonc
// Response
{ "status": "ok", "data": { "items": [ { "id": 1 }, { "id": 2 } ] } }

// JSONata
data.items

// Yields
[ { "id": 1 }, { "id": 2 } ]
```

If your API only ever needs this shape, leave `recordsPath` set and don't touch `transform`. The transform field is for the cases below.

**Case 2 — records split across multiple top-level arrays.** The case that `recordsPath` can't handle at all.

```jsonc
// Response
{
  "active_users":   [ { "id": 1, "status": "active"   } ],
  "archived_users": [ { "id": 2, "status": "archived" } ]
}

// JSONata
[active_users, archived_users].$$

// Yields
[ { "id": 1, "status": "active" }, { "id": 2, "status": "archived" } ]
```

`[a, b]` builds a sequence of the two arrays; `.$$` flattens it. (`$$` is JSONata's root reference; in `[a, b].$$` it spreads each inner array into the outer sequence.)

**Case 3 — flattening nested objects into top-level columns.** AI classifier works best on flat records.

```jsonc
// Response
{
  "data": [
    { "id": 1, "user": { "name": "Ada",  "email": "ada@x.test"  } },
    { "id": 2, "user": { "name": "Grace","email": "grace@x.test"} }
  ]
}

// JSONata
data.{
  "id":         id,
  "user_name":  user.name,
  "user_email": user.email
}

// Yields
[
  { "id": 1, "user_name": "Ada",   "user_email": "ada@x.test"   },
  { "id": 2, "user_name": "Grace", "user_email": "grace@x.test" }
]
```

`data.{ ... }` projects each element of `data` through the object constructor on the right. Field names are arbitrary; values can be any JSONata expression.

**Case 4 — filtering + projection together.**

```jsonc
// Response
{
  "results": [
    { "id": 1, "active": true,  "deleted_at": null },
    { "id": 2, "active": false, "deleted_at": "2025-01-01" },
    { "id": 3, "active": true,  "deleted_at": null }
  ]
}

// JSONata
results[active = true and deleted_at = null].{
  "id":   id,
  "name": $lookup($, "name") ? $lookup($, "name") : "(unknown)"
}

// Yields
[ { "id": 1, "name": "(unknown)" }, { "id": 3, "name": "(unknown)" } ]
```

Predicates in `[ ]`; the ternary-style `cond ? a : b` for fallback values.

Operators worth knowing for v1: `.` (selector), `[]` (predicate or index), `.{ }` (projection), `[a, b]` (sequence build), `$$` (flatten / context), `~>` (function chain), `$lookup($, "field")` (dynamic key access), `$count(...)`, `$exists(...)`, `$type(...)`. The full reference is at [docs.jsonata.org](https://docs.jsonata.org/) — for our purposes the four cases above cover the bulk of what users hit.

**Things JSONata can't do (intentional limits).** No HTTP, no file I/O, no `eval`, no async, no recursion you can write yourself. If a user has a transform that genuinely needs imperative logic — for example, decoding a binary blob, calling a second endpoint to enrich each record, or running their own custom parser — that's the case where decision 9's noted upgrade path (sandboxed JS via `isolated-vm`) would come into play. Out of scope for v1.

### 10. Transform is mutually exclusive with `recordsPath`

Endpoint config carries either `recordsPath: "data.items"` *or* `transform: "<jsonata expression>"`, not both. Simple endpoints stay simple; advanced users opt in. Layering both would create "which runs first?" confusion and two ways to express the same extraction. No forced migration — existing endpoints keep `recordsPath`. Validation rejects configs that set both.

### 11. Transform editor lives in `ApiEndpointForm`

A collapsible "Advanced — transform" section beneath `recordsPath` in the existing endpoint modal. Expanding it switches the form into transform mode (recordsPath input hidden + cleared on submit). The section shows a code editor (textarea-grade is fine for v1; Monaco is a nice-to-have) and — if the probe has already fired for this endpoint — a live preview pane: raw response JSON on the left, transformed records on the right, parse/runtime errors inline. Preview uses the same JSONata lib client-side (~50kB gzipped, acceptable bundle hit) so there's no extra server round-trip per keystroke.

### 12. Transform execution sites: probe + sync

- **Probe** (workflow draft route + post-commit detail-view route): apply transform after fetch, before the slice-to-25 + inference + classifier pipeline. Inference always sees flat records.
- **Sync** (production runs): apply transform after each page fetch, before the wide-table reconciler. Same service module.

Both server-side. The JSONata runtime is one shared utility (`apps/api/src/adapters/rest-api/transform.util.ts`, new). Errors at sync time fail the page like any other adapter error and surface through the existing sync-job error path.

### 13. Field-mapping review UX — adopt the spreadsheet chip + popover pattern (deferred to v1.5)

The "consistent with other workflows" claim deserves to be sharper. The existing **InferredColumnsTable** is structurally divergent from how every other workflow lets the user review AI suggestions, and the gap is *feature*, not stylistic:

| | Spreadsheet workflows | REST API workflow today |
|---|---|---|
| Where reviews live | `apps/web/src/modules/RegionEditor/ReviewStep.component.tsx` + `BindingEditorPopover.component.tsx` (chip-row + popover editor) | `apps/web/src/workflows/RestApiConnector/InferredColumnsTable.component.tsx` (inline-cell row editor) |
| Row affordance | Chip per source-field-bound mapping; click to edit | Table row with inline `TextField` / `Select` / `Checkbox` cells |
| Override target ColumnDefinition | `AsyncSearchableSelect` inside the popover | **Missing** — only the `type` enum is editable |
| Reference-field editor | Yes (for `reference` types) | **Missing** |
| Exclude-from-import toggle | Yes (omit) | **Missing** (delete row only) |
| Derived normalizedKey default | Yes (source-field-derived default with override) | Free-text only — no derivation |
| Per-row validation surface | Popover-scoped errors, Apply disabled until clean | **Missing** — `errors` prop exists at `InferredColumnsTable.component.tsx:54`, never consumed |

Two paths:

- **Path A — bundle the UX swap into v1.** Extract `BindingEditorPopover` from `modules/RegionEditor/` into a thinner shared module (it already lives under `modules/`, so the lift is slimming + props-cleanup, not creation) and render chips-per-suggestion in the REST review step. Deletes `InferredColumnsTable`. Adds ~2–3 slices to the plan (extraction, REST review-step rewrite, tests).
- **Path B — v1 ships JSONata + pre-commit AI suggestions on the existing `InferredColumnsTable`; v1.5 swaps the UX.** Keeps the current PR scoped to the load-bearing user wins (real suggestions before commit, complex JSON works). UX consistency lands separately so reviewers can evaluate the data-flow change without an entangled UI rewrite.

**Decision: Path B.** The current plan is already 8 slices; the popover adoption is its own substantial slice cluster and deserves an isolated review. File a follow-up issue at v1 ship time — "REST API workflow: adopt BindingEditorPopover for column review" — that captures the missing affordances explicitly: ColumnDefinition picker, reference-field editor, exclusion toggle, surfaced per-row validation, chip-row layout.

Open question for v1: do we surface a soft hint in the v1 review step that ties suggestions back to ColumnDefinitions in the catalog (e.g. show the matched `columnDefinitionId` in the `SuggestionChip` tooltip), or stay strictly on what the user can change inline? Recommendation: hint-only, no behavior change — the chip already tooltips the rationale (`SuggestionChip` rendering at `InferredColumnsTable.component.tsx:96-100`); adding the matched catalog label costs nothing and primes users for the v1.5 picker.

### 14. AI classifier is shape-agnostic; the transform's real job is feeding `inference.util.ts` shallow records

Decision 2 ("service split — share the inner pipeline") was right but undersold *why* JSONata projection matters. The classifier prompt at `apps/api/src/adapters/rest-api/classifier.prompt.ts:75` reads "REST API record **fields**" — no spreadsheet-isms, no input-shape assumptions beyond `(field, samples)` candidate objects (`apps/api/src/adapters/rest-api/classifier.types.ts:25-32`). **No prompt change needed.**

The constraint lives one layer earlier. `apps/api/src/adapters/rest-api/inference.util.ts:107` walks `Object.keys(record)` exactly once — top-level keys only. Given `{ user: { name: "Ada", email: "ada@x.test" } }`, inference emits **one** candidate: `user` with `inferredType: "json"`. The classifier never sees `name` or `email` separately, confidence is low, and the suggestion is useless.

That is the precise reason JSONata projection (`data.{ "user_name": user.name, "user_email": user.email }`) is load-bearing. It is not "the AI prefers flat input"; it is "**inference is shallow by design, and the transform is the explicit user-facing surface for flattening.**" Worth saying out loud because it informs two downstream choices:

- **Don't teach inference to recurse.** Considered. Rejected: (a) hides the flattening decision from the user (opaque heuristics replace explicit JSONata), (b) inflates candidate counts and classifier token costs proportional to nesting depth × breadth, (c) creates a "why `user_name` vs. `user.name` vs. `user[name]`?" naming ambiguity that JSONata makes explicit.
- **Inference + classifier output shape is unchanged.** The shared inner pipeline (decision 2) takes flat records in either way (`recordsPath` extraction or `transform` projection). No downstream signature touches; degradation tag (decision 4-section in plan slice 4) adds `"transform-failed"` and is the only schema delta in the result envelope.

Implication for spec / plan: no classifier-prompt changes in scope; the spec's narrative should foreground the "shallow inference is the reason transform exists" framing rather than the looser "AI likes flat input".

### 15. Sandboxed JS — fuller comparison + the upgrade path is gated, not free

Decision 9 reserved sandboxed JS as "the upgrade path if JSONata ever proves insufficient" in one line. Expanding because the cost of getting there is non-trivial and the gating criteria should be written down before the question shows up in a customer call.

**When JSONata genuinely isn't enough.** Concrete shapes:

- Decoding Base64-wrapped JSON-in-JSON, custom delimiter formats, or other payloads where the user wants imperative parsing.
- Per-record enrichment that needs a lookup table the user wants to embed inline rather than as a second endpoint.
- Custom date-format coercions JSONata's `$fromMillis` / format strings don't cover (e.g. ISO-8601 with non-UTC offsets that the API returns as separate fields).
- Conditional projections where the branch depth exceeds what `?` / `:` keep readable.

Most of these can be brute-forced in JSONata (`$eval`, predicate chains, `$reduce`), but the result is unreadable. Readability cost is the trigger, not raw expressiveness.

**Sandbox runtime options:**

| Option | Native dep | Sandbox model | CPU/mem caps | Audit footprint | Status |
|---|---|---|---|---|---|
| `isolated-vm` | Yes (V8 isolates) | Strong — separate V8 isolate per call | Yes, per-isolate | Moderate; mature, actively maintained | Production-viable |
| `quickjs-emscripten` | No (WASM) | Strong — WASM-sandboxed JS interpreter | Yes, via host | Smaller — interpreter, not embedded V8 | Production-viable, ~5–10× slower than V8 but acceptable for 25-record probe + per-page sync |
| `vm2` | No | Was strong, then broken | Yes | **Deprecated** — repeated escape CVEs, no longer maintained | Hard no |
| Node built-in `vm` | No | None (shares the parent context) | No | N/A — not a sandbox | Hard no |
| Server-side `eval` | No | None | No | RCE | Hard no |

**`quickjs-emscripten` is the leading candidate** when/if we promote: no native dep simplifies deploys, slower-but-acceptable perf, smaller audit surface, and it fits a feature gated by usage signals.

**Gating criteria — when to actually build this:**

1. ≥3 distinct user reports of "JSONata won't express what we need", each with a concrete payload example JSONata genuinely can't handle (not "JSONata is hard to write", which is a docs / library problem).
2. Per-org allowlist, off by default. Sandboxed JS is more powerful than JSONata; not every customer's transforms need or want that power. New column on `organizations` — e.g. `featureFlags: { sandboxedJsTransforms?: boolean }` — gates the second language toggle in the UI.
3. Endpoint config schema migrates: `transform: string` becomes `transformExpression: string` + `transformLanguage: "jsonata" | "sandboxedJs"`. Existing rows default to `"jsonata"`.

**Dual-language UI implications (cost of promotion):**

- Language toggle in the transform editor (one more piece of state).
- Two live-preview pipelines: JSONata client-side via the existing lib; sandboxed JS would need either a WASM interpreter client-side (~200kB gzipped extra) or a per-keystroke debounced server round-trip.
- Two validation paths, two error-classification shapes.
- Doc / help text forks.

That UX complexity is the second reason to gate by per-org allowlist — most orgs see "transform" as JSONata-only with no toggle visible.

v1 ships JSONata only. This decision documents the upgrade path so v1's schema (decision 10) doesn't paint into a corner — `transform` becomes `transformExpression` + `transformLanguage` in a minor schema iteration if/when the gate trips. The migration is a rename + default backfill, no data shape change.

### 16. Re-probe + edit invalidation — explicit invalidation set + hash mechanics

Decision 4 said "workflow state holds a per-endpoint probe-input hash" without specifying the inputs, where the hash is computed, or what the user sees during re-probe. Tightening:

**The full invalidation set:**

Per-endpoint config (from `EndpointDraft` at `ApiEndpointForm.component.tsx:25-34`):

- `path`, `method`, `recordsPath`, `transform` (new), `idField`, `bodyTemplate`
- `pagination.*` — all nested fields: `strategy`, `param`, `style`, `pageSize`, `cursorParam`, `cursorPlacement`, `cursorResponsePath`

Instance-level config (from `RestApiConnectorWorkflow.component.tsx:310-316`):

- `baseUrl`
- `auth.mode`, plus the auth-mode-specific shape (`auth.keyName` + `auth.placement` for apiKey; `auth.tokenLocation` for bearer; basic carries everything in the credentials secret)

Credentials payload:

- The full `CredentialsPayload` value. Editing a secret invalidates every endpoint's hash.

**Explicitly NOT invalidating:** `endpoint.key`, `endpoint.label`. Rename-only display fields; no probe semantics. Editing label shouldn't blow the cache.

**Where the hash is computed.** Client-side. A new util at `packages/core/src/utils/probe-hash.util.ts` (in `core` so both sides share it):

1. Builds a minimal projection of the input set above (drops `key` / `label`).
2. Canonicalizes via stable-key JSON stringify (so `{a:1,b:2}` and `{b:2,a:1}` hash identically).
3. Computes `sha256` via the browser-native `crypto.subtle.digest` on the web side and Node's `node:crypto` on the API side — no new dependency.

No existing client-side hashing utility — confirmed by surveying the workflow (`crypto` imports only appear in `RegisterToolpackDialog` for HMAC signing). The util is ~30 lines + tests.

**When the hash is computed.**

- On modal save (`ApiEndpointForm.onSubmit`) against the just-saved endpoint draft + current instance config + credentials.
- On workflow mount, across every endpoint in state. Matters for edit-mode hydration; create-mode mounts with no endpoints so this is a no-op there.
- On instance-level field changes (baseUrl, auth, credentials) — re-hash **every** endpoint's hash simultaneously (the hash inputs include instance scope).

**Where the hash lives.** Augment the per-endpoint state shape from plan slice 6:

```ts
interface EndpointRow {
  draft: EndpointDraft;
  entityId?: string;           // existing
  probeInputHash: string;      // new — what should be probed against right now
  probeState: EndpointProbeState; // new (slice 6) — what was probed, including the hash it ran with
}
```

The probe-fire condition is `probeState.hash !== probeInputHash`. Equal → cached result is fresh, no fire. Unequal → fire and update `probeState` on settle. This collapses decision 4's "stale" notion into a single equality check.

**Server-side echo + cache key.** The probe-draft route's response includes the hash it ran with, and the server keys its 60-second in-process cache on the same hash (per decision 3's "cache by config hash"). One hash function across client and server (`packages/core/src/utils/probe-hash.util.ts`), consumed by both sides. Drift detection is essentially free.

**Mid-reprobe UX.** Reuse `EndpointColumnReviewUI`'s existing state machine (`apps/web/src/workflows/RestApiConnector/EndpointColumnReview.component.tsx:27-36`). The `loading` state already renders correctly — suggestion chips fade out, an inline progress hint replaces them, the rest of step 3 stays interactive. No full-step spinner overlay; per-endpoint cards re-fire independently.

**Edit-mode feedback (optional polish, deferrable).** When a user opens `ApiEndpointForm` and changes a probe-affecting field (path / method / recordsPath / transform / pagination / etc.), surface a tiny inline hint beneath that field: "This will re-probe on next step." Visual only — the re-probe fires automatically on step-3 entry regardless. Out of scope if it complicates v1; the auto-fire alone is enough for correctness.

## Scope notes

**In this PR:**

- New route + service + tests for `probe-endpoint-draft`.
- `discoverColumnsWithSamples` factored to share the inner pipeline.
- Transform utility (server + client-shared JSONata wrapper).
- Endpoint config schema accepts `transform` and validates the mutual-exclusion with `recordsPath`.
- Frontend: workflow auto-fires probes on step-3 entry, per-endpoint cache invalidation on config edit, transform editor + live preview in `ApiEndpointForm`, `reprobeDisabled`/`reprobeDisabledHint` plumbing removed.
- Per-endpoint probe-input hash util in `packages/core` (decision 16); consumed by both client cache-staleness check and server 60-second in-process cache key.
- Migration: none — `transform` is a new optional column/field on the endpoint config JSONB; no existing rows touched.

**Out of scope:**

- Edit-mode workflow refactor (stays on the post-commit `discoverColumns` route).
- Monaco-grade editor; v1 ships with a `<textarea>` plus syntax-error surfacing. Monaco is a follow-up if users ask.
- **Adoption of `BindingEditorPopover` for the REST review step** (decision 13, Path B). v1 keeps the existing `InferredColumnsTable` and lights up real suggestions inside it; the chip + popover swap, ColumnDefinition picker, reference-field editor, exclusion toggle, and surfaced per-row validation land as a follow-up issue at ship time.
- A sandboxed-JS escape hatch beyond JSONata. Gating criteria + runtime comparison documented in decision 15; not built until they trip.
- Classifier-prompt changes. Per decision 14, the prompt is already shape-agnostic; the JSONata transform is what makes nested responses tractable.
- Bulk transform helpers (e.g. a library of common JSONata snippets in the UI). Deferrable.
