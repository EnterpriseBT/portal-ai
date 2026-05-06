# Custom Toolpack Registration — Phase 2 — Spec

**Add custom toolpack registration over the three-endpoint webhook contract (schema + runtime + optional metadata).** Phase 2 is purely additive on top of phase 1: no station-side schema changes, no built-in pack changes, no UI shape changes outside of new dialogs and the unlock of the `Actions` column on the `/toolpacks` table for custom rows.

Discovery: `docs/CUSTOM_TOOLPACK_REGISTRATION.discovery.md`. Phase 1: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_1.spec.md` and `.plan.md`.

After phase 1, the `station_toolpacks` join already has an `organization_toolpack_id` column (created nullable, unused). Phase 2 introduces the FK target, the registration write paths, and the executor that fans webhook-pack tools out at session-build time.

Resolved decision points carried forward from discovery (D3–D6) and new phase-2 decision points (P1–P4):

- **D3 (schema fetch caching):** ratified. Cache forever, re-fetch on explicit user action. Background refresh and drift detection are deferred to phase 4.
- **D5 (tool-name uniqueness):** ratified. Pack names unique per org (enforced at registration). Tool names enforced unique across all enabled packs on a station at session-build time with a structured error code (`TOOLPACK_TOOL_NAME_CONFLICT`). Pre-flight collision warning in the station-edit dialog is deferred to phase 4.
- **D6 (Markdown in metadata):** ratified. Plain strings only. Renderer treats strings as text, not markup.
- **P1 (auth header storage):** plain `jsonb` `Record<string,string>`, mirroring the existing connector-instance webhook auth shape. Redacted on every read endpoint — list/get responses emit `{ has: true }` (or absence) rather than the actual values. Encryption-at-rest is a follow-up driven by the broader credential-encryption story, not phase 2.
- **P2 (`WebhookTool` payload shape):** unconditional switch to `{ tool: <toolName>, input: <validated input> }`. No legacy data exists, no discriminator.
- **P3 (registration validation strictness):** strict. Name regex `^[a-z][a-z0-9_]{0,62}$` for pack name and each tool name; `parameterSchema` must be a JSON-Schema-shaped object with `type: "object"` and `properties` keyed by string. Tool count between 1 and 32. Reject everything else with structured codes — registration never persists partial data.
- **P4 (refresh ergonomics):** the edit dialog includes a "Refresh schema" button that calls `POST /api/toolpacks/:id/refresh`. Failures keep the existing cached `tools` and `metadata` and surface the error as an inline `<FormAlert>` — they do not blank the cached fields.

After this phase: an org admin visits `/toolpacks`, clicks "Register toolpack", supplies endpoints + optional auth headers, and the new pack appears as a row alongside built-ins. Stations can enable the pack via the existing pack picker. A portal session built against a station with a custom pack enabled exposes the custom tools to the model and routes invocations through the pack's runtime endpoint.

---

## Scope

### In scope

1. **`organization_toolpacks` table** — new Drizzle table with org scoping, soft-delete, cached schema, optional cached metadata, plain-jsonb auth headers.
2. **`OrganizationToolpack` core model** + contracts (Zod model + create / update / refresh / list / get request bodies and response payloads).
3. **`ToolpackSchema` discriminated-union extension** — add the `kind: "custom"` arm to the contract introduced in phase 1.
4. **FK constraint** — add `station_toolpacks.organization_toolpack_id REFERENCES organization_toolpacks(id)` (the column already exists nullable from phase 1; the FK constraint lands now that the target table exists).
5. **Toolpack registration service** — fetches and validates the schema endpoint (and optional metadata endpoint) at registration and on explicit refresh. Caches both onto the row.
6. **API endpoints**:
   - `POST /api/toolpacks` — register new custom pack.
   - `PATCH /api/toolpacks/:id` — update name / description / endpoints / authHeaders. Re-fetch schema if `endpoints` changes.
   - `DELETE /api/toolpacks/:id` — soft-delete (cascades through `station_toolpacks` via the existing soft-delete pattern).
   - `POST /api/toolpacks/:id/refresh` — re-fetch schema + metadata. No body.
   - Extend `GET /api/toolpacks` and `GET /api/toolpacks/:id` to merge custom rows alongside built-ins. Phase 1's `?kind=custom` filter starts emitting non-empty results.
7. **`WebhookTool` payload shape** — switch unconditionally to `{ tool, input }`. The class already takes the tool name in its constructor.
8. **`tools.service.buildAnalyticsTools` custom expansion** — replace the phase-1 `logger.warn(...)` placeholder with actual fan-out: walk each custom row's cached `tools[]`, instantiate one `WebhookTool` per entry pointed at the pack's runtime endpoint. Enforce tool-name uniqueness at session-build time.
9. **Web `/toolpacks` page**:
   - Custom rows appear in the table with their kind chip, description, tool count, and `lastRefreshed` timestamp populated.
   - Actions column unlocks for `kind === "custom"` only — `Edit` and `Delete` icon buttons mirroring the field-mappings table pattern.
   - Header gains a "Register toolpack" primary action button.
10. **Web Register / Edit / Delete dialogs** — full Form & Dialog pattern (Zod-validated, `<FormAlert>`, autofocus, focus-on-invalid). Edit dialog includes a "Refresh schema" button.
11. **Web station create/edit dialogs** — the existing built-in pack picker grows a custom-pack section. Selected custom pack ids ride the existing `toolPacks: string[]` request field but with an `org:<id>` prefix to disambiguate from built-in slugs (or as a separate field — see decision below).
12. **SDK extensions** — `sdk.toolpacks.register / update / remove / refresh`. Mutation `onSuccess` invalidates `queryKeys.toolpacks.root` and (for delete) `queryKeys.stations.root` (because affected stations' enabledToolpacks change).

### Out of scope

- Background / scheduled re-fetch of schema or metadata. Phase 4.
- Tool-name collision pre-flight in the station-edit dialog. Phase 4.
- Click-to-open metadata modal from `ToolPackChip` on station detail / portal session. Phase 3.
- Marketplace / cross-organization sharing.
- Per-tool gating within a pack (enable a subset of a pack's tools).
- Versioning of custom packs over time.
- Any change to built-in packs.
- Encryption of `authHeaders` at rest (follow the broader credentials-encryption story).
- AI-assisted authoring of toolpack schemas.

---

## Concept changes

### Storage shape: how stations reference custom packs

Phase 1's `station_toolpacks` join has two reference columns: `builtin_slug` and `organization_toolpack_id`. The XOR CHECK enforces that exactly one is set per row.

Phase 2 needs a way for the station create/update wire shape to represent the difference between a built-in slug and a custom toolpack id. Two options:

- **Option A — prefixed strings in the existing `toolPacks: string[]` field:** a value of `"data_query"` is a built-in, `"org:<uuid>"` is a custom-pack reference. The router parses each value, validates against the registry or `organization_toolpacks`, and inserts the appropriate column.
- **Option B — split into two fields:** `builtinToolpacks: string[]` and `customToolpackIds: string[]`. Cleaner shape, but requires touching every existing caller (Create/Edit dialogs, tests, and an existing migration of the wire field).

**Recommendation: Option A.** Existing `toolPacks` callers (built-in slugs only) keep working byte-identically. Custom pack references gain a stable namespace prefix (`org:`). The router does one extra parse step. Decision codified in P5 below.

- **P5 (station wire shape):** ratified. `toolPacks: string[]` accepts both built-in slugs and `org:<uuid>` strings. Built-in validation as before; custom validation hits `organization_toolpacks` to confirm the id exists and belongs to the requesting org. Each list element with a leading `org:` is materialized as a join row with `organization_toolpack_id` set.

### Naming on the wire

API endpoints use `toolpacks` consistently. The discriminator is `kind: "builtin" | "custom"`. Dialog button labels:

- "Register toolpack" (page header primary action)
- "Edit toolpack"
- "Delete toolpack"
- "Refresh schema" (inside the edit dialog)

---

## Surface

### `organization_toolpacks` table

**File: `apps/api/src/db/schema/organization-toolpacks.table.ts`** (new)

```ts
import { pgTable, text, jsonb, bigint, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

export const organizationToolpacks = pgTable(
  "organization_toolpacks",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    description: text("description"),
    endpoints: jsonb("endpoints")
      .$type<{ schema: string; runtime: string; metadata?: string }>()
      .notNull(),
    authHeaders: jsonb("auth_headers").$type<Record<string, string> | null>(),
    tools: jsonb("tools")
      .$type<Array<{ name: string; description: string; parameterSchema: Record<string, unknown> }>>()
      .notNull(),
    metadata: jsonb("metadata").$type<{
      summary?: string;
      tools?: Array<{
        name: string;
        description?: string;
        examples?: Array<{
          title?: string;
          description?: string;
          input?: unknown;
          output?: unknown;
        }>;
      }>;
    } | null>(),
    schemaFetchedAt: bigint("schema_fetched_at", { mode: "number" }).notNull(),
    metadataFetchedAt: bigint("metadata_fetched_at", { mode: "number" }),
  },
  (table) => [
    uniqueIndex("organization_toolpacks_org_name_unique")
      .on(table.organizationId, table.name)
      .where(sql`deleted IS NULL`),
  ]
);
```

In the same migration:

- Add `station_toolpacks.organization_toolpack_id_fk` FK to `organization_toolpacks(id)` (column already exists from phase 1).

### Drizzle-zod schemas + type-checks

Standard pattern — `OrganizationToolpackSelectSchema`, `OrganizationToolpackInsertSchema`, type-check block in `type-checks.ts` asserting compile-time agreement with the core model.

### `OrganizationToolpack` core model

**File: `packages/core/src/models/organization-toolpack.model.ts`** (new)

```ts
export const ToolpackEndpointsSchema = z.object({
  schema: z.string().url(),
  runtime: z.string().url(),
  metadata: z.string().url().optional(),
});

export const ToolpackToolDefinitionSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  description: z.string().min(1),
  parameterSchema: z.record(z.string(), z.unknown()),
});

export const ToolpackMetadataSchema = z.object({
  summary: z.string().optional(),
  tools: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    examples: z.array(z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      input: z.unknown().optional(),
      output: z.unknown().optional(),
    })).optional(),
  })).optional(),
});

export const OrganizationToolpackSchema = CoreSchema.extend({
  organizationId: z.string(),
  name: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  description: z.string().nullable(),
  endpoints: ToolpackEndpointsSchema,
  authHeaders: z.record(z.string(), z.string()).nullable(),
  tools: z.array(ToolpackToolDefinitionSchema).min(1).max(32),
  metadata: ToolpackMetadataSchema.nullable(),
  schemaFetchedAt: z.number(),
  metadataFetchedAt: z.number().nullable(),
});

export class OrganizationToolpackModel extends CoreModel<OrganizationToolpack> { /* … */ }
export class OrganizationToolpackModelFactory extends ModelFactory<…> { /* … */ }
```

### Toolpack contracts extension

**File: `packages/core/src/contracts/toolpack.contract.ts`** (extend)

Add the `custom` arm to `ToolpackSchema` and add registration request bodies:

```ts
export const CustomToolpackRecordSchema = z.object({
  id: z.string(),
  kind: z.literal("custom"),
  slug: z.string(),               // == organization_toolpack name
  name: z.string(),               // human-readable display name (= description-derived or = name)
  description: z.string().nullable(),
  iconSlug: z.string(),           // fixed default for v1; admin-customisable in a follow-up
  tools: z.array(ToolpackToolSchema),
  endpoints: ToolpackEndpointsSchema,
  authHeadersStatus: z.object({ has: z.boolean() }),  // redaction marker
  schemaFetchedAt: z.number(),
  metadataFetchedAt: z.number().nullable(),
});

