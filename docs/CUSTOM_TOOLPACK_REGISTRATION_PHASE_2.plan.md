# Custom Toolpack Registration — Phase 2 — Plan

**TDD-sequenced implementation of custom toolpack registration on top of the phase-1 storage shape.**

Spec: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_2.spec.md`. Discovery: `docs/CUSTOM_TOOLPACK_REGISTRATION.discovery.md`. Phase 1: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_1.{spec,plan}.md`.

The change is purely additive on top of phase 1: every existing test stays green between slices. Slices are sequenced so the public list endpoint emits custom rows only after the persistence + executor paths are both in place — no half-state where the UI advertises packs the executor can't run.

Run tests with the project's npm scripts (per `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice follows the standard red → green loop:

1. Write the failing tests for the slice's new behaviour.
2. Implement the smallest change that makes them pass.
3. Run the focused test suite; confirm green.
4. Run lint + type-check at slice boundary.

---

## Slice 1 — Core: model + contract extensions

Smallest diff. Establishes the shapes everything else depends on. No DB, no API, no UI.

**Files**

- New: `packages/core/src/models/organization-toolpack.model.ts`
- Edit: `packages/core/src/contracts/toolpack.contract.ts`
- Edit: `packages/core/src/models/index.ts`, `src/index.ts` — re-exports.
- New: `packages/core/src/__tests__/models/organization-toolpack.model.test.ts`
- Edit: `packages/core/src/__tests__/contracts/toolpack.contract.test.ts` — append cases for the custom arm and request bodies.

**Steps**

1. **Write the failing model test** (cases 58–67). Use the existing model-test pattern (`buildCoreModelFactory`, `StubIDFactory`).

2. **Write the failing contract test extensions** (cases 68–72). Extend the existing test file with a fixture for the custom record, and assert the discriminated-union resolution.

3. **Author the model.** Define `ToolpackEndpointsSchema`, `ToolpackToolDefinitionSchema`, `ToolpackMetadataSchema`, then `OrganizationToolpackSchema = CoreSchema.extend({...})` per the spec. Add `OrganizationToolpackModel` and `OrganizationToolpackModelFactory` mirroring `StationToolpackModel`.

4. **Extend the contract.** Add `CustomToolpackRecordSchema`, replace the discriminated-union literal with both arms, define `RegisterToolpackBodySchema`, `UpdateToolpackBodySchema`, and the corresponding response payload schemas (`ToolpackRegisterResponsePayloadSchema`, `ToolpackUpdateResponsePayloadSchema`, `ToolpackDeleteResponsePayloadSchema`, `ToolpackRefreshResponsePayloadSchema`). Re-use `ToolpackToolSchema` from phase 1 inside `CustomToolpackRecordSchema.tools`.

5. **Wire re-exports.**

6. **Run focused tests.** `cd packages/core && npm run test:unit -- --testPathPattern='(organization-toolpack.model|toolpack.contract)'`. All green.

7. **Lint + type-check + full core suite.**

**Done when:** cases 58–72 pass; existing core suite stays green.

**Risk:** none — pure additive types. The discriminated-union extension is verified by a test asserting both arms parse.

---

## Slice 2 — API: `organization_toolpacks` table + repository + migration

Schema + persistence layer. Sets up the FK target before any code reads from it. After this slice, the table exists and the repo works, but no route or service touches it yet.

**Files**

- New: `apps/api/src/db/schema/organization-toolpacks.table.ts`
- New: `apps/api/src/db/repositories/organization-toolpacks.repository.ts`
- New: Drizzle migration `0049_add_organization_toolpacks.sql`.
- Edit: `apps/api/src/db/schema/index.ts`, `zod.ts`, `type-checks.ts` — register the new table.
- Edit: `apps/api/src/db/repositories/index.ts`, `src/services/db.service.ts` — register the new repo.
- New: `apps/api/src/__tests__/__integration__/db/repositories/organization-toolpacks.repository.integration.test.ts`

**Steps**

1. **Write the integration test (cases 73–77).** Mirror the phase-1 `station-toolpacks.repository.integration.test.ts` pattern: spin up the test DB, insert a row, exercise `findByOrganizationId`, `findManyByIds`, the unique-name partial index.

