# Custom Toolpack Registration — Phase 1 — Spec

**Promote toolpacks to a first-class concept in the storage layer and surface a read-only `/toolpacks` page for built-in packs.** Phase 1 also reshapes how stations record their enabled packs (jsonb array → join table) and removes the legacy single-tool plumbing (`organization_tools`, `station_tools`). After this phase, custom toolpack registration in phase 2 is purely additive: the registry path, the `/toolpacks` page, and the `station_toolpacks` join all exist; only the `organization_toolpacks` table and the registration write paths remain to be added.

Discovery: `docs/CUSTOM_TOOLPACK_REGISTRATION.discovery.md`. Resolved decision points (D1–D7):

- **D1 (one merged record vs. two parallel resources):** ratified. `GET /api/toolpacks` returns one kind-tagged record list. Phase 1 only emits `kind: "builtin"` rows; the response shape already includes the discriminator so phase 2 is additive.
- **D2 (`station_toolpacks` shape):** ratified. Two nullable columns (`builtin_slug`, `organization_toolpack_id`) with a CHECK constraint enforcing XOR. No explicit `kind` column. Phase 1 uses only `builtin_slug`; the FK column is created nullable but is unused until phase 2.
- **D3 (schema fetch caching):** N/A in phase 1 (no custom packs yet).
- **D4 (built-in pack metadata authorship):** ratified. Hand-authored in `packages/core/src/registries/builtin-toolpacks.ts`. v1 contains six entries (one per existing built-in pack) with full tool listings + at least one example per tool drawn from existing analytics test fixtures.
- **D5 (tool-name uniqueness):** N/A in phase 1 (no custom packs to collide).
- **D6 (Markdown in metadata):** ratified. Plain strings only. The registry holds plain text; the modal renders text-only.
- **D7 (`SidebarNav` placement):** ratified. New "Toolpacks" entry between "Stations" and "Connectors".

After this phase: visit `/toolpacks` to see the six built-in packs; click any row to open a metadata modal listing the pack's tools, descriptions, and examples; `stations.toolPacks jsonb` is gone, replaced by `station_toolpacks` rows; `tool-packs.util.ts` is a thin lookup over the registry; `organization_tools` and `station_tools` no longer exist; nothing about the model's tool execution behaviour changes.

---

## Scope

### In scope