export const ToolpackSchema = z.discriminatedUnion("kind", [
  BuiltinToolpackRecordSchema,
  CustomToolpackRecordSchema,
]);

export const RegisterToolpackBodySchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  description: z.string().min(1).optional(),
  endpoints: ToolpackEndpointsSchema,
  authHeaders: z.record(z.string(), z.string()).optional(),
});

export const UpdateToolpackBodySchema = RegisterToolpackBodySchema.partial().refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  { message: "At least one field must be provided" }
);
```

Response payloads for register / update / refresh / delete follow the project's existing pattern.

### API endpoints

**`POST /api/toolpacks`** — register

- Auth required, org-scoped via `getApplicationMetadata`.
- Body: `RegisterToolpackBody`.
- Behavior:
  1. Validate body. Reject malformed with `400 TOOLPACK_INVALID_PAYLOAD`.
  2. Check pack name unique within org (live rows). Conflict → `409 TOOLPACK_NAME_CONFLICT`.
  3. Fetch schema endpoint. Errors → `502 TOOLPACK_SCHEMA_FETCH_FAILED` with the raw status / message in the response. Apply 256 KB body cap; oversize → `502 TOOLPACK_SCHEMA_TOO_LARGE`.
  4. Validate schema response with strict Zod. Reject non-object response, missing `tools`, malformed tool, etc., with `502 TOOLPACK_SCHEMA_INVALID`.
  5. Check no tool name collides with `PACK_TOOL_NAMES` (built-ins). Conflict → `409 TOOLPACK_TOOL_NAME_CONFLICT`.
  6. If `endpoints.metadata` is set, fetch metadata (best-effort). Errors are non-fatal; row registers without metadata. Cap and validate same as schema.
  7. Persist the row with cached `tools`, optional `metadata`, timestamps, and the supplied `authHeaders` (or `null`).
  8. Return the merged record (with redacted auth headers).
- Response: `201 { success: true, payload: { toolpack: Toolpack } }`.

**`PATCH /api/toolpacks/:id`** — update

- Same validation as register for any field present.
- If `endpoints.schema` (or any `endpoints` field) changes, re-fetch and re-validate before persisting.
- If `authHeaders` is provided, replaces the stored value; if absent, the existing value is kept untouched.
- Conflict / validation errors mirror register.

**`DELETE /api/toolpacks/:id`** — soft-delete

- Authorize: row's `organizationId` must match request org.
- Soft-delete the toolpack row; cascade soft-delete the matching `station_toolpacks` rows for atomic accuracy. Stations whose remaining live `station_toolpacks` count drops to zero are *not* auto-fixed — phase 1's "station must have at least one tool pack" guard is enforced at session-build time, not at delete time. The router returns the impacted-station list in the response so the UI can warn.

**`POST /api/toolpacks/:id/refresh`** — refresh

- Re-runs the schema fetch (and metadata fetch if configured). Updates cached `tools`, `metadata`, and timestamps. Authorization same as PATCH.
- On fetch failure: keep the existing cached values, return `502 TOOLPACK_SCHEMA_FETCH_FAILED` (or the granular code) so the UI can surface inline.

**`GET /api/toolpacks` and `GET /api/toolpacks/:id`** — merge

- List endpoint loads custom rows for the request org and emits both kinds. `?kind=builtin` returns only built-ins (current behavior); `?kind=custom` filters to org-scoped customs.
- `GET /:id` accepts `builtin:<slug>` (current) and now also a UUID-shaped id. Resolve order: `builtin:` prefix → registry lookup; UUID → `organization_toolpacks` lookup scoped to org. Anything else returns `404 TOOLPACK_NOT_FOUND`.

### New ApiCode entries

`TOOLPACK_INVALID_PAYLOAD`, `TOOLPACK_NAME_CONFLICT`, `TOOLPACK_TOOL_NAME_CONFLICT`, `TOOLPACK_SCHEMA_FETCH_FAILED`, `TOOLPACK_SCHEMA_TOO_LARGE`, `TOOLPACK_SCHEMA_INVALID`.

### Toolpack registration service

**File: `apps/api/src/services/toolpack-registration.service.ts`** (new)

```ts
export class ToolpackRegistrationService {
  static async fetchSchema(
    url: string,
    headers?: Record<string, string>
  ): Promise<ToolpackToolDefinition[]> { /* HTTP GET, cap, parse, validate */ }