2. **Author the schema.** Per spec — columns + the unique partial index on `(organization_id, name) WHERE deleted IS NULL`.

3. **Author the migration.** Hand-write `0049_add_organization_toolpacks.sql`:

   ```sql
   CREATE TABLE IF NOT EXISTS "organization_toolpacks" (
     "id" text PRIMARY KEY NOT NULL,
     "created" bigint NOT NULL,
     "created_by" text NOT NULL,
     "updated" bigint,
     "updated_by" text,
     "deleted" bigint,
     "deleted_by" text,
     "organization_id" text NOT NULL,
     "name" text NOT NULL,
     "description" text,
     "endpoints" jsonb NOT NULL,
     "auth_headers" jsonb,
     "tools" jsonb NOT NULL,
     "metadata" jsonb,
     "schema_fetched_at" bigint NOT NULL,
     "metadata_fetched_at" bigint
   );

   DO $$ BEGIN
     ALTER TABLE "organization_toolpacks"
       ADD CONSTRAINT "organization_toolpacks_organization_id_organizations_id_fk"
       FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;

   CREATE UNIQUE INDEX IF NOT EXISTS "organization_toolpacks_org_name_unique"
     ON "organization_toolpacks" ("organization_id", "name")
     WHERE "deleted" IS NULL;

   DO $$ BEGIN
     ALTER TABLE "station_toolpacks"
       ADD CONSTRAINT "station_toolpacks_organization_toolpack_id_fk"
       FOREIGN KEY ("organization_toolpack_id")
       REFERENCES "organization_toolpacks"("id");
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   ```

   Append the journal entry as in phase 1.

4. **Author the repository.** Extend `Repository<typeof organizationToolpacks, …>`. Implement:

   - `findByOrganizationId(orgId, opts?, client?)` — soft-delete-aware list scoped to org.
   - `findManyByIds(ids, organizationId?, client?)` — used by `tools.service` at session-build time. The `organizationId` arg is optional but defaults to filtering by it when provided.

5. **Wire schema/zod/type-checks.** Add `OrganizationToolpackSelectSchema` and `OrganizationToolpackInsertSchema` derived via `drizzle-zod`. Add a type-check block asserting `IsAssignable<OrganizationToolpackSelect, OrganizationToolpack>` and the inferred-row direction.

6. **Wire the repository in `DbService`.** Add `organizationToolpacks: organizationToolpacksRepo` to `DbService.repository`.

7. **Run integration tests.** `cd apps/api && npm run test:integration -- --testPathPattern='organization-toolpacks.repository'`. All green. Also run the migration smoke probe (case 78–79) — the migration itself is verified by the `beforeAll` migrate step in the integration setup.

8. **Lint + type-check + full unit suite.**

**Done when:** the table + FK exist; cases 73–77 pass.

**Risk:** the partial unique index `WHERE deleted IS NULL` must be correctly authored as a PostgreSQL partial index, not a unique constraint. Direct SQL, no drizzle-kit ambiguity.

---

## Slice 3 — API: registration service (HTTP fetch + validation)

Standalone unit. No DB writes, no router, just the HTTP fetch helper and the validation logic that the route handlers will call.

**Files**

- New: `apps/api/src/services/toolpack-registration.service.ts`
- New: `apps/api/src/__tests__/services/toolpack-registration.service.test.ts`

**Steps**

1. **Write the unit test (cases 80–90).** Mock `globalThis.fetch` (existing pattern in `tools.service.test.ts`). Cover:
   - Happy-path schema fetch with custom headers.
   - Body-size cap.
   - Malformed JSON.
   - HTTP error.
   - Missing `tools` field.
   - Bad tool-name regex.
   - 30 s timeout via AbortController.
   - Metadata fetch returns `null` on failures.
   - Metadata fetch parses on success.
   - `validateNoBuiltinCollision` throws on `"sql_query"`.

