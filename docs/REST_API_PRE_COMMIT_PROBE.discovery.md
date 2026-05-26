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

## Scope notes

**In this PR:**

- New route + service + tests for `probe-endpoint-draft`.
- `discoverColumnsWithSamples` factored to share the inner pipeline.
- Transform utility (server + client-shared JSONata wrapper).
- Endpoint config schema accepts `transform` and validates the mutual-exclusion with `recordsPath`.
- Frontend: workflow auto-fires probes on step-3 entry, per-endpoint cache invalidation on config edit, transform editor + live preview in `ApiEndpointForm`, `reprobeDisabled`/`reprobeDisabledHint` plumbing removed.
- Migration: none — `transform` is a new optional column/field on the endpoint config JSONB; no existing rows touched.

**Out of scope:**

- Edit-mode workflow refactor (stays on the post-commit `discoverColumns` route).
- Monaco-grade editor; v1 ships with a `<textarea>` plus syntax-error surfacing. Monaco is a follow-up if users ask.
- A sandboxed-JS escape hatch beyond JSONata. Re-evaluate after real usage.
- Bulk transform helpers (e.g. a library of common JSONata snippets in the UI). Deferrable.