1. **Built-in toolpack registry** (`packages/core/src/registries/builtin-toolpacks.ts`) — frozen array of six `BuiltinToolpack` records. Source of truth for pack name, description, icon slug, and tool list with examples. Imported by both API and web.
2. **Toolpack contracts** (`packages/core/src/contracts/toolpack.contract.ts`) — `ToolpackSchema` (kind-tagged record), `ToolpackListResponsePayloadSchema`, `ToolpackGetResponsePayloadSchema`. Phase 1 only handles built-in `kind`; the discriminated union already includes the `"custom"` arm so phase 2 doesn't reshape contracts.
3. **API list/get endpoints** (`apps/api/src/routes/toolpacks.router.ts`) — `GET /api/toolpacks`, `GET /api/toolpacks/:id`. Read-only. Returns built-in packs only.
4. **`station_toolpacks` join table** — new Drizzle table with `(station_id, builtin_slug, organization_toolpack_id)` columns and an XOR CHECK. Repository with `findByStationId`, `replaceForStation`, single-row create/delete.
5. **Drop `stations.toolPacks` jsonb** — Drizzle migration (a) creates `station_toolpacks`; (b) inserts one join row per slug for each existing station; (c) drops the `tool_packs` column. Single migration, single transaction.
6. **Update station model + contract + router** — `Station` model loses `toolPacks`; the create/update station endpoints accept `toolPacks: string[]` in the request body but persist them as `station_toolpacks` rows via the new repo. List/get responses include enabled packs via an `include=toolpacks` query parameter (project's standard include-join convention). Default include is on for backward-compatible read shape.
7. **Update `buildAnalyticsTools`** — read enabled packs from `stationToolpacks.findByStationId` instead of `station.toolPacks`. Phase 1 only handles the `builtin_slug` branch; `organization_toolpack_id` rows raise an "unsupported" error (cannot be created in phase 1 anyway since there are no custom packs).
8. **Drop legacy single-tool plumbing** — delete `organization_tools` and `station_tools` tables, repositories, routers, contracts, models, SDK helpers, integration tests. Remove `buildCustomWebhookTools` from `tools.service.ts`. Single Drizzle migration.
9. **Web `/toolpacks` page** — sortable + filterable `DataTable` rendering the merged toolpack list (built-ins only this phase). Click row → metadata modal. New sidebar entry.
10. **Web call sites that read `station.toolPacks`** — redirect to the new include payload. Affected: `EditStationDialog`, `CreateStationDialog`, `StationDetail.view`, `Portal.view`, `StationList`, `DefaultStationCard`, plus their tests.

### Out of scope

- Custom toolpack registration. No `organization_toolpacks` table, no `Register/Edit/Delete` dialogs, no schema/runtime/metadata fetch logic. Phase 2.
- The metadata modal being reachable from `ToolPackChip` on station detail or portal session — it's only reachable from the table row this phase. Phase 3.
- `WebhookTool` payload-shape change (`{tool, input}`). No webhook tool exists to call in phase 1; the change lands in phase 2 alongside the executor.
- Per-org pack seeding or per-org pack overrides. Built-ins remain code-resident.
- Any change to the underlying analytics tools (`describe_column`, `correlate`, etc.) or the `Tool` classes that implement them. Phase 1 only changes how packs are *named, listed, and selected* — not how they execute.
- New sidebar icons; pick an existing MUI icon (`Extension` or `Category`) for the Toolpacks entry.

---

## Concept changes

### Naming

- "Tool pack" (two words) → **"Toolpack"** (one word) everywhere user-facing — page title, sidebar entry, modal heading. Internal type names use `Toolpack` (not `ToolPack`). The legacy `ToolPackChip` component name keeps its existing camel-case until phase 3 (it is renamed there along with the chip wrapper). The `tool_packs` snake-case in DB is gone after phase 1.
- The string slugs (`data_query`, `statistics`, …) are unchanged — they continue to identify built-in packs in `station_toolpacks.builtin_slug` and the registry.

### `kind` discriminator

Toolpack records carry `kind: "builtin" | "custom"`. Phase 1 only ever emits `"builtin"`, but the discriminator is fixed in the contract so phase 2's added rows fit the existing shape.

---

## Surface

### Built-in toolpack registry

**File: `packages/core/src/registries/builtin-toolpacks.ts`** (new)

```ts
import { z } from "zod";

export const BuiltinToolpackSlugSchema = z.enum([
  "data_query",
  "statistics",
  "regression",
  "financial",
  "web_search",
  "entity_management",
]);

export type BuiltinToolpackSlug = z.infer<typeof BuiltinToolpackSlugSchema>;

export interface ToolpackToolExample {
  title?: string;
  description?: string;
  input?: unknown;
  output?: unknown;
}

export interface ToolpackTool {
  name: string;
  description: string;
  parameterSchema: Record<string, unknown>;
  examples?: ToolpackToolExample[];
}

export interface BuiltinToolpack {
  slug: BuiltinToolpackSlug;
  name: string;            // display label, e.g. "Data Query"
  description: string;     // one-paragraph summary
  iconSlug: string;        // existing MUI icon name; resolved on the web side
  tools: ToolpackTool[];
}

export const BUILTIN_TOOLPACKS: ReadonlyArray<BuiltinToolpack> = Object.freeze([
  {
    slug: "data_query",
    name: "Data Query",
    description: "Run SQL queries, render visualizations, and resolve identities across an entity group.",
    iconSlug: "Database",
    tools: [
      { name: "sql_query",       description: "...", parameterSchema: { /* … */ }, examples: [/* … */] },
      { name: "visualize",       description: "...", parameterSchema: { /* … */ } },
      { name: "visualize_tree",  description: "...", parameterSchema: { /* … */ } },
      { name: "resolve_identity", description: "...", parameterSchema: { /* … */ } },
    ],
  },
  // statistics, regression, financial, web_search, entity_management …
] as const);

export const BUILTIN_TOOLPACK_BY_SLUG: Record<BuiltinToolpackSlug, BuiltinToolpack> =
  Object.freeze(
    Object.fromEntries(
      BUILTIN_TOOLPACKS.map((p) => [p.slug, p])
    ) as Record<BuiltinToolpackSlug, BuiltinToolpack>
  );

export function isBuiltinToolpackSlug(s: string): s is BuiltinToolpackSlug {
  return s in BUILTIN_TOOLPACK_BY_SLUG;
}
```

The `parameterSchema` value for each tool is the same JSON Schema string the corresponding `Tool` class produces today (from its Zod `inputSchema`). Phase 1 hand-authors these inline; deriving them from `Tool.prototype.schema` is a follow-up if drift becomes a real problem.

The `examples` array is required for at least the *first* tool in each pack — the modal renders sparsely if a tool has zero examples, which is acceptable. v1 ships at least one example per pack so the modal has visible content for every built-in.

### Toolpack contracts

**File: `packages/core/src/contracts/toolpack.contract.ts`** (new)

```ts
import { z } from "zod";

const ToolpackToolExampleSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
});

const ToolpackToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameterSchema: z.record(z.string(), z.unknown()),
  examples: z.array(ToolpackToolExampleSchema).optional(),
});

const BuiltinToolpackRecordSchema = z.object({
  id: z.string(),               // "builtin:<slug>"
  kind: z.literal("builtin"),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  iconSlug: z.string(),
  tools: z.array(ToolpackToolSchema),
});

// Phase 2 will extend this to a discriminated union with a `custom` arm.
// Phase 1 already exports the `Toolpack` discriminator so consumers don't
// need a contract reshape later.
export const ToolpackSchema = z.discriminatedUnion("kind", [
  BuiltinToolpackRecordSchema,
]);

export type Toolpack = z.infer<typeof ToolpackSchema>;

export const ToolpackListRequestQuerySchema = z.object({
  search: z.string().optional(),
  kind: z.enum(["builtin", "custom"]).optional(),
});
export type ToolpackListRequestQuery = z.infer<typeof ToolpackListRequestQuerySchema>;

export const ToolpackListResponsePayloadSchema = z.object({
  toolpacks: z.array(ToolpackSchema),
  total: z.number(),
});
export type ToolpackListResponsePayload = z.infer<typeof ToolpackListResponsePayloadSchema>;

export const ToolpackGetResponsePayloadSchema = z.object({
  toolpack: ToolpackSchema,
});
export type ToolpackGetResponsePayload = z.infer<typeof ToolpackGetResponsePayloadSchema>;
```

`kind` filter at the API: phase 1 honors only `"builtin"`; `?kind=custom` returns an empty list (not an error). This keeps phase 2 a no-op on the route signature.

### API endpoints

**`GET /api/toolpacks`** (auth required, org-scoped via `getApplicationMetadata`)

- Query: `search?`, `kind?` (validated by `ToolpackListRequestQuerySchema`).
- Behavior:
  - Materialize the built-in array from `BUILTIN_TOOLPACKS`, mapping each to a `ToolpackSchema` record with `id = "builtin:" + slug` and `kind = "builtin"`.
  - If `search` is set, case-insensitively filter on `name`, `description`, and any tool `name` or `description`.
  - If `kind === "custom"`, return `{ toolpacks: [], total: 0 }` (no error).
  - No pagination this phase (six rows total). The response includes `total` for client-side rendering.
- Response: `200 { success: true, payload: { toolpacks, total } }`.

**`GET /api/toolpacks/:id`** (auth required)

- `:id` is the `builtin:<slug>` form. Anything else (including a UUID-shaped id) returns `404 TOOLPACK_NOT_FOUND` because phase 1 has no custom packs.
- Slug must be one of the registered built-ins; otherwise `404`.
- Response: `200 { success: true, payload: { toolpack } }`.

**Error codes** (`apps/api/src/constants/api-codes.constants.ts`)

- `TOOLPACK_NOT_FOUND`

No POST / PATCH / DELETE in phase 1.

### `station_toolpacks` join table

**File: `apps/api/src/db/schema/station-toolpacks.table.ts`** (new)

```ts
import { pgTable, text, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { stations } from "./stations.table.js";

export const stationToolpacks = pgTable(
  "station_toolpacks",
  {
    ...baseColumns,
    stationId: text("station_id")
      .notNull()
      .references(() => stations.id),
    builtinSlug: text("builtin_slug"),
    // FK column exists from phase 1 (nullable, unused) so phase 2's
    // `organization_toolpacks` migration is purely additive. The FK
    // constraint itself is added in phase 2 once the target table exists.
    organizationToolpackId: text("organization_toolpack_id"),
  },
  (table) => [
    // XOR: exactly one of (builtin_slug, organization_toolpack_id) must be set.
    check(
      "station_toolpacks_kind_xor",
      sql`(${table.builtinSlug} IS NULL) <> (${table.organizationToolpackId} IS NULL)`
    ),
    // Same pack cannot be attached to a station twice (live rows only).
    uniqueIndex("station_toolpacks_station_slug_unique")
      .on(table.stationId, table.builtinSlug)
      .where(sql`deleted IS NULL AND ${table.builtinSlug} IS NOT NULL`),
    uniqueIndex("station_toolpacks_station_orgtp_unique")
      .on(table.stationId, table.organizationToolpackId)
      .where(sql`deleted IS NULL AND ${table.organizationToolpackId} IS NOT NULL`),
  ]
);
```

Drizzle-zod schemas (`zod.ts`) and type-checks (`type-checks.ts`) follow the existing pattern for join tables.

### `StationToolpack` core model

**File: `packages/core/src/models/station-toolpack.model.ts`** (new)

```ts
import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

export const StationToolpackSchema = CoreSchema.extend({
  stationId: z.string(),
  builtinSlug: z.string().nullable(),
  organizationToolpackId: z.string().nullable(),
}).refine(
  (v) => (v.builtinSlug === null) !== (v.organizationToolpackId === null),
  { message: "Exactly one of builtinSlug / organizationToolpackId must be set" }
);

export type StationToolpack = z.infer<typeof StationToolpackSchema>;

export class StationToolpackModel extends CoreModel<StationToolpack> {
  get schema() { return StationToolpackSchema; }
  parse() { return this.schema.parse(this._model); }
  validate() { return this.schema.safeParse(this._model); }
}

export class StationToolpackModelFactory extends ModelFactory<
  StationToolpack,
  StationToolpackModel
> {
  create(createdBy: string): StationToolpackModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    return new StationToolpackModel(baseModel.toJSON());
  }
}
```

### `Station` model + contract update

**`packages/core/src/models/station.model.ts`** — drop `toolPacks` from `StationSchema`. Existing consumers will fail to type-check until they migrate to the include payload (see below). Drop `StationToolPackSchema` enum here entirely; the canonical list of built-in slugs lives in the registry now.

**`packages/core/src/contracts/station.contract.ts`** — drop `toolPacks` from `CreateStationBodySchema` and `UpdateStationBodySchema`. **Add** new fields:

```ts
toolPacks: z
  .array(z.string().min(1))
  .min(1, "Stations must enable at least one toolpack")
  .optional(),  // optional on update; required on create with default
```

The contract still sends a flat `toolPacks: string[]` over the wire — at this phase the only valid values are built-in slugs (registry lookup). Phase 2 will admit `organization_toolpack_id` strings prefixed with `custom:` or use a separate field; phase 1 doesn't predetermine that.

**Station list/get responses** — when `include=toolpacks` is supplied, the response embeds an `enabledToolpacks: string[]` field on each station, listing the built-in slugs currently joined via `station_toolpacks`. Default behaviour: `include=toolpacks` is implicit on `GET /api/stations` and `GET /api/stations/:id` so consumers don't have to opt in (the cost is one extra in-memory join over a small table). This avoids regressing existing list pages.

### Repository

**File: `apps/api/src/db/repositories/station-toolpacks.repository.ts`** (new)

```ts
export class StationToolpacksRepository extends Repository<
  typeof stationToolpacks,
  StationToolpackSelect,
  StationToolpackInsert
> {
  constructor() { super(stationToolpacks); }

  async findByStationId(stationId: string, client: DbClient = db): Promise<StationToolpackSelect[]> { /* … */ }

  /**
   * Replace the set of pack rows for a station. Soft-deletes any
   * existing rows whose slug/id is not in `next`, inserts rows for
   * any new slug/id. Idempotent: identical sets produce no writes.
   */
  async replaceForStation(
    stationId: string,
    next: { builtinSlugs: string[] },
    actor: { userId: string },
    client?: DbClient
  ): Promise<void> { /* … */ }
}
```

`replaceForStation` is the *only* write path used by the station router for `toolPacks: string[]`. Phase 1 always passes `builtinSlugs`; phase 2 extends the parameter object with `organizationToolpackIds`.

### `buildAnalyticsTools` change

**File: `apps/api/src/services/tools.service.ts`**

- Remove `station.toolPacks` read.
- Replace with:

  ```ts
  const enabled = await DbService.repository.stationToolpacks.findByStationId(stationId);
  const enabledPacks = new Set<string>(
    enabled
      .map((row) => row.builtinSlug)
      .filter((slug): slug is string => slug !== null)
  );
  ```

- The rest of the existing `if (enabledPacks.has("statistics"))` etc. blocks are unchanged.
- The `enabledPacks.size === 0` guard preserves the "station must have at least one tool pack enabled" error (`Error("Station must have at least one tool pack enabled")`).
- Delete `buildCustomWebhookTools` and its call site (line 351).

### Web — `/toolpacks` page

**Sidebar** (`apps/web/src/components/SidebarNav.component.tsx`): new entry between "Stations" (line 214) and "Connectors" (line 220). Label `"Toolpacks"`, icon `<Extension />` (already imported elsewhere or add at top). Route is the new `ApplicationRoute.Toolpacks = "/toolpacks"`.

**Route file** (`apps/web/src/routes/toolpacks.index.tsx`): standard `createFileRoute("/toolpacks")` shell rendering `ToolpacksView`.

**View** (`apps/web/src/views/Toolpacks.view.tsx`):

- Container fetches `sdk.toolpacks.list()` and renders `ToolpacksUI` (per the project's container + pure-UI policy).
- `ToolpacksUI` props: `{ toolpacks: Toolpack[]; onSelect: (id: string) => void }`. Renders the `DataTable` with these columns:
  - Name (click → `onSelect(id)`).
  - Kind chip (built-in only this phase, but the column is wired so phase 2 fills the custom rows).
  - Description (truncated).
  - # Tools (numeric, sortable).
  - Last refreshed — built-ins render `"—"`. Phase 2 fills it for customs.
  - Actions — empty for built-ins. Phase 2 adds Edit/Delete `IconButton`s for customs only, mirroring `views/ColumnDefinitionDetail.view.tsx:542`.
- Container wires `onSelect` to open `ToolpackMetadataModal`.
- The page header has a placeholder spot for the "Register toolpack" button — phase 1 does not render the button (no register dialog yet); phase 2 adds it.

**Modal** (`apps/web/src/components/ToolpackMetadataModal.component.tsx`):

- Single component (pure UI). Props: `{ toolpack: Toolpack | null; open: boolean; onClose: () => void }`.
- Renders header (name, kind chip, description) and a list of tool sections (name, description, `parameterSchema` in a small `<pre>`-style code block, examples list).
- No data fetching — the toolpack is passed in from the `ToolpacksView` container, which already has the full record from the list endpoint (no per-row fetch needed in phase 1; phase 2 may switch to a per-row `sdk.toolpacks.get` call if the list response gets too large).

**SDK** (`apps/web/src/api/toolpacks.api.ts`):

```ts
export const toolpacks = {
  list: (params?: ToolpackListRequestQuery, options?: QueryOptions<ToolpackListResponsePayload>) =>
    useAuthQuery<ToolpackListResponsePayload>(
      queryKeys.toolpacks.list(params),
      buildUrl("/api/toolpacks", params),
      undefined,
      options
    ),
  get: (id: string, options?: QueryOptions<ToolpackGetResponsePayload>) =>
    useAuthQuery<ToolpackGetResponsePayload>(
      queryKeys.toolpacks.get(id),
      buildUrl(`/api/toolpacks/${encodeURIComponent(id)}`),
      undefined,
      options
    ),
};
```

Register in `sdk.ts`. Add `queryKeys.toolpacks` in `keys.ts`.

### Web — call sites that read `station.toolPacks`

After the contract change, `station.toolPacks` no longer exists on the response. The replacement is `station.enabledToolpacks: string[]` (from the include payload). Mechanical rename across:

- `views/StationDetail.view.tsx:211, 217`.
- `views/Portal.view.tsx:148, 199`.
- `components/StationList.component.tsx:124, 130`.
- `components/DefaultStationCard.component.tsx:118, 124`.
- `components/EditStationDialog.component.tsx:36, 42, 76, 97, 109`. The form-state key stays `toolPacks` (matches the request body); the *seed* changes to `[...station.enabledToolpacks]`.
- `components/CreateStationDialog.component.tsx:30, 35, 42, 97, 107` — form-state key unchanged.
- All test fixtures: `__tests__/EditStationDialog.test.tsx:13`, `__tests__/Portal.view.test.tsx:67, 163`, `__tests__/CreateStationDialog.test.tsx`, `__tests__/CreatePortalDialog.test.tsx`, `__tests__/StationList.test.tsx`, `__tests__/DeleteStationDialog.test.tsx`.

The Edit/Create dialogs continue to render the same six checkboxes; they don't yet need to fetch from the registry because the slugs are still hardcoded into the dialog's own option list. Phase 2 swaps that to `sdk.toolpacks.list()`.

### Drop legacy single-tool plumbing

Remove (delete files; no compat aliases):

- `apps/api/src/db/schema/organization-tools.table.ts`
- `apps/api/src/db/schema/station-tools.table.ts`
- `apps/api/src/db/repositories/organization-tools.repository.ts`
- `apps/api/src/db/repositories/station-tools.repository.ts`
- `apps/api/src/routes/organization-tools.router.ts`
- `apps/api/src/routes/station-tools.router.ts`
- `apps/api/src/__tests__/__integration__/db/repositories/organization-tools.repository.integration.test.ts`
- `apps/api/src/__tests__/__integration__/db/repositories/station-tools.repository.integration.test.ts`
- `apps/api/src/__tests__/__integration__/routes/organization-tools.router.integration.test.ts`
- `apps/api/src/__tests__/__integration__/routes/station-tools.router.integration.test.ts`
- `packages/core/src/models/organization-tool.model.ts`
- `packages/core/src/models/station-tool.model.ts`
- `packages/core/src/contracts/organization-tool.contract.ts`
- `packages/core/src/contracts/station-tool.contract.ts`
- `packages/core/src/__tests__/contracts/organization-tool.contract.test.ts`
- `packages/core/src/__tests__/contracts/station-tool.contract.test.ts`
- `packages/core/src/__tests__/models/organization-tool.model.test.ts`
- `packages/core/src/__tests__/models/station-tool.model.test.ts`
- `apps/web/src/api/organization-tools.api.ts`
- `apps/web/src/__tests__/api/organization-tools.api.test.ts`

Edit:

- `apps/api/src/db/schema/zod.ts` — drop the `organizationTools` and `stationTools` blocks.
- `apps/api/src/db/schema/index.ts` — drop the re-exports.
- `apps/api/src/db/schema/type-checks.ts` — drop the `OrganizationTool` / `StationTool` blocks and unused imports.
- `apps/api/src/db/repositories/index.ts` — drop the registry entries.
- `apps/api/src/services/db.service.ts` — drop the repo bindings on `DbService.repository`.
- `apps/api/src/routes/protected.router.ts` (or wherever the routes are mounted) — drop `app.use("/api/organization-tools", …)` and `app.use("/api/station-tools", …)`.
- `apps/api/src/services/tools.service.ts:351` — delete `buildCustomWebhookTools`. Drop `WebhookTool` import (it remains in the codebase, but unused in phase 1 — leave it for phase 2 to wire back in).
- `apps/api/src/constants/api-codes.constants.ts` — drop `ORG_TOOL_*` and `STATION_TOOL_*` codes.
- `apps/web/src/api/sdk.ts` — drop `organizationTools` and `stationTools` from the SDK surface.
- `apps/web/src/api/keys.ts` — drop `organizationTools` and `stationTools` query keys (and the unused contract type imports).

A single Drizzle migration drops both tables. Order: drop `station_tools` first (FK), then `organization_tools`. The column drop on `stations` and creation of `station_toolpacks` happen in the same migration as part of the unified phase-1 schema cut.

---

## Migration

A single Drizzle migration named `phase_1_toolpacks` performs, in order:

1. `CREATE TABLE station_toolpacks (...)` with the two nullable columns and the XOR CHECK.
2. `INSERT INTO station_toolpacks (id, station_id, builtin_slug, ...) SELECT gen_id(), s.id, jsonb_array_elements_text(s.tool_packs), ... FROM stations s WHERE s.deleted IS NULL` — one row per existing slug per station. `created`/`createdBy` mirror the station's. The id is generated via the same nanoid helper used by `baseColumns` defaults — matching how seed scripts insert rows today.
3. `DROP INDEX` on `stations(tool_packs)` if any (audit first).
4. `ALTER TABLE stations DROP COLUMN tool_packs`.
5. `DROP TABLE station_tools`.
6. `DROP TABLE organization_tools`.

Wrapped in the standard Drizzle migration transaction. Failure at any step rolls back atomically. No data is preserved from `organization_tools` / `station_tools` (no production rows exist; confirmed in the discovery and saved as a project memory).

The migration is generated with `cd apps/api && npm run db:generate -- --name phase_1_toolpacks`. Steps 2 and 4 require hand-editing the generated SQL because Drizzle's introspection doesn't auto-author the data move. This is the same technique already used for prior data-bearing migrations.

A unit-style "smoke" check on the migration runs in CI as part of the integration test suite: an existing test seeds a station with `toolPacks: ["data_query", "statistics"]`, runs the migration, then asserts two `station_toolpacks` rows exist with the right slugs.

---

## TDD test plan

All test additions follow red → green → refactor. Tests are organized by layer; **service- and repo-layer tests come first** (they have the most coverage value and are fastest to iterate); route integration tests confirm the wiring; web tests last.

Run tests via the project's npm scripts (per `feedback_use_npm_test_scripts`):

```bash
# From repo root
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
cd packages/core && npm run test:unit
```

### Layer 1 — `@portalai/core` registry & contract tests

**`packages/core/src/__tests__/registries/builtin-toolpacks.test.ts`** (new)

1. **Six packs are registered.** `expect(BUILTIN_TOOLPACKS.length).toBe(6)`.
2. **Slugs match the legacy enum.** Pre-change `StationToolPackSchema` had `["data_query", "statistics", "regression", "financial", "web_search", "entity_management"]`. Each value is present as a pack slug.
3. **Slug uniqueness.** No duplicates in the array.
4. **`BUILTIN_TOOLPACK_BY_SLUG` lookup matches the array.** For every entry in `BUILTIN_TOOLPACKS`, `BUILTIN_TOOLPACK_BY_SLUG[entry.slug] === entry`.
5. **Every pack has at least one tool.** `expect(p.tools.length).toBeGreaterThan(0)` for each.
6. **Tool names are unique within a pack.** No duplicates per pack.
7. **Tool names are globally unique across packs.** Mirrors the production constraint that one `Record<string, Tool>` is built per session — name collisions would be a runtime bug.
8. **Every pack has at least one example.** Pick the first tool in each pack; assert `examples.length >= 1`. Sparse-but-not-empty — phase 1 ships at least one example per pack so the modal is never blank.
9. **`isBuiltinToolpackSlug` returns true for known slugs and false otherwise.** Exhaustive over the six slugs plus a handful of negatives (`""`, `"foo"`, `"DATA_QUERY"`).
10. **Each tool's `parameterSchema` parses as valid JSON Schema (object with `type` and `properties`).** Lightweight structural check; not a full JSON-Schema validator.

**`packages/core/src/__tests__/contracts/toolpack.contract.test.ts`** (new)

11. **Builtin record parses cleanly.** Pass a hand-crafted object matching `BuiltinToolpackRecordSchema` to `ToolpackSchema.parse`; assert success.
12. **Missing `kind` field rejects.** `safeParse({...without kind...}).success === false`.
13. **Unknown `kind` value rejects.** `kind: "future"` fails the discriminated union.
14. **`ToolpackListResponsePayloadSchema` accepts an array of records and a numeric total.**
15. **`ToolpackListRequestQuerySchema` rejects unknown `kind` values.** `kind: "garbage"` fails parse.
16. **Empty `toolpacks` array is valid.** Phase 1 returns this on `?kind=custom`.

### Layer 2 — Drizzle / repository / type-checks

**`apps/api/src/__tests__/__integration__/db/repositories/station-toolpacks.repository.integration.test.ts`** (new)

17. **Insert + read round-trip with `builtinSlug`.** Insert a row with `builtinSlug: "data_query"`, no `organizationToolpackId`. `findByStationId` returns it.
18. **XOR CHECK constraint rejects both-null.** Direct DB insert with both columns null throws (Postgres CHECK violation).
19. **XOR CHECK constraint rejects both-set.** Insert with both `builtinSlug = "data_query"` and `organizationToolpackId = "<uuid>"` throws.
20. **Unique-per-station-and-slug.** Insert two live rows for the same `(stationId, "data_query")` — second insert violates the unique index.
21. **Soft-deleted rows are ignored by uniqueness.** Soft-delete row 1 (`deleted IS NOT NULL`); insert a fresh row with the same `(stationId, "data_query")` — succeeds.
22. **`findByStationId` filters out soft-deleted rows.** Insert + soft-delete a row, insert a live row; assert only the live row is returned.
23. **`replaceForStation` is idempotent.** Seed two slugs, call `replaceForStation` with the same two slugs, assert no DB writes (audit `created`/`updated` timestamps unchanged) and no soft-delete.
24. **`replaceForStation` adds new slugs.** Seed `["data_query"]`; replace with `["data_query", "statistics"]`; assert one new row, no soft-deletes on the existing row.
25. **`replaceForStation` removes missing slugs via soft-delete.** Seed `["data_query", "statistics"]`; replace with `["data_query"]`; assert the `statistics` row is soft-deleted (`deleted IS NOT NULL`), `data_query` row is untouched.
26. **`replaceForStation` runs in a single transaction.** Mock the client to throw mid-call; assert no partial state lands.

**`apps/api/src/__tests__/__integration__/db/migrations/phase_1_toolpacks.test.ts`** (new) — see *Migration* above.

27. **Existing station's slug array is moved into rows.** Seed a station with `toolPacks: ["data_query", "statistics"]`; run the migration; query `station_toolpacks`; assert two rows with the right slugs and the right `stationId`.
28. **Stations with empty `toolPacks` produce no rows.** (Defensive — schema disallows empty, but a check guards against drift.)
29. **`stations.tool_packs` column does not exist after the migration.** `SELECT column_name FROM information_schema.columns WHERE table_name = 'stations' AND column_name = 'tool_packs'` returns empty.
30. **`organization_tools` table does not exist.** Same probe against `information_schema.tables`.
31. **`station_tools` table does not exist.** Same.

**`apps/api/src/db/schema/type-checks.ts`** — the existing `_StaModelToDrizzle` block requires editing because `Station` no longer has `toolPacks`. The current `Omit<Station, "toolPacks">` workaround can collapse to a direct `IsAssignable<Station, StationSelect>` once `toolPacks` is gone — that's a structural improvement, not a new test, but a TypeScript regression here is caught by `npm run type-check`.

### Layer 3 — Service-layer tests

**`apps/api/src/__tests__/services/tools.service.test.ts`** (extend if exists; create if not — audit first)

32. **`buildAnalyticsTools` reads enabled packs from `station_toolpacks`.** Mock `repo.stationToolpacks.findByStationId` to return rows for `["data_query"]`; assert the returned `tools` object has the `sql_query` key and not `correlate`.
33. **`buildAnalyticsTools` raises when no packs are enabled.** Mock returns `[]`; assert the existing "Station must have at least one tool pack enabled" error.
34. **`buildAnalyticsTools` ignores soft-deleted rows.** The repo filters by `deleted IS NULL` already; this case is for the mock to verify behaviour from outside.
35. **`buildAnalyticsTools` skips `organizationToolpackId` rows in phase 1.** Mock returns one `builtin_slug` row + one `organizationToolpackId` row; assert that only the built-in tools are present and that the unsupported row is logged but does not throw. (The defensive log preview makes the phase-2 wire-up obvious.)

### Layer 4 — Route integration tests

**`apps/api/src/__tests__/__integration__/routes/toolpacks.router.integration.test.ts`** (new)

36. **`GET /api/toolpacks` returns all six built-ins.** Auth-mocked. Assert `payload.toolpacks.length === 6`, `payload.total === 6`, every record has `kind === "builtin"`.
37. **`GET /api/toolpacks?kind=custom` returns an empty list.** No 4xx.
38. **`GET /api/toolpacks?search=correl` matches by tool description.** Assert `data_query` filtered out, `statistics` present (because `correlate` is in the statistics pack).
39. **`GET /api/toolpacks/:id` returns the right pack.** `:id = "builtin:data_query"` returns the `data_query` record.
40. **`GET /api/toolpacks/:id` 404s for unknown slug.** `:id = "builtin:does_not_exist"` returns `404` with `code: "TOOLPACK_NOT_FOUND"`.
41. **`GET /api/toolpacks/:id` 404s for `custom:` prefix in phase 1.** Reserved.
42. **`GET /api/toolpacks/:id` 404s for un-prefixed id.** `:id = "data_query"` returns `404`.

**`apps/api/src/__tests__/__integration__/routes/station.router.integration.test.ts`** (extend)

43. **`POST /api/stations` with `toolPacks: ["data_query"]` creates a station and one `station_toolpacks` row.** Assert the row has `builtinSlug = "data_query"` and `organizationToolpackId IS NULL`.
44. **`POST /api/stations` with an unknown slug returns 400.** `toolPacks: ["bogus"]` rejects with a `STATION_INVALID_TOOLPACK` (or equivalent) code.
45. **`POST /api/stations` rejects empty `toolPacks` array.** Existing `.min(1)` check.
46. **`PATCH /api/stations/:id` with `toolPacks: ["statistics"]` replaces existing rows.** Pre-state: one `data_query` row. Post-state: zero live `data_query` rows (soft-deleted), one live `statistics` row.
47. **`GET /api/stations/:id` includes `enabledToolpacks` by default.** Assert the response payload contains the array.
48. **`GET /api/stations/:id?include=` (no `toolpacks`) still includes them.** Phase 1 always includes — the `include` parameter is parsed but the toolpack join is unconditional. (Documented; phase 2 may make it opt-out.)

### Layer 5 — Web tests

**`apps/web/src/__tests__/Toolpacks.view.test.tsx`** (new)

49. **Renders six rows** (mocked `sdk.toolpacks.list` returning the six built-ins).
50. **Filtering by name narrows the list.** Type into a search input; assert only matching rows render.
51. **Sorting by `# Tools` reorders rows.** Click the column header; assert order.
52. **Clicking a row opens the metadata modal.** Assert modal heading matches the clicked pack's name.
53. **Closing the modal returns to the table.** Modal not in document.

**`apps/web/src/__tests__/ToolpackMetadataModal.test.tsx`** (new)

54. **Renders pack name, description, and tool sections.** Pass a `Toolpack` prop, assert all named tools appear in the document.
55. **Renders `parameterSchema` as text.** The schema's `type: "object"` shows up.
56. **Renders examples when present.** Pass a pack with one example; assert the example title renders.
57. **Renders a "no examples" placeholder when absent.** Pass a tool with no `examples`; assert the placeholder text.

**Existing tests that need updates** (the `toolPacks` rename to `enabledToolpacks` on the response side; form-state key unchanged):

- `__tests__/EditStationDialog.test.tsx` — fixture's `toolPacks: ["data_query", "statistics"]` becomes `enabledToolpacks: …`.
- `__tests__/StationList.test.tsx` — same.
- `__tests__/Portal.view.test.tsx` — `stationFixture.station.toolPacks` → `enabledToolpacks`.
- `__tests__/CreatePortalDialog.test.tsx` — same.
- `__tests__/CreateStationDialog.test.tsx` — request-body `toolPacks` is unchanged (still part of the create body).
- `__tests__/DeleteStationDialog.test.tsx`, `__tests__/DefaultStationCard.test.tsx` — same as `StationList`.
- `__tests__/ToolPackChip.test.tsx`, `__tests__/ToolPackUtil.test.ts`, `__tests__/ToolPackIconUtil.test.ts` — keep working; the registry-driven label/icon resolution is internally swapped but the public `ToolPackChip` API does not change.

### Test totals

- `@portalai/core`: 16 new cases (10 registry + 6 contract).
- `apps/api` repo/migration: 15 new cases.
- `apps/api` service: 4 new cases.
- `apps/api` route integration: 13 new cases (7 toolpacks + 6 station updates).
- `apps/web`: 9 new cases (5 view + 4 modal), plus mechanical fixture-rename diffs in 7 existing test files.

Total **57 new test cases**, plus an integration-level smoke probe on the migration.

---

## Acceptance criteria

- [ ] All 57 new test cases pass; the existing test suites pass with the mechanical fixture renames; type-check is clean.
- [ ] `cd apps/api && npm run test:unit && npm run test:integration` is green.
- [ ] `cd apps/web && npm run test:unit` is green.
- [ ] `cd packages/core && npm run test:unit` is green.
- [ ] `npm run lint && npm run type-check` from repo root are clean.
- [ ] `npm run db:migrate` against a database seeded with stations whose `tool_packs` arrays are non-empty produces the expected `station_toolpacks` rows and drops the column.
- [ ] Visiting `/toolpacks` in the dev web app shows six rows; clicking the `data_query` row opens the modal with the pack's tools and at least one example.
- [ ] The "Toolpacks" sidebar entry is present between "Stations" and "Connectors".
- [ ] A station's pack picker (in `Edit/CreateStationDialog`) continues to render six checkboxes; saving persists the selection through the new `station_toolpacks` table; the `StationDetail` view's chip stack reads from the new `enabledToolpacks` field.
- [ ] A portal session for a station with `["data_query", "statistics"]` enabled responds to a question that exercises both packs (e.g., "describe the X column and run a SQL aggregate over it"). Server logs show `buildAnalyticsTools` reading from `station_toolpacks` and producing the expected `Record<string, Tool>` keys.
- [ ] No `organization_tools.*` or `station_tools.*` files remain in the repo. `git ls-files` returns no matches for `organization-tool*` or `station-tools.table` patterns.

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Existing stations with `tool_packs` arrays are not migrated (migration step 2 fails or is skipped). | Integration test 27 asserts the data move; it runs in CI before the migration is applied to any non-test database. Manual verification before deploy via `db:studio`. |
| The `Station` contract change breaks unrelated frontend code. | The mechanical rename is exhaustive (grep audit for `station.toolPacks` returns 0 matches before merge). Type-check catches any miss. |
| Removing `WebhookTool`'s caller path orphans the class without removing it. | Acknowledged. `WebhookTool` is left in place but unused after phase 1; phase 2 wires it back in over the new shape. A comment in the file documents the gap. (Rationale: deleting and re-adding the file in two phases is more churn than leaving it dormant.) |
| The `ToolPackChip` component renders a slug that no longer exists in the registry (e.g. a station has a stale row). | The chip's existing fallback (`TOOL_PACK_LABELS[pack] ?? pack`) — now backed by the registry — renders the raw slug. The dialogs source their option list from the registry so users cannot re-select a non-existent pack. |
| Phase-1 test 23's idempotency assertion is too strict (`replaceForStation` writes anyway because of touch-`updated` semantics). | Redefine "idempotent" to mean *no soft-deletes and no inserts*; allow update-touch on rows that were re-asserted (the existing repo `update` semantics). The test asserts insert/delete counts, not row-`updated` timestamps. |
| Hidden references to `station.toolPacks` in code paths not covered by grep (e.g. dynamic property access via `[key]`). | The only consumer of dynamic property access today is `MetadataList`'s `value` field, which receives a JSX expression — type-check would flag it. Audit the diff for any `["toolPacks"]` literals or `keyof Station` reflections; none found in the current codebase. |
| Drizzle's generated migration SQL doesn't include the data-move step (Drizzle introspects schema changes only, not data). | Hand-edit the generated SQL file to insert step 2 (the `INSERT INTO station_toolpacks ... SELECT ...`) between the `CREATE TABLE` and `DROP COLUMN` steps. The integration test (case 27) catches a missing data-move. |
| The XOR CHECK constraint name (`station_toolpacks_kind_xor`) conflicts with another check or is too long for Postgres's 63-char identifier limit. | The name is 31 chars — safe. No collision (all existing check constraints have distinct names). |

**Rollback** is a single migration revert (drop `station_toolpacks`, recreate `stations.tool_packs jsonb`, recreate `organization_tools` and `station_tools` from saved DDL) plus a code revert. Because no production data lives in the dropped tables, the rollback is data-lossless. Practically: a phase-1 revert is a `git revert` of the merge commit and a manual `db:migrate` of the inverse migration. (Phase 2 would not yet have any custom-pack data to lose.)

---

## Files touched

### `packages/core`

- New: `src/registries/builtin-toolpacks.ts`
- New: `src/contracts/toolpack.contract.ts`
- New: `src/models/station-toolpack.model.ts`
- Edit: `src/contracts/index.ts` — re-export the new contract.
- Edit: `src/models/index.ts` — re-export the new model.
- Edit: `src/models/station.model.ts` — drop `toolPacks` field, drop `StationToolPackSchema`.
- Edit: `src/contracts/station.contract.ts` — drop legacy `toolPacks: z.array(StationToolPackSchema)` and add `toolPacks: z.array(z.string()).min(1).optional()` for create/update; add `enabledToolpacks: z.array(z.string()).optional()` to the response shape.
- Delete: `src/models/organization-tool.model.ts`, `src/models/station-tool.model.ts`, `src/contracts/organization-tool.contract.ts`, `src/contracts/station-tool.contract.ts`, plus their tests.
- New: `src/__tests__/registries/builtin-toolpacks.test.ts`
- New: `src/__tests__/contracts/toolpack.contract.test.ts`
- Edit: any test that imports `StationToolPack` or `OrganizationTool*` types.

### `apps/api`

- New: `src/db/schema/station-toolpacks.table.ts`
- New: `src/db/repositories/station-toolpacks.repository.ts`
- New: `src/routes/toolpacks.router.ts`
- New: Drizzle migration `<timestamp>_phase_1_toolpacks.sql` (hand-edited)
- New: `src/__tests__/__integration__/db/repositories/station-toolpacks.repository.integration.test.ts`
- New: `src/__tests__/__integration__/db/migrations/phase_1_toolpacks.test.ts`
- New: `src/__tests__/__integration__/routes/toolpacks.router.integration.test.ts`
- New: `src/__tests__/services/tools.service.test.ts` (if absent — audit first)
- Edit: `src/db/schema/stations.table.ts` — drop `toolPacks` column.
- Edit: `src/db/schema/zod.ts` — drop `organizationTools` / `stationTools` blocks; add `stationToolpacks`.
- Edit: `src/db/schema/index.ts`, `src/db/schema/type-checks.ts` — drop legacy entries, add `stationToolpacks`, simplify the `Station` block (no more `Omit<…, "toolPacks">`).
- Edit: `src/db/repositories/index.ts`, `src/services/db.service.ts` — drop legacy bindings, add `stationToolpacks`.
- Edit: `src/routes/station.router.ts` — replace `toolPacks` array reads/writes with calls into `stationToolpacksRepo.replaceForStation`; add `enabledToolpacks` to the include payload.
- Edit: `src/services/tools.service.ts` — replace `station.toolPacks` read; delete `buildCustomWebhookTools`.
- Edit: `src/app.ts` (or `src/routes/protected.router.ts`) — mount `toolpacksRouter`; unmount `organizationToolsRouter`, `stationToolsRouter`.
- Edit: `src/constants/api-codes.constants.ts` — add `TOOLPACK_NOT_FOUND`; remove `ORG_TOOL_*` and `STATION_TOOL_*`.
- Delete: `src/db/schema/organization-tools.table.ts`, `src/db/schema/station-tools.table.ts`, `src/db/repositories/organization-tools.repository.ts`, `src/db/repositories/station-tools.repository.ts`, `src/routes/organization-tools.router.ts`, `src/routes/station-tools.router.ts`, plus their integration tests.

### `apps/web`

- New: `src/api/toolpacks.api.ts`
- New: `src/routes/toolpacks.index.tsx`
- New: `src/views/Toolpacks.view.tsx`
- New: `src/components/ToolpackMetadataModal.component.tsx`
- New: `src/__tests__/Toolpacks.view.test.tsx`
- New: `src/__tests__/ToolpackMetadataModal.test.tsx`
- Edit: `src/api/sdk.ts` — register `toolpacks`; drop `organizationTools`.
- Edit: `src/api/keys.ts` — register `queryKeys.toolpacks`; drop `queryKeys.organizationTools` (and the contract import).
- Edit: `src/utils/routes.util.ts` — add `Toolpacks = "/toolpacks"`.
- Edit: `src/components/SidebarNav.component.tsx` — add the entry.
- Edit: `src/utils/tool-packs.util.ts` — collapse to a façade that reads from `BUILTIN_TOOLPACK_BY_SLUG`.
- Edit (response-shape rename): `src/views/StationDetail.view.tsx`, `src/views/Portal.view.tsx`, `src/components/StationList.component.tsx`, `src/components/DefaultStationCard.component.tsx`, `src/components/EditStationDialog.component.tsx`, `src/components/CreateStationDialog.component.tsx`.
- Delete: `src/api/organization-tools.api.ts`, `src/__tests__/api/organization-tools.api.test.ts`.
- Edit (fixture rename): `src/__tests__/EditStationDialog.test.tsx`, `src/__tests__/Portal.view.test.tsx`, `src/__tests__/CreateStationDialog.test.tsx`, `src/__tests__/CreatePortalDialog.test.tsx`, `src/__tests__/StationList.test.tsx`, `src/__tests__/DeleteStationDialog.test.tsx`, `src/__tests__/DefaultStationCard.test.tsx`.

No new dependency. No env-var change. No infra change.