2. **Author the service.** Implement:

   ```ts
   const FETCH_TIMEOUT_MS = 30_000;
   const MAX_RESPONSE_BYTES = 256 * 1024;

   export class ToolpackRegistrationService {
     static async fetchSchema(url, headers): Promise<ToolpackToolDefinition[]> {
       const text = await fetchWithCap(url, headers);
       const parsed = JSON.parse(text);          // throws TOOLPACK_SCHEMA_INVALID
       const validated = SchemaResponseShape.parse(parsed);
       return validated.tools;
     }

     static async fetchMetadata(url, headers): Promise<ToolpackMetadata | null> {
       try {
         const text = await fetchWithCap(url, headers);
         const parsed = JSON.parse(text);
         return ToolpackMetadataSchema.parse(parsed);
       } catch {
         return null;
       }
     }

     static validateNoBuiltinCollision(tools, builtinNames: Set<string>): void {
       for (const t of tools) {
         if (builtinNames.has(t.name)) {
           throw new ApiError(
             409,
             ApiCode.TOOLPACK_TOOL_NAME_CONFLICT,
             `Tool "${t.name}" conflicts with a built-in tool name`
           );
         }
       }
     }
   }
   ```

   `fetchWithCap` is a private helper that wraps `fetch`, applies the AbortController timeout, reads the response stream up to `MAX_RESPONSE_BYTES`, and throws structured `ApiError`s for the failure paths.

3. **Pull `PACK_TOOL_NAMES` out of `ToolService` into a shared registry.** The existing private `Set` in `tools.service.ts:100` needs to be reachable from this service. Two options:
   - Export the set from `tools.service.ts` (one-line change).
   - Move it to a new `apps/api/src/registries/builtin-tool-names.ts` and re-export from `tools.service.ts` for backward compat.

   Recommend: export from `tools.service.ts` as `BUILTIN_TOOL_NAMES`. Smallest diff. The registration service imports it directly.

4. **Run unit tests.** `npm run test:unit -- --testPathPattern='toolpack-registration.service'`. All 11 green.

5. **Lint + type-check.**

**Done when:** cases 80–90 pass.

**Risk:** the `fetch`-with-stream-cap implementation is fiddly. Default to using `response.text()` after checking `Content-Length`, with a fallback that reads from the body stream and aborts past the cap. Test-wise, mock fetch so this complexity is covered by case 81.

---

## Slice 4 — API: register / update / delete / refresh routes

Wires the registration service into the `toolpacks.router.ts` from phase 1. After this slice, custom packs can be created, modified, refreshed, and deleted via the API. `GET` still emits only built-ins (slice 5 changes that).

**Files**

- Edit: `apps/api/src/routes/toolpacks.router.ts` — add POST/PATCH/DELETE/refresh.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — new error codes.
- Edit: `apps/api/src/__tests__/__integration__/routes/toolpacks.router.integration.test.ts` — extend with cases 91–103.

**Steps**

1. **Add ApiCode entries.** `TOOLPACK_INVALID_PAYLOAD`, `TOOLPACK_NAME_CONFLICT`, `TOOLPACK_TOOL_NAME_CONFLICT`, `TOOLPACK_SCHEMA_FETCH_FAILED`, `TOOLPACK_SCHEMA_TOO_LARGE`, `TOOLPACK_SCHEMA_INVALID`.

2. **Write integration tests (cases 91–103).** The existing `toolpacks.router.integration.test.ts` has the auth + DB setup; extend it with describe blocks for POST / PATCH / DELETE / refresh.

   Use `nock` or a fetch mock for the upstream schema/metadata endpoints. The integration test setup has a similar pattern in the connector OAuth tests — audit and reuse.

