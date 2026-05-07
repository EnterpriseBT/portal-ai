# Custom Toolpack Registration — Discovery

## Goal

Let an organization register **custom toolpacks** — collections of related
tools served by an external webhook — and use them on stations and portal
sessions exactly the way the built-in packs are used today. Today
"tool packs" and "organization tools" are two unrelated concepts that the
UI never reconciles:

- **Built-in packs** (`data_query`, `statistics`, `regression`,
  `financial`, `web_search`, `entity_management`) are string slugs hard-
  coded in `apps/api/src/services/tools.service.ts` (`ALL_TOOL_PACKS`,
  line 79). Each pack expands into a fixed set of in-process `Tool`
  classes when a station session boots. Stations record which packs they
  enable as `stations.tool_packs jsonb<string[]>`.
- **Organization tools** (`organization_tools` table) are *single*
  webhook tools — one row = one `name + parameterSchema + url`. They
  attach to stations through the `station_tools` join. Each row produces
  one `WebhookTool` at session-build time.

So a user who wants "five related custom tools" today registers five
unrelated rows. There is no UI listing them. There is no documentation
surface. Built-in packs and custom tools never appear in the same view.

The new concept is a **toolpack** — a named bundle of related tools,
backed either by in-process classes (built-in) or by a webhook contract
(custom). One page lists both. One modal explains what any pack does.
Stations and portal sessions enable packs uniformly. Custom packs can
be added, edited, or removed by an organization admin; built-in packs
are read-only.

Concretely, the work has three parts:

1. **Backend**: introduce a toolpack-level entity and a registration
   contract for custom packs (schema endpoint + runtime endpoint +
   optional metadata endpoint). Reshape the tool-build path in
   `tools.service.ts` so built-ins and customs go through the same
   "expand pack → tools" interface.
2. **Frontend**: a new `/toolpacks` page with a filterable + sortable
   table of all packs (built-in + custom), a register/edit/delete flow
   for custom packs, and a shared metadata modal reachable from the
   table row, the station-detail tool-pack chip, and the portal-session
   tool-pack chip.
3. **Domain alignment**: stations reference packs by stable identifier
   (built-in slug or custom-pack id) rather than the loose string array
   they use today.

Out of scope for this discovery:

- A marketplace or cross-organization sharing of custom packs. v1 is
  per-organization only.
- AI-assisted authoring of toolpack schemas. The org provides a JSON
  Schema for each tool just as `organization_tools` does today.
- Versioning of custom packs over time. v1 fetches the schema at
  registration (and on explicit refresh); rev history is a follow-up.
- Replacing the existing built-in packs with HTTP-served equivalents.
  Built-ins stay in-process; the discovery doc only unifies how they
  are *presented and selected*, not how they are *executed*.