  static async fetchMetadata(
    url: string,
    headers?: Record<string, string>
  ): Promise<ToolpackMetadata | null> { /* same; null on failure */ }

  static validateNoBuiltinCollision(tools: ToolpackToolDefinition[]): void { /* throws ApiError */ }
}
```

Both fetch helpers reuse the existing 30 s timeout pattern from `ToolService.callWebhook` (factor that timeout into a shared utility). Response size capped at 256 KB.

### `WebhookTool` payload change

**File: `apps/api/src/tools/webhook.tool.ts`** (edit)

Replace the existing `body: JSON.stringify(input)` line in `execute` with `body: JSON.stringify({ tool: this.slug, input })`. Add the `slug` to the JSON envelope on the way out — receivers can dispatch on it. The class is otherwise unchanged.

### `tools.service.buildAnalyticsTools` custom expansion

**File: `apps/api/src/services/tools.service.ts`** (edit)

Replace:

```ts
if (customRows.length > 0) {
  logger.warn({ stationId, count: customRows.length }, "Custom toolpack rows present but not yet supported (phase 2)");
}
```

with:

```ts
if (customRows.length > 0) {
  const orgPackIds = customRows
    .map((r) => r.organizationToolpackId)
    .filter((id): id is string => id !== null);
  const orgPacks = await repo.organizationToolpacks.findManyByIds(orgPackIds);
  for (const pack of orgPacks) {
    for (const tool of pack.tools) {
      if (tool.name in tools) {
        throw new ApiError(
          409,
          ApiCode.TOOLPACK_TOOL_NAME_CONFLICT,
          `Tool "${tool.name}" is provided by more than one enabled toolpack on this station`
        );
      }
      tools[tool.name] = new WebhookTool(
        tool.name,
        tool.description,
        tool.parameterSchema,
        {
          type: "webhook",
          url: pack.endpoints.runtime,
          headers: pack.authHeaders ?? undefined,
        },
        stationId
      ).build();
    }
  }
}
```

The `PACK_TOOL_NAMES` collision guard in the existing service already catches a custom tool name shadowing a built-in (we keep it there as a defence in depth — registration also rejects, but the runtime check protects against future drift).

### Web — toolpacks page

**`Toolpacks.view.tsx`**: container fetches `sdk.toolpacks.list()` and additionally calls `sdk.toolpacks.register / update / remove / refresh` mutations. The pure UI component grows:

- Header `primaryAction` slot rendered for the "Register toolpack" button.
- The actions column produces Edit + Delete icon buttons for `kind === "custom"` rows; the cell stays empty for built-ins.
- A `lastRefreshed` column populated from `schemaFetchedAt` for custom rows.
- Modal click target is unchanged — opens metadata modal as in phase 1.

### Web — dialogs

**`RegisterToolpackDialog.component.tsx`** — form fields:

- `name` (required, regex)
- `description` (optional)
- `endpoints.schema` (required, URL)
- `endpoints.runtime` (required, URL)
- `endpoints.metadata` (optional, URL)
- `authHeaders` (optional, key/value table)

Validation via Zod (`RegisterToolpackBodySchema`). Submits via `sdk.toolpacks.register`. Server errors render in `<FormAlert>`.

**`EditToolpackDialog.component.tsx`** — same fields, all optional, plus a "Refresh schema" button that calls `sdk.toolpacks.refresh(id)` and shows feedback inline. The auth-headers UI distinguishes "not set" (empty) from "set" (placeholder dots) — submitting empty leaves the existing value untouched.

**`DeleteToolpackDialog.component.tsx`** — confirmation dialog with an impact list showing the stations currently enabling this pack. Uses an existing impact-style query if one is added; otherwise the delete API response includes the impacted-station list and the dialog waits to close until the API responds.

All three dialogs follow the project's Form & Dialog Pattern (Modal with `slotProps.paper`, `useDialogAutoFocus`, `<FormAlert>`, `focusFirstInvalidField`).

### Web — station picker

**`Create/EditStationDialog.component.tsx`** — add a new section listing custom packs underneath the existing built-in checkboxes (or alongside, in the same multi-select). Custom pack labels come from `pack.name`; values are `org:<id>` strings. The form's `toolPacks` array submits both flavors mixed together. Existing tests adjust their fixtures.

Once an org has more than ~6 custom packs the picker switches to `AsyncSearchableSelect` per the discovery, but v1 ships inline checkboxes for all values regardless of count. The async switch is a polish PR if it becomes useful.

### SDK extensions

**`apps/web/src/api/toolpacks.api.ts`**:

```ts
export const toolpacks = {
  list: …,
  get:  …,
  register: () =>
    useAuthMutation<ToolpackCreateResponsePayload, RegisterToolpackBody>({
      url: "/api/toolpacks",
    }),
  update: (id: string) =>
    useAuthMutation<ToolpackUpdateResponsePayload, UpdateToolpackBody>({
      url: `/api/toolpacks/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),
  remove: (id: string) =>
    useAuthMutation<ToolpackDeleteResponsePayload, void>({
      url: `/api/toolpacks/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),
  refresh: (id: string) =>
    useAuthMutation<ToolpackRefreshResponsePayload, void>({
      url: `/api/toolpacks/${encodeURIComponent(id)}/refresh`,
    }),
};
```

Mutation `onSuccess` in dialogs invalidates `queryKeys.toolpacks.root`; delete additionally invalidates `queryKeys.stations.root`.

---

## Migration

A single Drizzle migration named `0049_add_organization_toolpacks` performs:

1. `CREATE TABLE organization_toolpacks (...)` with the columns + unique index above.
2. `ALTER TABLE station_toolpacks ADD CONSTRAINT … FOREIGN KEY (organization_toolpack_id) REFERENCES organization_toolpacks(id)` — the column already exists from phase 1 nullable.
3. (No data move — the table is net-new and starts empty.)

Hand-write because drizzle-kit's introspection in this repo doesn't run cleanly (per phase 1 plan) — the journal entry is added manually as well.

---

## TDD test plan

Numbered against phase 1's plan continuation (cases 58–112).

### Layer 1 — `@portalai/core` (model + contracts)

**`packages/core/src/__tests__/models/organization-toolpack.model.test.ts`** (new)

58. Valid record parses cleanly.
59. Name regex rejects `Camel_Case`, leading digit, hyphen.
60. Empty `tools` array rejects.
61. `tools.length > 32` rejects.
62. `metadata` may be `null`.
63. `schemaFetchedAt` requires a number; rejects strings.
64. Endpoints URLs must be valid URLs.
65. Each tool name regex rejects malformed.
66. `parameterSchema` must be a record-typed object (not array, not null).
67. Factory produces a model instance with a generated id and stamped `createdBy`.

**`packages/core/src/__tests__/contracts/toolpack.contract.test.ts`** (extend)

68. `ToolpackSchema` accepts a `kind: "custom"` record.
69. Discriminated union rejects custom record without `endpoints`.
70. `RegisterToolpackBodySchema` accepts a minimal payload (`name`, `endpoints` only).
71. Update body refines: empty object is rejected.
72. Update body accepts a partial subset.

### Layer 2 — Drizzle / repository / migration

**`apps/api/src/__tests__/__integration__/db/repositories/organization-toolpacks.repository.integration.test.ts`** (new)

73. Insert + read round-trip.
74. Unique-name-per-org constraint rejects duplicate live rows.
75. Soft-deleting a row releases the unique constraint slot.
76. `findByOrganizationId` filters out soft-deleted rows.
77. `findManyByIds` scoped lookup honors the org filter (passing an id from another org returns nothing).

**Migration smoke test** (`__integration__/db/migrations/`)

78. After migration, `organization_toolpacks` exists with the expected columns.
79. After migration, `station_toolpacks_organization_toolpack_id_fkey` constraint exists.

### Layer 3 — Registration service

**`apps/api/src/__tests__/services/toolpack-registration.service.test.ts`** (new, unit tests with `fetch` mocked)

80. `fetchSchema` posts to the URL with the right headers and parses a valid response.
81. `fetchSchema` rejects oversize bodies with `TOOLPACK_SCHEMA_TOO_LARGE`.
82. `fetchSchema` rejects malformed JSON with `TOOLPACK_SCHEMA_INVALID`.
83. `fetchSchema` rejects HTTP errors with `TOOLPACK_SCHEMA_FETCH_FAILED`.
84. `fetchSchema` rejects schema responses missing `tools`.
85. `fetchSchema` rejects when any tool name fails the regex.
86. `fetchSchema` enforces 30 s timeout via AbortController.
87. `fetchMetadata` returns `null` on HTTP errors (best-effort).
88. `fetchMetadata` returns `null` on validation errors.
89. `fetchMetadata` returns the parsed object on success.
90. `validateNoBuiltinCollision` throws `TOOLPACK_TOOL_NAME_CONFLICT` for `"sql_query"`.

### Layer 4 — Routes (integration)

**`apps/api/src/__tests__/__integration__/routes/toolpacks.router.integration.test.ts`** (extend phase 1)

91. `POST /api/toolpacks` registers a pack and returns the merged record (auth headers redacted).
92. `POST` 409s on duplicate name within the same org.
93. `POST` 502s on schema fetch failure with `TOOLPACK_SCHEMA_FETCH_FAILED`.
94. `POST` 502s on schema validation failure.
95. `POST` 409s when a tool name collides with a built-in.
96. `POST` ignores metadata fetch errors (registration succeeds, `metadataFetchedAt` is null).
97. `PATCH` updates name + description without re-fetching schema.
98. `PATCH` re-fetches when `endpoints` changes.
99. `PATCH` 404s on cross-org id.
100. `DELETE` soft-deletes the pack and returns the impacted-station list.
101. `DELETE` cascades into `station_toolpacks` (matching rows soft-deleted).
102. `POST /:id/refresh` updates `tools` + `schemaFetchedAt` + `metadataFetchedAt`.
103. `POST /:id/refresh` keeps cached values on fetch failure.
104. `GET /api/toolpacks` returns built-ins + custom rows merged.
105. `GET /api/toolpacks?kind=custom` returns only custom rows scoped to the org.
106. `GET /api/toolpacks/:id` resolves a custom UUID id.

### Layer 5 — Tool service expansion (unit)

**`apps/api/src/__tests__/services/tools.service.test.ts`** (extend)

107. `buildAnalyticsTools` exposes a custom pack's tools when its station-toolpack row is enabled.
108. The custom tool's `execute` POSTs `{tool, input}` to the pack's runtime URL with auth headers.
109. Tool-name collision across two enabled custom packs raises `TOOLPACK_TOOL_NAME_CONFLICT` at build time.

### Layer 6 — Web

**`Toolpacks.view.test.tsx`** (extend)

110. Custom rows render Edit / Delete action buttons; built-in rows do not.
111. Clicking Register opens the register dialog.

**`RegisterToolpackDialog.test.tsx`** (new) — full Form & Dialog checklist (per CLAUDE.md): renders, validates, submits, shows server error, accessibility — ~10 cases.

**`EditToolpackDialog.test.tsx`** (new) — same pattern + "Refresh schema" button calls the refresh endpoint and surfaces failure inline — ~10 cases.

**`DeleteToolpackDialog.test.tsx`** (new) — confirmation + impact list — ~5 cases.

**`CreateStationDialog.test.tsx` / `EditStationDialog.test.tsx`** (extend) — fixture adds a custom pack to the available options; submission carries `org:<id>` strings in the request body — ~3 cases each.

112. Aggregate marker: every new dialog passes the project's Dialog & Form Test Checklist (renders, hides on closed, calls onSubmit, supports Enter, calls onClose, loading state, FormAlert on serverError, no FormAlert when null, validation errors, aria-invalid, required attribute).

### Test totals

- Core: 15 new cases.
- Drizzle / repos / migration: 7 new cases.
- Registration service unit: 11 new cases.
- Route integration: 16 new cases.
- Tool service unit: 3 new cases.
- Web: ~30 new cases across four dialogs and the existing view.

Total **~82 new cases** (cases 58–112 plus dialog checklist cases that bundle under 112).

---

## Acceptance criteria

- [ ] All new test cases pass (per layer above); existing test suites pass with the mechanical fixture additions.
- [ ] `cd apps/api && npm run test:unit && npm run test:integration` is green.
- [ ] `cd apps/web && npm run test:unit` is green.
- [ ] `cd packages/core && npm run test:unit` is green.
- [ ] `npm run lint && npm run type-check` from repo root are clean.
- [ ] `npm run db:migrate` creates `organization_toolpacks` and the FK on `station_toolpacks`.
- [ ] Manual smoke (dev server): register a custom pack pointing at a hand-rolled mock webhook (e.g. via ngrok/localtunnel), see it appear in `/toolpacks`, attach it to a station, open a portal session, ask the model to invoke a custom tool, see the runtime endpoint hit with the `{tool, input}` envelope and the response render in the portal.
- [ ] Auth headers do not appear in any list/get response body. The form's edit dialog distinguishes "set" (placeholder shown) from "not set" (empty) and never re-displays the actual values.
- [ ] Soft-deleting a custom toolpack removes it from every station's `enabledToolpacks` view immediately.

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Schema endpoint returns 500 KB+ of JSON. | 256 KB body cap. `TOOLPACK_SCHEMA_TOO_LARGE` rejects without parsing. |
| Schema endpoint includes a tool that collides with a built-in. | Registration runs `validateNoBuiltinCollision` before persisting; rejects with `TOOLPACK_TOOL_NAME_CONFLICT`. The runtime check in `buildAnalyticsTools` is defence-in-depth for any drift between registration and session-build. |
| Two custom packs registered at different times both define `get_customer_ltv`. | Tool-name uniqueness is *per session*, not *per registration*. Registration succeeds for both. The collision is detected at session-build time on a station that enables both — the model gets a clear error instead of two competing tools silently overwriting. Phase 4 adds a pre-flight warning in the station-edit dialog. |
| Webhook URLs point to internal addresses (SSRF). | Acknowledged. Phase 2 reuses the existing webhook fetch path — there is no SSRF protection today. Adding one is a separate hardening discovery. |
| Auth headers leak through error messages or logs. | The fetch path doesn't log headers; error responses include status code + status text only, never the response body. Tests confirm. |
| The `fetch` call hangs and ties up an org admin's UI. | 30 s `AbortController` timeout (existing pattern). The dialog button shows pending state; user can cancel and retry. |
| Refresh fails and the UI loses the cached `tools`. | Refresh on failure keeps the existing cached values and surfaces the error inline. Tests assert this. |
| Soft-deleting a custom pack orphans `station_toolpacks` rows. | The DELETE handler cascades soft-deletes through `station_toolpacks` matching rows. The session-build "at least one tool pack" guard catches the rare case where a station ends up with zero packs after cascade. |
| Browser caches the redacted response and the user pastes the placeholder dots back as new auth-header values. | The edit dialog's auth-headers field treats "set, value-not-shown" as a UI state, not a form value. Submitting without typing into the field omits `authHeaders` from the PATCH body — the existing value is preserved server-side. |
| Custom-pack picker in the station-edit dialog grows unwieldy at 50+ packs. | Out-of-scope for v1 — flagged for the polish PR if it becomes a real complaint. Inline checkboxes are fine at the v1 scale we expect. |

**Rollback** is a single migration revert (drop `organization_toolpacks` + the FK on `station_toolpacks`) plus a code revert. No production data exists yet at first deploy. Subsequent rollbacks would lose any custom-pack registrations the org has made — acceptable risk for a feature freshly behind a feature gate; no graceful "downgrade" path is provided.

---

## Files touched

### `packages/core`

- New: `src/models/organization-toolpack.model.ts`
- Edit: `src/contracts/toolpack.contract.ts` — extend the discriminated union and add request/response shapes.
- Edit: `src/models/index.ts`, `src/index.ts` — re-exports.
- New: `src/__tests__/models/organization-toolpack.model.test.ts`
- Edit: `src/__tests__/contracts/toolpack.contract.test.ts` — new cases for the custom arm.

### `apps/api`

- New: `src/db/schema/organization-toolpacks.table.ts`
- New: `src/db/repositories/organization-toolpacks.repository.ts` (extends base; adds `findByOrganizationId`, `findManyByIds`).
- New: Drizzle migration `0049_add_organization_toolpacks.sql`.
- New: `src/services/toolpack-registration.service.ts`
- Edit: `src/db/schema/zod.ts`, `type-checks.ts`, `index.ts` — register the new table.
- Edit: `src/db/repositories/index.ts`, `src/services/db.service.ts` — register the new repo.
- Edit: `src/routes/toolpacks.router.ts` — add POST/PATCH/DELETE/refresh; merge custom rows into list/get; resolve UUID ids in get.
- Edit: `src/services/tools.service.ts` — replace the `logger.warn` placeholder with the custom expansion path.
- Edit: `src/tools/webhook.tool.ts` — switch to `{tool, input}` payload shape.
- Edit: `src/constants/api-codes.constants.ts` — new error codes.
- New: integration tests for the repo + routes; unit test for the registration service.
- Edit: `src/__tests__/services/tools.service.test.ts` — three new cases.

### `apps/web`

- Edit: `src/api/toolpacks.api.ts` — new mutations.
- Edit: `src/api/sdk.ts`, `src/api/keys.ts` — same.
- Edit: `src/views/Toolpacks.view.tsx` — actions column for custom rows + register button + dialog wiring.
- Edit: `src/components/ToolpackMetadataModal.component.tsx` — display the `endpoints` and `lastRefreshed` fields for custom packs (built-in records continue to render as-is).
- New: `src/components/RegisterToolpackDialog.component.tsx`, `EditToolpackDialog.component.tsx`, `DeleteToolpackDialog.component.tsx`.
- Edit: `src/components/CreateStationDialog.component.tsx`, `EditStationDialog.component.tsx` — custom pack picker section.
- New: `src/__tests__/RegisterToolpackDialog.test.tsx`, `EditToolpackDialog.test.tsx`, `DeleteToolpackDialog.test.tsx`.
- Edit: existing `Toolpacks.view.test.tsx`, `Create/EditStationDialog.test.tsx` — additions.

No new dependency. No env-var change. No infra change.