3. **Implement POST.**

   ```ts
   toolpacksRouter.post(
     "/",
     getApplicationMetadata,
     async (req, res, next) => {
       const parsed = RegisterToolpackBodySchema.safeParse(req.body);
       if (!parsed.success) {
         return next(new ApiError(400, ApiCode.TOOLPACK_INVALID_PAYLOAD, "Invalid payload"));
       }
       const { organizationId, userId } = req.application!.metadata;
       const { name, description, endpoints, authHeaders } = parsed.data;

       // Name uniqueness
       const existing = await DbService.repository.organizationToolpacks.findByOrganizationId(organizationId);
       if (existing.some((p) => p.name === name)) {
         return next(new ApiError(409, ApiCode.TOOLPACK_NAME_CONFLICT, "A toolpack with this name already exists"));
       }

       // Fetch + validate schema
       const tools = await ToolpackRegistrationService.fetchSchema(endpoints.schema, authHeaders);
       ToolpackRegistrationService.validateNoBuiltinCollision(tools, BUILTIN_TOOL_NAMES);

       // Optional metadata
       const metadata = endpoints.metadata
         ? await ToolpackRegistrationService.fetchMetadata(endpoints.metadata, authHeaders)
         : null;

       const factory = new OrganizationToolpackModelFactory();
       const model = factory.create(userId);
       const now = Date.now();
       model.update({
         organizationId,
         name,
         description: description ?? null,
         endpoints,
         authHeaders: authHeaders ?? null,
         tools,
         metadata,
         schemaFetchedAt: now,
         metadataFetchedAt: metadata !== null ? now : null,
       });

       const row = await DbService.repository.organizationToolpacks.create(model.parse());

       return HttpService.success<ToolpackRegisterResponsePayload>(res, {
         toolpack: toApiRecord(row),
       }, 201);
     }
   );
   ```

   `toApiRecord(row)` is a new helper that converts an `OrganizationToolpackSelect` into a `CustomToolpackRecord`, including the `authHeadersStatus: { has: row.authHeaders !== null && Object.keys(row.authHeaders).length > 0 }` redaction.

4. **Implement PATCH.** Similar shape; if `endpoints` is in the patch body, re-fetch schema and metadata before persisting. If `endpoints` is omitted, keep the cached values untouched. Name uniqueness check only fires when `name` changes.

5. **Implement DELETE.** Soft-delete the toolpack, then within the same transaction soft-delete every `station_toolpacks` row whose `organization_toolpack_id` matches. Return the `affectedStationIds: string[]` so the UI can warn.

6. **Implement refresh.** Re-fetch schema + metadata. On any failure, keep the existing cached values and return the appropriate error code. On success, update `tools`, `metadata`, `schemaFetchedAt`, `metadataFetchedAt`, and the audit fields.

7. **Run integration tests.** All 13 new cases green.

8. **Lint + type-check + unit suite.**

**Done when:** cases 91–103 pass and existing API tests are unchanged.

**Risk:** the auth-header redaction has to be applied uniformly across every read path (POST response, PATCH response, refresh response, GET list, GET detail). The shared `toApiRecord` helper enforces this. Add a tiny snapshot-style test that asserts `authHeaders` is never present in any response body — protects against future drift.

---

## Slice 5 — API: list + detail merge custom rows

Surfaces custom packs on `GET /api/toolpacks` and `GET /api/toolpacks/:id` for the requesting org.

**Files**

- Edit: `apps/api/src/routes/toolpacks.router.ts` — extend the existing list and detail handlers.
- Edit: `apps/api/src/__tests__/__integration__/routes/toolpacks.router.integration.test.ts` — cases 104–106.

**Steps**

1. **Write the integration tests (cases 104–106).**

2. **Extend the list handler.**

   ```ts
   const { organizationId } = req.application!.metadata;
   const customs = await DbService.repository.organizationToolpacks.findByOrganizationId(organizationId);

   const all: Toolpack[] = [
     ...(kind === "custom" ? [] : BUILTIN_TOOLPACKS.map(toBuiltinApiRecord)),
     ...(kind === "builtin" ? [] : customs.map(toApiRecord)),
   ];

   const filtered = search
     ? all.filter((t) => matchesSearch(search.toLowerCase(), t))
     : all;
   ```

3. **Extend the get handler.** Resolve order:
   - `id.startsWith("builtin:")` → registry lookup (existing path).
   - Otherwise → `organizationToolpacks.findById(id)` scoped to `organizationId` (404 if not found or cross-org).

4. **Run tests.** Cases 104–106 green; cases 36–42 still pass.

**Done when:** the list and detail emit custom rows; the `?kind=custom` filter works.

**Risk:** none.

---

## Slice 6 — API: `WebhookTool` + `tools.service` custom expansion