- Per-tool gating inside a custom pack (i.e. "enable 3 of 5 tools in
  this pack"). v1 enables packs whole, matching how built-ins work.
- Replacing the `WebhookTool` class. v1 reuses it under the hood; a
  pack just becomes a fan-out over multiple `WebhookTool` instances
  pointing at the same runtime endpoint with different `tool` names.

---

## Existing State

### Tool-pack execution path

The single source of truth for "what tools does this station expose?" is
`ToolService.buildAnalyticsTools` in
`apps/api/src/services/tools.service.ts:148`. It:

1. Loads the station and reads `station.toolPacks: string[]`.
2. For each enum slug it recognises (`data_query`, `statistics`,
   `regression`, `financial`, `web_search`, `entity_management`),
   instantiates the corresponding `Tool` classes and adds them to a
   `Record<string, Tool>` under the tool's slug.
3. Calls `buildCustomWebhookTools` (line 351), which loads
   `station_tools` rows joined to `organization_tools`, and for each
   row builds a `WebhookTool` from the row's
   `parameterSchema + implementation`. A `PACK_TOOL_NAMES` set (line
   100) blocks any custom tool that collides with a built-in slug.

Adding a new built-in pack today is a matter of: add slug to
`ALL_TOOL_PACKS`, add `if (enabledPacks.has("…"))` block, add tool
classes to `PACK_TOOL_NAMES`. Adding a custom tool is: insert
`organization_tools` row, link via `station_tools`. There is **no**
intermediate "custom pack" concept — every custom tool is a flat row.

### `organization_tools` schema

`apps/api/src/db/schema/organization-tools.table.ts:9-22`:

| Column | Type | Notes |
|---|---|---|
| `name` | text | Unique within org. |
| `description` | text | Human-readable. |
| `parameterSchema` | jsonb | JSON Schema for tool inputs. |
| `implementation` | jsonb | `{type:"webhook", url, headers?}`. |

The contract layer (`packages/core/src/contracts/organization-tool.contract.ts`)
exposes list / get / create / update / delete endpoints. The router
(`apps/api/src/routes/organization-tools.router.ts`) enforces unique
name within org and applies soft-delete via the base repository.

The webhook tool implementation lives in
`apps/api/src/tools/webhook.tool.ts`: it converts the stored JSON
Schema to a Zod schema at runtime via a `jsonSchemaToZod` helper
(line 90, supports `string | number | integer | boolean | array | object`),
then `POST`s to the configured URL with the validated input.

### Frontend tool-pack surface

- Pack labels: `apps/web/src/utils/tool-packs.util.ts` —
  `TOOL_PACK_LABELS` is a hand-maintained `Record<string, string>` that
  maps the built-in slugs to display names. Unknown slugs fall back to
  the raw key.
- Pack icons: `apps/web/src/utils/tool-pack-icons.util.ts` resolves an
  icon component for each slug.
- Pack chip: `apps/web/src/components/ToolPackChip.component.tsx` is a
  thin `<Chip>` that combines the icon + label. It accepts arbitrary
  `Chip` props so callers can attach `onDelete`, etc.
- Where chips appear today:
  - `views/StationDetail.view.tsx:211` — the station's enabled packs
    rendered as a chip stack inside `MetadataList`.
  - `views/Portal.view.tsx:194` — the same stack inside the portal
    session header.
  - `components/CreateStationDialog.component.tsx`,
    `components/EditStationDialog.component.tsx` — pack pickers when
    creating/editing a station.
  - `components/DefaultStationCard.component.tsx`,
    `components/StationList.component.tsx` — read-only previews.
- Custom-tool surface today: just the API. There is **no UI** for
  `organization_tools`, no list page, no register dialog, no row in the
  sidebar nav (`apps/web/src/components/SidebarNav.component.tsx:208-258`).

The SDK already exposes `sdk.organizationTools.list/get/create/update/remove`
(`apps/web/src/api/organization-tools.api.ts`). They are unused by any
view.

### Stations' `toolPacks` field

`apps/api/src/db/schema/stations.table.ts:16` —
`toolPacks: jsonb('tool_packs').$type<string[]>().notNull()`. This is a
loose string array: "valid" values today are exactly the six built-in
slugs. Anything else is silently ignored by `buildAnalyticsTools`.
Edit/create dialogs render only the six options; no custom slug ever
lands in here.

### Where metadata for built-in packs lives today

It does not, in any structured form. The labels live in
`tool-packs.util.ts`. The list of tools per pack is implicit in the
`if`-blocks of `buildAnalyticsTools`. Tool descriptions live as fields
on the individual `Tool` classes (`tool({ description: … })`). There is
no per-pack summary, no examples, nothing the UI can render. So the new
"metadata modal" needs a metadata source that does not exist yet —
even for the built-ins.

---

## Approach

The work decomposes into four concerns. Each is independently
discussable in spec; together they constitute the v1.

### 1. The toolpack as a first-class entity

Today the noun "tool pack" is a string. v1 promotes it to a record. The
record is a discriminated union by `kind`:

- **`kind: "builtin"`** — slug, label, icon, summary, list of tools
  with descriptions and examples. Sourced from a code-resident registry
  (a new file under `apps/api/src/registries/builtin-toolpacks.ts`).
  Read-only.
- **`kind: "custom"`** — backed by a new `organization_toolpacks` row
  with the registration fields below. Read/write to org admins.

A single `GET /api/toolpacks` endpoint returns both, ordered however
the table needs. The API does the merge so the frontend stays simple
(no client-side concat of two query results).

The record shape both kinds emit:

```ts
{
  id: string;            // builtin: "builtin:data_query"; custom: org-tool id
  kind: "builtin" | "custom";
  slug: string;          // unique within (org, kind); used in station_toolpacks.builtin_slug for built-ins
  name: string;          // display label
  description: string | null;
  iconUrl?: string | null;
  tools: Array<{
    name: string;
    description: string;
    parameterSchema: Record<string, unknown>;
    examples?: Array<{ title?: string; description?: string; input?: unknown; output?: unknown }>;
  }>;
  // custom-only
  endpoints?: { schema: string; runtime: string; metadata?: string };
  authHeaders?: Record<string, string>;  // returned redacted
  schemaFetchedAt?: number;
}
```

### 2. The custom-toolpack registration contract

A custom toolpack is registered with three URLs. The org provides:

| URL | Method | Required | Purpose |
|---|---|---|---|
| `schema` | GET | yes | Returns `{ tools: Array<{ name, description, parameterSchema }> }`. Fetched at registration and on explicit refresh. Defines what tools the pack exposes. |
| `runtime` | POST | yes | Called per tool invocation. Body: `{ tool: string, input: Record<string, unknown> }`. Response: arbitrary JSON, treated identically to the existing `WebhookTool` response contract (incl. `vega-lite` / `vega` envelopes). |
| `metadata` | GET | optional | Returns `{ summary?, tools: Array<{ name, description?, examples?: [...] }> }`. Used only by the metadata modal. If absent, the modal renders descriptions from the schema endpoint and omits examples. |

Auth is uniform across all three URLs: optional `headers` map provided
at registration time (same shape `organization_tools.implementation`
already supports). The schema and metadata endpoints are GETs with
those headers; the runtime endpoint is the existing
`WebhookTool` POST path.

Registration flow:

1. User submits `{ name, description?, endpoints, authHeaders? }` via
   the UI.
2. Backend `POST /api/toolpacks` fetches the schema endpoint and
   validates the response (each tool has a name, a description, a
   well-formed JSON Schema; tool names do not collide with built-ins;
   pack name does not collide with another pack in the same org).
3. If a metadata endpoint was supplied, fetch it once and cache the
   response on the row. Failures here are non-fatal — the pack
   registers without metadata.
4. Persist the row, return the merged toolpack record.

Refreshing a custom pack (re-fetching schema + metadata) is a new
explicit action, not an automatic background poll. v1 surfaces it as a
"Refresh" button in the edit dialog.

Storage shape — a new `organization_toolpacks` table:

| Column | Type | Notes |
|---|---|---|
| `…baseColumns` | | id, organizationId, audit, soft-delete. |
| `name` | text | Unique within org (with `deleted IS NULL`). |
| `description` | text | Nullable. |
| `endpoints` | jsonb | `{ schema, runtime, metadata? }`. |
| `authHeaders` | jsonb | Nullable. Redacted on read. |
| `tools` | jsonb | Cached normalised schema response: array of `{ name, description, parameterSchema }`. |
| `metadata` | jsonb | Cached normalised metadata response or null. |
| `schemaFetchedAt` | bigint | Unix ms; null until first fetch. |
| `metadataFetchedAt` | bigint | Same; null if endpoint never supplied or every fetch failed. |

`organization_tools` and `station_tools` are dropped outright. No
production org has ever had a UI to register `organization_tools` rows,
so the tables can be deleted with no data-migration step (confirmed by
the user). The replacement `organization_toolpacks` table is net-new
and starts empty.

The `station_toolpacks` join table is also new, and it is the **single
source of truth for which packs a station has enabled**, regardless of
kind. Each row references either a built-in slug or a custom-pack id:

| Column | Type | Notes |
|---|---|---|
| `…baseColumns` | | id, audit, soft-delete. |
| `station_id` | text NOT NULL | FK → stations. |
| `builtin_slug` | text NULL | Set when the row enables a built-in pack (e.g. `"data_query"`). Validated at write time against the in-code registry. |
| `organization_toolpack_id` | text NULL | FK → `organization_toolpacks`. Set when the row enables a custom pack. |

A CHECK constraint enforces XOR: exactly one of `builtin_slug` or
`organization_toolpack_id` must be non-null per row. A unique index on
`(station_id, COALESCE(builtin_slug, organization_toolpack_id))` (with
`deleted IS NULL`) prevents the same pack from being attached to a
station twice.

Correspondingly, `stations.toolPacks jsonb<string[]>` is **dropped** in
the same migration. Existing stations' slug arrays are migrated into
`station_toolpacks` rows (one row per slug, `builtin_slug` populated,
`organization_toolpack_id` null) as a one-shot data migration before
the column is removed. After the cut, "what packs does this station
have?" is a single query against the join table — no dual sources, no
slug-array branch.

### 3. Reshaping `ToolService.buildAnalyticsTools`

The fan-out becomes a single uniform loop over `station_toolpacks`:

```ts
async function buildAnalyticsTools(orgId, stationId, userId) {
  const tools: Record<string, Tool> = {};
  const enabled = await repo.stationToolpacks.findByStationId(stationId, {
    include: "organizationToolpack",
  });

  for (const row of enabled) {
    if (row.builtinSlug) {
      Object.assign(tools, await BuiltinToolpackRegistry.expand(row.builtinSlug, ctx));
    } else {
      Object.assign(tools, expandCustomPack(row.organizationToolpack!, stationId));
    }
  }

  return tools;
}
```

`expandCustomPack` walks the cached `tools` array on the org-toolpack
row and constructs one `WebhookTool` per entry. Each `WebhookTool` is
parameterized to call the pack's `runtime` URL with `{ tool: <name>,
input }` rather than POSTing the input bare. Because there is no
legacy `organization_tools` data to keep working, `WebhookTool`
switches unconditionally to the new `{tool, input}` payload shape — no
discriminator, no compat branch.

The `PACK_TOOL_NAMES` collision guard remains: a custom pack whose
schema endpoint advertises a tool named `sql_query` is rejected at
registration time, not at session-build time.

### 4. Frontend surface

#### New page: `/toolpacks`

Add `ApplicationRoute.Toolpacks = "/toolpacks"` to
`apps/web/src/utils/routes.util.ts`, a route file
`routes/toolpacks.index.tsx`, and a sidebar entry slotted between
"Stations" and "Connectors" (the most natural neighbours given the
information architecture).

The view is a `Toolpacks.view.tsx` rendering a single
filterable/sortable table built on the existing `DataTable`
infrastructure. Columns:

| Column | Notes |
|---|---|
| Name | Click → opens metadata modal. |
| Kind | `Built-in` / `Custom` chip. Filterable. |
| Description | Truncated. |
| # Tools | Numeric, sortable. |
| Last refreshed | Custom only; built-ins show "—". |
| Actions | Edit + Delete `IconButton`s, mirroring `views/ColumnDefinitionDetail.view.tsx:542` (`actionsColumn` in `FieldMappingTable`). Disabled / hidden for `kind === "builtin"`. |

A "Register toolpack" primary action button on the page header opens
the register dialog.

#### Register / Edit dialogs

`RegisterToolpackDialog.component.tsx` and
`EditToolpackDialog.component.tsx`. Both follow the project's Form &
Dialog Pattern (Zod-validated, `<FormAlert>`, `useDialogAutoFocus`,
`focusFirstInvalidField`, etc.). Fields:

- Name (required, min 1, unique within org)
- Description (optional)
- Schema endpoint URL (required)
- Runtime endpoint URL (required)
- Metadata endpoint URL (optional)
- Auth headers (key/value table; values write-only, never re-displayed)

The register dialog runs the schema fetch on submit and surfaces fetch
errors inline (`<FormAlert>` server error code:
`TOOLPACK_SCHEMA_FETCH_FAILED`). The edit dialog adds a "Refresh
schema" button alongside the form fields.

`DeleteToolpackDialog.component.tsx` is a plain confirmation dialog
that warns when the pack is currently attached to one or more stations
(the API returns the impacted station list, similar to the
column-definition delete impact pattern).

#### Metadata modal

`ToolpackMetadataModal.component.tsx` — a single read-only modal that
renders a toolpack record. Shape:

- Header: name, kind chip, description.
- Tool list: collapsible per-tool sections with description, parameter
  schema (rendered as a small code block), and any examples from the
  metadata endpoint.

Mounted at three trigger sites:

1. The toolpacks table row click (inside `Toolpacks.view.tsx`).
2. `ToolPackChip` on `StationDetail.view.tsx:212` — wrap the chip in a
   click handler that opens the modal.
3. `ToolPackChip` on `Portal.view.tsx:194` — same wrap.

To support sites 2 + 3, `ToolPackChip` gains an optional
`onClick` prop and a default handler that resolves the slug → toolpack
via a new `sdk.toolpacks.get(idOrSlug)` query. A small wrapper
component (`ToolPackChipWithMetadata`) encapsulates the open-modal-on-
click behaviour so existing read-only call sites are unaffected.

#### SDK changes

Add `sdk.toolpacks` covering list / get / create / update / remove /
refresh. The existing `sdk.organizationTools` is removed (no compat
alias). `sdk.stationToolpacks` replaces `sdk.stationTools` for the join
operations. Mutation `onSuccess` callbacks invalidate
`queryKeys.toolpacks.root`, `queryKeys.stations.root` (because attached
station counts change), and `queryKeys.stationToolpacks.root` per the
project's mutation cache invalidation policy.

#### Built-in metadata source

A new file `packages/core/src/registries/builtin-toolpacks.ts` exports
a frozen array of built-in pack records (slug, name, description, icon
slug, tool list with descriptions + examples). The API hydrates the
list endpoint from this registry; the frontend imports the same
registry to seed the metadata modal without an extra round-trip when
the user clicks a built-in row. (The registry lives in `core` so both
sides see the same source. It is the *only* place built-in pack
metadata is authored; `tool-packs.util.ts` becomes a thin façade over
this registry and may be retired entirely.)

Tool descriptions inside the registry are extracted from the
existing `Tool` classes (each class already declares a description in
its `build()` call). v1 lifts those strings into the registry by hand;
a follow-up could codegen them.

---

## Recommended phasing

The work decomposes into phases that each ship independently and leave
the system in a working state.

| Phase | Scope | Why first |
|---|---|---|
| 1. **Built-in toolpack registry + unified station join** | Add `packages/core/src/registries/builtin-toolpacks.ts`. Replace `tool-packs.util.ts` with a thin lookup over the registry. Add `GET /api/toolpacks` returning **only** built-ins for now. Add the `/toolpacks` page rendering them read-only with the metadata modal. Create the `station_toolpacks` join table (with built-in-slug branch only — `organization_toolpack_id` column nullable but unused this phase), migrate `stations.toolPacks` array data into rows, drop the `stations.toolPacks` column. Drop `organization_tools` / `station_tools` tables and their SDK + contracts (no production data to migrate). Update `buildAnalyticsTools` to read enabled packs from the join. | Establishes the registry, the page shell, the modal, and the unified storage shape so phase 2 only adds the custom-pack write path on top — no schema reshaping in the substantive phase. |
| 2. **Custom toolpack registration** | Add `organization_toolpacks` table, registration contract (schema + runtime + optional metadata endpoints), Register/Edit/Delete dialogs, custom-pack rows in the `/toolpacks` table. Wire the existing `station_toolpacks.organization_toolpack_id` FK. Stations gain a custom-pack picker alongside the built-in checkboxes. | The substantive feature. Purely additive on top of phase 1 — no station-side schema changes. |
| 3. **Wire metadata modal into chips** | Make `ToolPackChip` clickable on `StationDetail.view.tsx` and `Portal.view.tsx`. Resolve slug → toolpack via `sdk.toolpacks.get`. | Last user-facing polish. Cosmetic-only without phase 2 because there are no custom packs to inspect. |
| 4. **Refresh / validation niceties** | Background refresh policy for custom packs (manual button only in v1; cron-based refresh deferred). Tool-name collision warnings in the register dialog. | Optional follow-up. Deferred unless evals or feedback show it is load-bearing. |

Phase 1 is mechanical. Phase 2 is the meat. Phase 3 is small but
worth its own spec because it touches three trigger sites and the
chip's existing prop surface.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Schema endpoint returns malformed or oversize JSON. | Cap response size (e.g. 256 KB), validate with a strict Zod schema (`{tools: Array<{name, description, parameterSchema}>}`), reject the registration with a clear server-error code rather than persisting partial data. |
| Custom pack tool names collide with built-ins. | The existing `PACK_TOOL_NAMES` collision check in `tools.service.ts:100` runs at *registration* time too, not just session-build. Reject with `TOOLPACK_TOOL_NAME_CONFLICT` so the user sees the failure synchronously. |
| Webhook URLs point at internal/private addresses. | Reuse the existing webhook-tool fetch path; if the org wants SSRF protections beyond what's there today (which is none), that is a separate hardening discovery and is called out as a known gap rather than blocking v1. |
| `WebhookTool` payload shape changes from bare input to `{tool, input}`. | No legacy data depends on the old shape (no production `organization_tools` rows exist), so the switch is unconditional — no discriminator, no compat branch in `WebhookTool.execute`. |
| Built-in pack metadata drifts from the actual tool descriptions in `tools/*.tool.ts`. | The registry is the source of truth; tool classes import their description from the registry rather than redeclaring it. (Or, if that is too invasive in v1: add a unit test that asserts every built-in tool's class-level description matches the registry entry.) |
| Stations grow a "ghost" custom-pack reference when a pack is deleted. | Delete cascades through `station_toolpacks` (already the project convention). Cache invalidation also fires on `stations.root` so the station-detail view reflects the change immediately. |
| Metadata endpoint is slow / unreliable. | The fetch is one-shot at registration time and on explicit refresh; runtime tool calls never hit it. Failures are non-fatal — the modal renders without examples and shows a small "metadata unavailable" notice. |
| Auth headers leak through API responses. | The list/get endpoints redact `authHeaders` on read (return `{ has: true }` rather than the actual values). Only the create/update endpoints accept new values. Same pattern as connector instance credentials. |
| The `/toolpacks` page becomes a dumping ground for arbitrary custom-tool surfaces (no curation). | The metadata modal is the curation. A pack with a missing description or zero examples *renders* — but it renders sparsely and obviously, which is the natural pressure on the registering org to do better. v1 does not lint or block on this. |
| Stations editing UX gets noisy when there are many custom packs. | Pack picker in `Edit/CreateStationDialog` switches from inline checkboxes to an `AsyncSearchableSelect` once a station's org has more than ~6 custom packs. (Reuses existing component.) |

---

## Decision points for the spec phase

1. **One pack record across kinds vs. two parallel resources.**
   Recommend: one merged record from `GET /api/toolpacks`, kind-tagged.
   Avoids client-side concat and keeps the table component dumb.
2. **Whether the `station_toolpacks` join uses one nullable-FK pair
   or a discriminator column.** Recommend: two nullable columns
   (`builtin_slug`, `organization_toolpack_id`) with a CHECK that
   exactly one is non-null. No explicit `kind` column; kind is
   implicit in which column is set. FK integrity is preserved for
   custom rows, and built-in slugs are validated at write time
   against the in-code registry rather than via a referential
   constraint.
3. **Schema fetch caching policy.** Recommend: cache forever, refresh
   on explicit user action only. Background refresh + drift detection
   is phase 4.
4. **Built-in pack metadata authorship.** Recommend: hand-author the
   registry in v1 (one file, ~60 entries across 6 packs). Codegen
   from `Tool` class descriptions is a follow-up if the registry
   drifts in practice.
5. **Tool-name uniqueness scope.** Pack names are unique within an
   org, **and** every tool name across all enabled packs on a single
   station must be unique (otherwise the AI tool record collides).
   Recommend: enforce pack-name uniqueness at registration; enforce
   tool-name uniqueness at session-build time with a clear error code,
   and surface a pre-flight collision warning in the station-edit
   dialog.
6. **Whether the metadata endpoint can include rendered Markdown.**
   Recommend: plain strings only in v1. Markdown rendering opens
   sanitisation questions out of scope for this discovery.
7. **`SidebarNav` placement.** Recommend: between "Stations" and
   "Connectors" — toolpacks are most-often referenced from stations
   and the sidebar already groups by "things stations consume".

---

## Files touched (anticipated)

The list below is per-phase, not exhaustive — each phase will get its
own spec with a precise file plan.

**Phase 1 (built-in registry + unified station join + drop legacy)**

Registry + page shell:

- `packages/core/src/registries/builtin-toolpacks.ts` *(new)* — frozen
  array of built-in pack metadata.
- `packages/core/src/contracts/toolpack.contract.ts` *(new)* — list /
  get response schemas.
- `apps/api/src/routes/toolpacks.router.ts` *(new)* — `GET /api/toolpacks`,
  `GET /api/toolpacks/:id`. Returns built-ins only in this phase.
- `apps/api/src/app.ts` — mount the new router.
- `apps/web/src/api/toolpacks.api.ts` *(new)* — SDK helpers.
- `apps/web/src/api/sdk.ts`, `keys.ts` — register the new domain.
- `apps/web/src/utils/routes.util.ts` — add `Toolpacks` enum entry.
- `apps/web/src/routes/toolpacks.index.tsx` *(new)* — route file.
- `apps/web/src/views/Toolpacks.view.tsx` *(new)* — table view.
- `apps/web/src/components/ToolpackMetadataModal.component.tsx` *(new)*.
- `apps/web/src/components/SidebarNav.component.tsx` — new entry.
- `apps/web/src/utils/tool-packs.util.ts` — collapse into a thin façade
  over the new registry.

Unified station-pack join (replaces `stations.toolPacks` jsonb):

- `apps/api/src/db/schema/station-toolpacks.table.ts` *(new)* — join
  table with `builtin_slug` + `organization_toolpack_id` nullable
  columns and the XOR CHECK described above.
- `apps/api/src/db/repositories/station-toolpacks.repository.ts` *(new)*.
- `apps/api/src/db/schema/zod.ts`, `type-checks.ts` — register the
  new table.
- New Drizzle migration: create `station_toolpacks`, copy each row of
  `stations.tool_packs` (jsonb array) into one join row per slug
  (`builtin_slug` populated, `organization_toolpack_id` null), then
  drop `stations.tool_packs` and any indexes on it.
- `apps/api/src/db/schema/stations.table.ts` — remove the `toolPacks`
  column.
- `packages/core/src/models/station.model.ts`,
  `packages/core/src/contracts/station.contract.ts` — drop
  `toolPacks` from the schema; expose enabled packs via the existing
  `include` mechanism on station GETs.
- `apps/api/src/routes/station.router.ts` — replace `toolPacks` array
  handling on create/update with calls into the new join repository.
- `apps/api/src/services/tools.service.ts:148` — read enabled packs
  from `station_toolpacks` (built-in branch only this phase) instead
  of `station.toolPacks`.
- `apps/web/src/components/{Create,Edit}StationDialog.component.tsx`,
  `views/StationDetail.view.tsx`, `views/Portal.view.tsx`,
  `components/StationList.component.tsx`,
  `components/DefaultStationCard.component.tsx` — all references to
  `station.toolPacks` redirected to the new include payload.

Drop the legacy single-tool plumbing (no production data to preserve):

- New Drizzle migration: drop `organization_tools`, `station_tools`.
- Remove `apps/api/src/db/schema/organization-tools.table.ts`,
  `station-tools.table.ts`, related repositories and routers.
- Remove `apps/web/src/api/organization-tools.api.ts` and any SDK refs.
- Remove `packages/core/src/{models,contracts}/organization-tool*` and
  `station-tool*` files (and their tests).
- Remove `buildCustomWebhookTools` in
  `apps/api/src/services/tools.service.ts:351` (re-added over the new
  shape in phase 2).

**Phase 2 (custom toolpacks)**

- New table: `organization_toolpacks`. Drizzle schema, drizzle-zod,
  type-checks, repository.
- New Drizzle migration: create `organization_toolpacks`. The
  `station_toolpacks.organization_toolpack_id` FK was already created
  nullable in phase 1; this migration is purely additive.
- New Zod model in `packages/core/src/models/toolpack.model.ts` —
  pack + tool sub-schema, implementation auth schema.
- Extend `packages/core/src/contracts/toolpack.contract.ts` with
  register / update / delete bodies; the list response shape changes
  to a discriminated union including the custom kind.
- `apps/api/src/services/toolpack-registration.service.ts` *(new)* —
  schema + metadata fetch, validation, persistence. Reused on
  registration and on explicit refresh.
- `apps/api/src/routes/toolpacks.router.ts` — extend with
  POST/PATCH/DELETE/POST refresh.
- `apps/api/src/services/tools.service.ts` — extend the pack fan-out
  to handle the custom-pack branch (built-in branch from phase 1
  unchanged).
- `apps/api/src/tools/webhook.tool.ts` — switch unconditionally to the
  pack-style `{tool, input}` payload.
- New web components: `RegisterToolpackDialog.component.tsx`,
  `EditToolpackDialog.component.tsx`,
  `DeleteToolpackDialog.component.tsx`. Tests + stories per the
  Form/Dialog patterns.
- `apps/web/src/views/Toolpacks.view.tsx` — register button, custom
  rows, actions column.
- `apps/web/src/components/{Create,Edit}StationDialog.component.tsx`
  — custom-pack picker section.

**Phase 3 (chip → modal)**

- `apps/web/src/components/ToolPackChip.component.tsx` — accept
  `onClick`.
- `apps/web/src/components/ToolPackChipWithMetadata.component.tsx`
  *(new)* — wrapper that opens the modal.
- `apps/web/src/views/StationDetail.view.tsx:211`,
  `apps/web/src/views/Portal.view.tsx:194` — swap `ToolPackChip` for
  the wrapper at trigger sites.

**Phase 4 (deferred)**

- Refresh-policy cron, drift detection, tool-name pre-flight in
  station-edit. Each warrants its own discovery if it lands.

No changes to portal session rendering, `data-table` output handling,
or pinned-result storage are required: custom-pack tools return JSON
through the same `WebhookTool` path that already feeds into the chat
stream.