The executor side. After this slice, a station with a custom toolpack enabled actually exposes its tools to the model.

**Files**

- Edit: `apps/api/src/tools/webhook.tool.ts` — switch payload to `{tool, input}`.
- Edit: `apps/api/src/services/tools.service.ts` — replace the phase-1 `logger.warn` placeholder with the custom expansion.
- Edit: `apps/api/src/__tests__/services/tools.service.test.ts` — cases 107–109.

**Steps**

1. **Update the existing slice 4 test that documented the placeholder behaviour.** The test currently asserts that custom rows are skipped with a warning. Replace it with a test asserting the new expansion behavior (case 107).

2. **Write cases 108 and 109.**

3. **Implement the `WebhookTool` payload change.**

   ```ts
   body: JSON.stringify({ tool: this.slug, input }),
   ```

4. **Implement the custom expansion.** Per the spec — load org packs by id, walk `tools[]`, instantiate `WebhookTool` per entry, throw `TOOLPACK_TOOL_NAME_CONFLICT` on collision.

5. **Run tests.** Unit suite green. Existing portal/integration tests (which mock `loadStation`) need a `mockFindByStationId_toolpacks` setup that includes any `organization_toolpack_id` rows the test wants to cover; audit and adjust.

6. **Manual smoke**: stand up a quick mock webhook (e.g. `python -m http.server` with a static JSON file for the schema endpoint, plus a separate POST handler for runtime). Register the pack via the dev API, attach to a station, run a portal session prompt that hits the custom tool.

**Done when:** cases 107–109 pass; full unit + integration suites are green.

**Risk:** any test that previously asserted "custom rows are silently skipped" must be updated. Audit the unit tests for `Custom toolpack rows present` log assertions and migrate them.

---

## Slice 7 — Web: SDK extensions + view actions column

Now that the API is complete, light up the front-end without yet adding the dialogs. After this slice the table renders custom rows correctly and the actions column is visible (but Edit/Delete buttons don't open dialogs yet — they just dispatch placeholder handlers that the next slice replaces).

**Files**

- Edit: `apps/web/src/api/toolpacks.api.ts` — register/update/remove/refresh mutations.
- Edit: `apps/web/src/api/sdk.ts`, `keys.ts` — no shape change beyond exposing the new operations.
- Edit: `apps/web/src/views/Toolpacks.view.tsx` — actions column renders edit/delete icon buttons for `kind === "custom"`; "Register toolpack" header button; pass through new optional callback props (`onRegister`, `onEdit`, `onDelete`, `onRefresh`).
- Edit: `apps/web/src/components/ToolpackMetadataModal.component.tsx` — render `endpoints` and `lastRefreshed` for custom packs.
- Edit: `apps/web/src/__tests__/Toolpacks.view.test.tsx` — case 110 + 111.

**Steps**

1. **Author the SDK mutations** per the spec.

2. **Update `ToolpacksUI` props.** Add `onRegister?: () => void`, `onEdit?: (toolpack: Toolpack) => void`, `onDelete?: (toolpack: Toolpack) => void`, `onRefresh?: (toolpack: Toolpack) => void`. Render actions column for custom rows only; render the primary action button if `onRegister` is supplied.

3. **Write tests (cases 110 + 111).** Using the pure-UI test pattern from phase 1.

4. **Update the metadata modal** to render `endpoints.schema / runtime / metadata` (when present) and `lastRefreshed` for custom packs. Built-in records continue to render as in phase 1.

5. **Wire the container to call the mutations.** The container component handles `onRegister/onEdit/onDelete/onRefresh` by setting selected-pack state; dialog opening lands in slice 8.

**Done when:** custom rows render correctly with actions; clicking actions toggles container state (no-op visually until slice 8); existing test suite green.

**Risk:** none.

---

## Slice 8 — Web: register / edit / delete dialogs

The substance of the front-end work. Three dialogs, all per the project's Form & Dialog Pattern.

**Files**

- New: `src/components/RegisterToolpackDialog.component.tsx`
- New: `src/components/EditToolpackDialog.component.tsx`
- New: `src/components/DeleteToolpackDialog.component.tsx`
- Edit: `src/views/Toolpacks.view.tsx` — wire the dialogs.
- New: `src/__tests__/RegisterToolpackDialog.test.tsx`
- New: `src/__tests__/EditToolpackDialog.test.tsx`
- New: `src/__tests__/DeleteToolpackDialog.test.tsx`

**Steps**

1. **Write the dialog test files.** Each follows the project's Dialog & Form Test Checklist (renders title, form submission, Enter key, onClose, isPending, FormAlert on/off, validation errors, aria-invalid, required attributes — see `CreateStationDialog.test.tsx` for the template).

2. **Author the dialogs.** Each is a pure-UI component:
   - `RegisterToolpackDialogUI` props: `{ open, onClose, onSubmit, isPending, serverError }`.
   - `EditToolpackDialogUI` props: `{ open, onClose, onSubmit, onRefresh, toolpack, isPending, isRefreshing, serverError, refreshError }`.
   - `DeleteToolpackDialogUI` props: `{ open, onClose, onConfirm, toolpackName, impactedStations, isPending, serverError }`.

   Use `<Modal>` with `slotProps.paper.component="form"` and `onSubmit` per the project pattern. Use `useDialogAutoFocus` for the name field. Validate via `validateWithSchema(RegisterToolpackBodySchema, form)`. Action buttons `type="button"` to prevent double-fire.

3. **Implement the auth-headers UI.** A small editable key/value table. In edit mode, if the existing record has `authHeadersStatus.has === true`, the table shows a single placeholder row with dotted values to communicate "set, value not shown"; clearing the placeholder and submitting empty leaves the existing value untouched (the form omits `authHeaders` from the PATCH body in that case).

4. **Wire the dialogs in `Toolpacks.view.tsx`.** Replace the placeholder handlers from slice 7 with state-driven dialog open/close + mutation invocations + cache invalidation.

5. **Run tests.** Three dialog test suites + the view test suite all green.

**Done when:** the user can register, edit, delete, and refresh custom packs end-to-end via the UI.

**Risk:** the auth-headers UI has the trickiest state machine — "set but not shown" vs. "actively cleared by the user" vs. "not yet set". The test cases need to exercise all three.

---

## Slice 9 — Web: station create/edit dialogs accept custom packs

The final piece: stations can attach custom toolpacks alongside built-ins.

**Files**

- Edit: `src/components/CreateStationDialog.component.tsx`
- Edit: `src/components/EditStationDialog.component.tsx`
- Edit: existing tests on both.
- Edit: `apps/web/src/utils/tool-packs.util.ts` — extend label resolution for `org:<id>` strings.

**Steps**

1. **Extend `ToolPackUtil.getLabel`.** When the slug starts with `org:`, the helper looks up the toolpack via a new client-side `Map<id, name>` populated from the toolpacks list query. The helper takes an optional second argument (the map) so the existing call sites stay simple.

2. **Update the dialogs.** Fetch the toolpack list via `sdk.toolpacks.list()`. Filter to `kind === "custom"` to render under a new "Custom toolpacks" subsection. The existing built-in checkboxes stay; the `toolPacks` form-state array now includes `org:<id>` strings for selected customs.

3. **Update the request body builder.** No change — the array is already a `string[]`, and the API router parses each value. Built-in slug → `builtin_slug`; `org:` prefix → `organization_toolpack_id`.

4. **Update the station router** (if not already covered in slice 4). Today `replaceForStation({ builtinSlugs })` accepts only built-ins. Phase 2 extends it to also accept `organizationToolpackIds: string[]`. Parse the incoming `toolPacks: string[]` into the two buckets in the router and pass both to the repo.

5. **Write tests.** Cases under 112: each station dialog test gets two new cases — submitting with a mix of built-in and custom selections; submitting with custom-only.

6. **Run all web tests + api integration tests.**

**Done when:** end-to-end flow works (register pack → attach to station → portal session uses the custom tool).

**Risk:** the station router's `replaceForStation` interface change is the one cross-package touch in this slice. Phase 1's repo already exposes an `organizationToolpackIds?: string[]` parameter (defaulted to `[]`); this slice just starts populating it.

---

## Sequence summary

| Slice | What lands | Tests added | Test commands |
|---|---|---|---|
| 1 | Core: `OrganizationToolpack` model + contract extensions | 15 | `cd packages/core && npm run test:unit` |
| 2 | API: `organization_toolpacks` table + repo + migration + FK | 7 | `cd apps/api && npm run test:integration` |
| 3 | API: `ToolpackRegistrationService` (HTTP fetch + validation) | 11 | `cd apps/api && npm run test:unit` |
| 4 | API: register/update/delete/refresh routes | 13 | `cd apps/api && npm run test:integration` |
| 5 | API: list + get merge custom rows | 3 | `cd apps/api && npm run test:integration` |
| 6 | API: `WebhookTool` payload + custom expansion in `tools.service` | 3 | `cd apps/api && npm run test:unit` |
| 7 | Web: SDK extensions + view actions column | 2 + minor metadata-modal updates | `cd apps/web && npm run test:unit` |
| 8 | Web: Register / Edit / Delete dialogs | ~25 (dialog checklist × 3) | `cd apps/web && npm run test:unit` |
| 9 | Web: station dialogs accept custom packs | ~6 | `cd apps/web && npm run test:unit` |

Total new test cases: **~85**.

**Recommended PR boundaries**

- **PR 1**: slices 1 + 2 + 3 (core + API persistence + service). Pure additive; nothing existing changes behavior.
- **PR 2**: slices 4 + 5 + 6 (API write paths + executor). The substance.
- **PR 3**: slices 7 + 8 + 9 (web). Visible end.

Three PRs at roughly the same size. Each PR's tests fully exercise its own surface; the project's full test suite stays green between PRs.

---

## Cross-slice notes

- **No new dependencies.** The HTTP fetch is `globalThis.fetch` (existing pattern in `tools.service.ts`); JSON-Schema validation is hand-rolled Zod in the registration service.

- **`PACK_TOOL_NAMES` location.** Slice 3 hoists this set out of `ToolService` private-static into a module-level export, so the registration service can import it without circularity. Verify by `grep PACK_TOOL_NAMES` after the move — only `tools.service.ts` and the registration service should reference it.

- **Soft-delete cascade rules.** Phase 1 established that `station_toolpacks` rows are soft-deleted, never hard-deleted. The new cascade in slice 4's DELETE handler follows the same rule. The `WHERE deleted IS NULL` clause on the unique index lets a station re-attach a soft-deleted pack later (currently impossible since the pack itself is soft-deleted; harmless behaviour).

- **Auth-header redaction discipline.** A lightweight test should assert that the response body of every read endpoint never contains the literal value of an auth header. Implementation: snapshot a known fixture's response and grep for the seeded header value. Catches accidental field-spreads (`...row` would leak `authHeaders`) before they reach prod.

- **Migration test.** The phase-1 plan added a migration smoke test for `0048_drop_stations_tool_packs`. Phase 2's migration adds a similar smoke test (cases 78–79): assert the table exists with the expected columns and the FK constraint is in place. Reuse the migration-test scaffolding from phase 1.

- **Logging.** Registration failures log the structured error code and the upstream URL but never the response body or auth headers. Refresh failures log the same.

- **CLAUDE.md compliance.** All new files follow the project's suffix conventions. Pure-UI dialogs export `<Name>UI`; container components use the bare name. The Form & Dialog Pattern (`<FormAlert>`, `useDialogAutoFocus`, `focusFirstInvalidField`) applies to all three dialogs. SDK mutations live under `apps/web/src/api/`.

- **Mutation cache invalidation.** Per the project's Mutation Cache Invalidation policy:
  - Register / update / refresh: invalidate `queryKeys.toolpacks.root`.
  - Delete: invalidate `queryKeys.toolpacks.root` AND `queryKeys.stations.root` (because affected stations' `enabledToolpacks` change).

- **Storybook.** Phase 2 doesn't add new built-in surfaces but the three new dialogs are good Storybook subjects. If the project's Storybook coverage extends to all new pure-UI components, add three minimal `*.stories.tsx` files; otherwise defer.
