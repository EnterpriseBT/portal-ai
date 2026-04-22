# C2 — Entity Key Unique per Organization — Implementation Plan

TDD-ordered walkthrough to ship
`REGION_CONFIG.c2_org_unique_entity_key.spec.md` as a single PR.
Every step is **red → green → refactor**: write (or extend) the
failing test first, run it to confirm it fails for the right reason,
implement the smallest change that makes it green, run the scoped
command, then extend coverage and refactor.

Feature flag: none. The rule is universally correct; the migration
refuses to apply until the audit script returns empty.

## Pre-flight

Open the current state so later steps have accurate references:

- `apps/api/src/db/schema/connector-entities.table.ts` — note the
  existing `uniqueIndex("connector_entities_instance_key_unique")` on
  `(connectorInstanceId, key) WHERE deleted IS NULL`.
- `apps/api/src/db/repositories/connector-entities.repository.ts` —
  note `upsertByKey`'s current conflict target
  `(connectorInstanceId, key)`.
- `apps/api/src/services/field-mappings/reconcile.ts` — note
  `lookupDbEntityNormalizedKeys` already scopes to `organizationId`
  and uses `.limit(1)`; under C2 the `.limit(1)` becomes structurally
  unnecessary (the index guarantees it) — the refactor is mostly
  comment + docs, not logic.
- `apps/api/src/services/layout-plan-commit.service.ts` — note the
  per-target loop calls `connectorEntities.upsertByKey(...)`; errors
  from the repo bubble through the surrounding transaction.
- `apps/api/src/constants/api-codes.constants.ts` — note the
  surrounding `CONNECTOR_ENTITY_*` codes.
- `apps/api/src/routes/connector-entity.router.ts` — note the GET `/`
  handler's `include` query parameter and its existing LEFT-JOIN
  plumbing (see the precedent in
  `connector-instances.router.ts` for an `include=definition` style
  join).
- `apps/api/drizzle/` — note the next sequential migration number so
  the generated file slots in.
- `apps/api/scripts/` — note any existing one-off script for the
  pattern to follow (most precedent scripts live here and are run via
  workspace npm scripts).
- `apps/web/src/api/connector-entities.api.ts` — note the `search`
  SDK endpoint and the existing `labelMap` shape.
- `apps/web/src/modules/RegionEditor/RegionConfigurationPanel.component.tsx`
  — note how `buildSelectOptions` formats each option; the C2
  change extends the label for `source === "db"` entries.
- `apps/web/src/modules/RegionEditor/NewEntityDialog.component.tsx` —
  note the current synchronous `existingKeys: string[]` check and the
  Zod schema in `buildSchema`.

Commands referenced throughout, always run from `/workspace`:

| Purpose                     | Command                                                     |
|-----------------------------|-------------------------------------------------------------|
| Parser unit + integration   | `npm --workspace packages/spreadsheet-parsing run test`     |
| API unit                    | `npm --workspace apps/api run test:unit`                    |
| API integration             | `npm --workspace apps/api run test:integration`             |
| API migration + audit       | `npm --workspace apps/api run db:migrate`                   |
| Audit script (new)          | `npm --workspace apps/api run audit:entity-keys`            |
| Migration generate          | `npm --workspace apps/api run db:generate -- --name connector_entities_org_unique_key` |
| Web unit                    | `npm --workspace apps/web run test:unit`                    |
| Root type-check             | `npm run type-check`                                        |

Per the memory on test scripts, never run `npx jest` directly — these
scripts set the right `NODE_OPTIONS`.

---

## Phase A — Error code (foundational; no tests, used by later phases)

### A1. Register API error code

**File**: `apps/api/src/constants/api-codes.constants.ts`.

Add `CONNECTOR_ENTITY_KEY_IN_USE_BY_OTHER_CONNECTOR` to the `ApiCode`
enum, grouped with the surrounding `CONNECTOR_ENTITY_*` codes. No
standalone test; correctness is verified via the repository test in
D1.

---

## Phase B — Audit script (shippable before any schema change)

### B1. Red — audit-script integration test

**File**:
`apps/api/src/__tests__/__integration__/scripts/audit-duplicate-entity-keys.integration.test.ts`
(new).

The script exports a pure function `findDuplicateEntityKeys(db):
Promise<Array<{ organizationId, key, ids }>>` so the test can drive
it without spawning a subprocess.

```ts
describe("audit-duplicate-entity-keys", () => {
  it("returns every (org, key) group with more than one live entity", async () => {
    // Seed org-1 with two connectors that each own a "contacts" entity.
    // Seed org-2 with a single "contacts" entity (must not appear).
    // Seed org-1 with a second "contacts" that's soft-deleted (must not appear).
    const rows = await findDuplicateEntityKeys(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: org1Id,
      key: "contacts",
      ids: expect.arrayContaining([entityA.id, entityB.id]),
    });
  });

  it("returns an empty array when no collisions exist", async () => {
    const rows = await findDuplicateEntityKeys(db);
    expect(rows).toEqual([]);
  });
});
```

Run: `npm --workspace apps/api run test:integration -- audit-duplicate`.
Expect failure — the script doesn't exist yet.

### B2. Green — implement the script

**File**: `apps/api/scripts/audit-duplicate-entity-keys.ts` (new).

```ts
export async function findDuplicateEntityKeys(db: DbClient): Promise<Duplicate[]> {
  // SELECT organization_id, key, COUNT(*), array_agg(id)
  // FROM connector_entities
  // WHERE deleted IS NULL
  // GROUP BY organization_id, key
  // HAVING COUNT(*) > 1
}

async function main(): Promise<void> {
  const duplicates = await findDuplicateEntityKeys(db);
  if (duplicates.length === 0) {
    console.log("No duplicate entity keys found.");
    return;
  }
  for (const dup of duplicates) {
    console.log(`${dup.organizationId} ${dup.key} ids=${dup.ids.join(",")}`);
  }
  process.exitCode = 1; // surfaces failure in CI / support runs
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

Wire `audit:entity-keys` into `apps/api/package.json` scripts
(`tsx scripts/audit-duplicate-entity-keys.ts`). Run B1 again — green.

### B3. Refactor

- Keep the pure function exported so the CI pre-migration gate can
  call it without a subprocess.
- Add a Pino-style log line (not `console.log`) if that matches other
  scripts in `apps/api/scripts/`.

**Why ship this first:** the spec's rollout says "Ship the audit
script first (can be run against production before any schema
change)". Landing the script in its own commit lets Support triage
any collisions before the migration phase locks in.

---

## Phase C — Schema + migration

### C1. Red — migration integration test

**File**:
`apps/api/src/__tests__/__integration__/db/connector-entities-schema.integration.test.ts`
(new).

```ts
describe("connector_entities — org-wide unique key (C2)", () => {
  it("rejects two rows with the same (organization_id, key) in different connectors at the DB layer", async () => {
    await db.insert(connectorEntities).values({ ...baseA, key: "contacts" });
    await expect(
      db.insert(connectorEntities).values({ ...baseB, key: "contacts" })
      // baseA.connectorInstanceId !== baseB.connectorInstanceId, same org
    ).rejects.toThrow(/unique/i);
  });

  it("still allows the same key across different organizations", async () => {
    await db.insert(connectorEntities).values({ orgA, connectorA, key: "contacts" });
    await db.insert(connectorEntities).values({ orgB, connectorA_orgB, key: "contacts" });
    // no throw
  });

  it("permits reusing a key whose prior owner is soft-deleted", async () => {
    await db.insert(connectorEntities).values({ orgA, connectorA, key: "x", deleted: Date.now() });
    await db.insert(connectorEntities).values({ orgA, connectorB, key: "x" });
    // no throw
  });
});
```

Run: `npm --workspace apps/api run test:integration -- connector-entities-schema`.
Expect failure — the current partial index is scoped to
`connector_instance_id`, so the first case succeeds.

### C2. Green — update schema + generate migration

**File**: `apps/api/src/db/schema/connector-entities.table.ts`.

```ts
(table) => [
  uniqueIndex("connector_entities_org_key_unique")
    .on(table.organizationId, table.key)
    .where(sql`deleted IS NULL`),
]
```

Drop the `connector_entities_instance_key_unique` definition.

Generate the migration:

```
npm --workspace apps/api run db:generate -- --name connector_entities_org_unique_key
```

Inspect `apps/api/drizzle/<NNNN>_connector_entities_org_unique_key.sql`.
Expected SQL:

```sql
DROP INDEX IF EXISTS "connector_entities_instance_key_unique";
CREATE UNIQUE INDEX "connector_entities_org_key_unique"
  ON "connector_entities" ("organization_id", "key")
  WHERE "deleted" IS NULL;
```

If drizzle-kit's emitter omits the partial predicate, hand-edit the
SQL — PostgreSQL supports it natively.

Document rollback in a SQL comment inside the migration file (drop
new index, recreate old). Per the spec, treat this as a one-way
migration; don't plan to run the rollback.

Apply:

```
npm --workspace apps/api run db:migrate
```

Run C1 again — green. Then the full API integration suite to catch
any suite that seeds duplicate keys (the spec's dry-run audit should
have caught these in prod; test fixtures may still have them):

```
npm --workspace apps/api run test:integration
```

### C3. Refactor

- Update any test fixture that seeded two same-key entities across
  connectors (migration task; note it in the PR body).
- Confirm the new index name is referenced nowhere in the codebase
  other than the migration file — repositories don't name-reference
  indexes, but double-check with a grep.

---

## Phase D — Repository `upsertByKey`

### D1. Red — repository integration tests

**File**:
`apps/api/src/__tests__/__integration__/db/repositories/connector-entities.repository.integration.test.ts`
(extend).

```ts
describe("upsertByKey — C2 org-wide uniqueness", () => {
  it("updates the existing row when the same connector upserts the same key", async () => {
    const first = await repo.upsertByKey({ ...baseA, key: "contacts", label: "v1" });
    const second = await repo.upsertByKey({ ...baseA, key: "contacts", label: "v2" });
    expect(second.id).toBe(first.id);
    expect(second.label).toBe("v2");
  });

  it("throws CONNECTOR_ENTITY_KEY_IN_USE_BY_OTHER_CONNECTOR when another connector in the same org owns the key", async () => {
    await repo.upsertByKey({ ...baseA, key: "contacts" });
    await expect(
      repo.upsertByKey({ ...baseB /* different connectorInstanceId, same org */, key: "contacts" })
    ).rejects.toMatchObject({
      status: 400,
      code: ApiCode.CONNECTOR_ENTITY_KEY_IN_USE_BY_OTHER_CONNECTOR,
    });
  });

  it("succeeds when another org owns the same key", async () => {
    await repo.upsertByKey({ org: orgA, ...connectorA_orgA, key: "contacts" });
    const row = await repo.upsertByKey({ org: orgB, ...connectorA_orgB, key: "contacts" });
    expect(row.organizationId).toBe(orgB);
  });

  it("can create a new entity for a key whose prior owner is soft-deleted", async () => {
    const a = await repo.upsertByKey({ ...baseA, key: "contacts" });
    await repo.softDelete(a.id);
    const b = await repo.upsertByKey({ ...baseB, key: "contacts" });
    expect(b.id).not.toBe(a.id);
  });
});
```

Run: `npm --workspace apps/api run test:integration -- connector-entities.repository`.
Expect failures on the second case (the ON CONFLICT target no longer
matches, so the DB throws a raw unique-violation instead of the
typed `ApiError`).

### D2. Green — rewrite `upsertByKey`

**File**:
`apps/api/src/db/repositories/connector-entities.repository.ts`.

Replace the `ON CONFLICT` path with a pre-select:

```ts
async upsertByKey(data: ConnectorEntityInsert, client: DbClient = db) {
  const [existing] = await (client as typeof db)
    .select()
    .from(connectorEntities)
    .where(and(
      eq(connectorEntities.organizationId, data.organizationId),
      eq(connectorEntities.key, data.key),
      isNull(connectorEntities.deleted),
    ))
    .limit(1);

  if (!existing) {
    const [row] = await (client as typeof db).insert(this.table).values(data as never).returning();
    return row as ConnectorEntitySelect;
  }

  if (existing.connectorInstanceId !== data.connectorInstanceId) {
    throw new ApiError(
      400,
      ApiCode.CONNECTOR_ENTITY_KEY_IN_USE_BY_OTHER_CONNECTOR,
      `Entity key "${data.key}" is already used by connector "${existing.connectorInstanceId}" in this org.`,
      { conflictingConnectorInstanceId: existing.connectorInstanceId }
    );
  }

  const [updated] = await (client as typeof db)
    .update(this.table)
    .set({ label: data.label, updated: data.updated ?? Date.now(), updatedBy: data.updatedBy } as never)
    .where(eq(connectorEntities.id, existing.id))
    .returning();
  return updated as ConnectorEntitySelect;
}
```

The pre-select + conditional path removes the need for drizzle's
`onConflictDoUpdate` target list, which is now moot (the conflict
target is `(organization_id, key)`, not
`(connector_instance_id, key)`, so the repo logic cannot be expressed
as a single ON CONFLICT clause anyway — the cross-connector case is
a hard error, not an update).

Run D1 again — green. Then:

```
npm --workspace apps/api run test:integration
npm --workspace apps/api run test:unit
```

### D3. Refactor

- Pull the pre-select into a small `findLiveByOrgKey` helper if the
  method grows; otherwise leave it inline.
- The caller in `layout-plan-commit.service.ts` already lets
  repository errors bubble; no change required there, but add a
  comment near the `upsertByKey` call noting that C2 can surface a
  400 from this path.

---

## Phase E — Reference resolution (doc-only refactor)

### E1. Red — reference integration test (confirms behavior doesn't regress)

**File**:
`apps/api/src/__tests__/__integration__/services/field-mappings/reconcile.integration.test.ts`
(extend).

```ts
describe("reconcileFieldMappings — C2 cross-connector references", () => {
  it("resolves refEntityKey to an entity owned by a different connector in the same org", async () => {
    // Seed connector A with entity "customers" + a normalizedKey "id".
    // Build a plan for connector B that references "customers" / "id".
    // Commit succeeds; no LAYOUT_PLAN_INVALID_REFERENCE.
  });

  it("still errors LAYOUT_PLAN_INVALID_REFERENCE when the key doesn't exist anywhere in the org", async () => {
    // Regression — unchanged from pre-C2.
  });
});
```

Run: `npm --workspace apps/api run test:integration -- reconcile`.
The first case should already pass (the existing implementation does
an org-scoped lookup). The second case should also pass. Include
both so the PR demonstrates the C2 semantic is covered by tests.

### E2. Refactor — drop ambiguity comments

**File**: `apps/api/src/services/field-mappings/reconcile.ts`.

Inside `lookupDbEntityNormalizedKeys`:

- The `.limit(1)` is now semantically redundant (the index
  guarantees one match). Leave the `.limit(1)` in as a cheap
  defense-in-depth, but update the surrounding comment to:

  > Under C2 `(organization_id, key)` is unique, so at most one
  > entity matches; `.limit(1)` is a belt-and-braces guard.

- If any "first-row-wins" commentary is present in surrounding code
  (the spec mentions it), delete it.

No behavioral change — this phase ships docs + belt-and-braces.

---

## Phase F — API: search endpoint includes `connectorInstanceName`

### F1. Red — router integration test

**File**:
`apps/api/src/__tests__/__integration__/routes/connector-entities.router.integration.test.ts`
(extend or create).

```ts
describe("GET /api/connector-entities?include=connectorInstance", () => {
  it("returns each entity with its owning connectorInstance's name", async () => {
    // Seed two connectors with distinct names; seed one entity under each.
    const res = await request(app)
      .get("/api/connector-entities?include=connectorInstance")
      .set("Authorization", "Bearer test-token");
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(
      res.body.payload.connectorEntities.map((e) => [e.key, e])
    );
    expect(byKey["contacts"].connectorInstance.name).toBe("CRM Export");
  });
});
```

Run the relevant integration suite. Expect failure — `include`
probably doesn't support `connectorInstance` yet.

### F2. Green — add the include join

**File**: `apps/api/src/routes/connector-entity.router.ts` (+
`connector-entities.repository.ts` if the join lives at the repo
layer). Follow the
`connector-instances.router.ts` / `connector-instances.repository.ts`
precedent for `include=definition`.

- Add `"connectorInstance"` to the accepted include set.
- In the repository's `findMany`, extend the existing `include`
  handler with a LEFT JOIN to `connectorInstances` that selects
  `id` + `name` on hit and nests them under
  `connectorInstance: { id, name }` on the returned rows.
- Update the response payload contract in
  `packages/core/src/contracts/connector-entities.contract.ts` so the
  optional `connectorInstance` field is typed.

Run F1 again — green.

### F3. Frontend SDK surface

**File**: `apps/web/src/api/connector-entities.api.ts`.

- The bespoke search hook (label-map cache) builds its payload from
  the list endpoint. Include `connectorInstance` in its call so the
  returned labels can carry the connector name.
- Extend `labelMap` shape (or add a `metaMap`) so consumers can read
  the connector name without re-fetching.

If the SDK endpoint is already a typed `useAuthQuery`, the only
change is adding `include: "connectorInstance"` to its default query
key. If it's the hand-rolled label-map wrapper, follow
`feedback_sdk_helpers_for_api` — don't regress into a raw
`useAuthFetch`; keep it within the established pattern.

### F4. Refactor

- If the API side needs a tiny helper to shape the nested response,
  place it alongside the repository's other join helpers.
- Audit existing consumers of the search endpoint — ensure none break
  because their `EntityOption` type grew an optional field.

---

## Phase G — Frontend: picker option label includes connector name

### G1. Red — panel test

**File**:
`apps/web/src/modules/RegionEditor/__tests__/RegionConfigurationPanel.test.tsx`.

```ts
describe("RegionConfigurationPanel — C2 picker labels", () => {
  test("DB-backed options render as '<label> — <connectorInstanceName>'", () => {
    const options: EntityOption[] = [
      { value: "ent_a", label: "Contact", source: "db", connectorInstanceName: "CRM Export" },
    ];
    render(<RegionConfigurationPanelUI {...baseProps} entityOptions={options} />);
    openPicker();
    expect(screen.getByRole("option", { name: /Contact\s+—\s+CRM Export/ }))
      .toBeInTheDocument();
  });

  test("staged (this-import) options are unaffected by the connector suffix", () => {
    const options: EntityOption[] = [
      { value: "ent_draft", label: "Lead", source: "staged" },
    ];
    render(<RegionConfigurationPanelUI {...baseProps} entityOptions={options} />);
    openPicker();
    expect(screen.getByRole("option", { name: /Lead\s+—\s+new/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /CRM Export/ })).toBeNull();
  });
});
```

Run: `npm --workspace apps/web run test:unit -- RegionConfigurationPanel`.
Expect failure — `EntityOption` doesn't carry
`connectorInstanceName` yet.

### G2. Green — extend `EntityOption` + `buildSelectOptions`

**Files**:

- `apps/web/src/modules/RegionEditor/utils/region-editor.types.ts` —
  add optional `connectorInstanceName?: string` to `EntityOption`.
- `apps/web/src/modules/RegionEditor/RegionConfigurationPanel.component.tsx`
  — extend `buildSelectOptions`:

  ```ts
  if (o.source === "staged") return { ..., label: `${o.label} — new` };
  if (o.connectorInstanceName) return { ..., label: `${o.label} — ${o.connectorInstanceName}` };
  return { ..., label: o.label };
  ```

### G3. Container wiring

**File**:
`apps/web/src/workflows/FileUploadConnector/utils/layout-plan-mapping.util.ts`
(or wherever `entityOptionsFromWorkbook` / the DB-catalog projection
lives).

- Thread `connectorInstanceName` from the list endpoint's response
  (F2) into the `EntityOption.connectorInstanceName` field.
- Staged options (from the in-memory new-entity state) leave the
  field undefined.

Run G1 again — green. Then the full RegionEditor + FileUpload suites
to catch labelled snapshots / fixtures:

```
npm --workspace apps/web run test:unit -- modules/RegionEditor
npm --workspace apps/web run test:unit -- workflows/FileUploadConnector
```

### G4. Refactor

- If a story fixture hard-codes `source: "db"` without a connector
  name, add one — the Storybook stories shouldn't be misleading after
  C2.

---

## Phase H — Frontend: NewEntityDialog key-collision pre-check

### H1. Red — dialog test

**File**:
`apps/web/src/modules/RegionEditor/__tests__/NewEntityDialog.test.tsx`
(extend).

```ts
describe("NewEntityDialogUI — C2 org-wide key pre-check", () => {
  test("shows an inline error + blocks submit when the chosen key is already owned by another connector", async () => {
    const onSubmit = jest.fn();
    const validateKey = jest.fn(async (k: string) =>
      k === "contacts"
        ? { ok: false, ownedBy: "CRM Export" }
        : { ok: true }
    );
    render(
      <NewEntityDialogUI
        open
        onClose={jest.fn()}
        onSubmit={onSubmit}
        existingKeys={[]}
        validateKey={validateKey}
      />
    );
    await user.type(screen.getByLabelText(/key/i), "contacts");
    await user.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/already used by CRM Export/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("submit proceeds when the async check resolves ok", async () => {
    const onSubmit = jest.fn();
    render(
      <NewEntityDialogUI
        open
        onClose={jest.fn()}
        onSubmit={onSubmit}
        existingKeys={[]}
        validateKey={async () => ({ ok: true })}
      />
    );
    await user.type(screen.getByLabelText(/label/i), "Accounts");
    await user.click(screen.getByRole("button", { name: /create/i }));
    expect(onSubmit).toHaveBeenCalledWith("accounts", "Accounts");
  });
});
```

Run: `npm --workspace apps/web run test:unit -- NewEntityDialog`.
Expect failure — the dialog doesn't accept `validateKey` yet.

### H2. Green — plumb `validateKey`

**Files**:

- `apps/web/src/modules/RegionEditor/NewEntityDialog.component.tsx`
  — add an optional async prop:

  ```ts
  validateKey?: (key: string) => Promise<
    | { ok: true }
    | { ok: false; ownedBy?: string }
  >;
  ```

  On submit, after the Zod synchronous check passes, await
  `validateKey(key)`. On `{ ok: false }`, set an error on the `key`
  field with the message
  `` `Key is already used by ${res.ownedBy ?? "another connector"} in this org.` ``
  and return without calling `onSubmit`.

- `apps/web/src/modules/RegionEditor/RegionConfigurationPanel.component.tsx`
  — widen the `onCreateEntity` contract (or add a parallel
  `validateEntityKey` prop) so the container can feed an async
  validator down. Keep it optional so existing consumers don't break.

### H3. Container wiring

**File**:
`apps/web/src/workflows/FileUploadConnector/FileUploadConnectorWorkflow.component.tsx`.

Implement `validateEntityKey` using the same `sdk.connectorEntities`
surface as the picker label map (F3):

```ts
const validateEntityKey = useCallback(async (key: string) => {
  // Search for exact-key match across the org.
  const results = await sdk.connectorEntities.search.onSearch(key);
  const exact = results.find((r) => r.value === key);
  if (!exact) return { ok: true as const };
  return { ok: false as const, ownedBy: exact.connectorInstanceName };
}, [sdk.connectorEntities]);
```

Pass it through the panel → dialog chain.

Run H1 again — green.

### H4. Refactor

- Debounce or memoise the async validator if test traces show it
  firing on every keystroke — a single check on submit is enough; no
  need to block typing.

---

## Phase I — Documentation

### I1. Update the architecture spec

**File**: `docs/SPREADSHEET_PARSING.architecture.spec.md`.

Add a short subsection after § "Region → entity 1:1 mapping"
(written by C1) titled "Entity key — org-wide uniqueness". Content
sketch:

> **`ConnectorEntity.key` is unique per organization** (enforced by
> `UNIQUE(organization_id, key) WHERE deleted IS NULL`). Each
> connector still owns its own entities; the constraint is a
> lookup-space guarantee so that any `FieldMapping.refEntityKey`
> resolves to exactly one entity org-wide. Commit-time collisions
> surface as `CONNECTOR_ENTITY_KEY_IN_USE_BY_OTHER_CONNECTOR`.

### I2. Update the discovery doc's specs table

(`docs/REGION_CONFIG_FLEXIBILITY.discovery.md` already references
the C1 and C2 specs — no change needed unless the table is stale.)

---

## Phase J — Full-suite verification

Run, in order:

```
npm run type-check
npm --workspace packages/spreadsheet-parsing run test
npm --workspace apps/api run test:unit
npm --workspace apps/api run test:integration
npm --workspace apps/web run test:unit
```

All should be green. If any suite turned up a regression that isn't
C2-specific (e.g. a fixture that seeded two entities with the same
key across connectors), treat it as a migration task: update the
fixture to use distinct keys, note the update in the PR body.

---

## Phase K — Pre-deploy rollout (support-led)

Per the spec's rollout order, these steps happen **outside the PR**
— list them in the PR body as the deploy checklist:

1. Merge and deploy **just** the audit script (Phase B) on its own
   or as part of this PR that ships behind a deploy guard.
2. Run `npm --workspace apps/api run audit:entity-keys` against
   staging and prod. Forward the output to Support.
3. Support contacts any affected orgs, chooses a renaming
   convention, and issues manual `UPDATE connector_entities SET key
   = ...` statements under the old uniqueness constraint.
4. Re-run the audit until it returns empty.
5. Apply the migration + ship the repo/service/frontend changes.

If the dry-run audit surfaces conflicts on the target deploy, the
migration must not run. The migration's own `CREATE UNIQUE INDEX`
will fail in that case — a safety net, not a substitute for the
audit.

---

## Phase L — Manual smoke test

Optional but recommended before merging:

1. `npm run dev`. Log in to an org with at least two connectors.
2. Create a first connector with an entity keyed `contacts`. Commit.
3. Start a second file upload. Draw a region, bind to a *new* entity
   keyed `contacts` via the "+ Create new entity" dialog —
   confirm the dialog surfaces the collision inline and blocks
   Create. Connector name appears in the error.
4. Rename the new key to `prospects`; confirm Create succeeds.
5. In the second connector's region editor, open the Target entity
   picker; confirm the DB-backed `contacts` option shows
   `Contact — <first-connector-name>` as its label.
6. Bind a reference field's `refEntityKey` to `contacts`; interpret
   and commit; confirm the reference resolves to the entity owned by
   the first connector.

---

## Commit / PR checklist

- [ ] A1 API code registered
- [ ] B1–B3 audit script + integration test + npm script wired
- [ ] C1–C3 schema change + generated migration + SQL reviewed
- [ ] D1–D3 `upsertByKey` tests + rewrite
- [ ] E1–E2 reference-resolution integration tests + comment cleanup
- [ ] F1–F4 API `include=connectorInstance` end-to-end
- [ ] G1–G4 picker label shows connector name
- [ ] H1–H4 NewEntityDialog async key validation
- [ ] I1 architecture-spec addendum
- [ ] Full suite green
- [ ] Audit script run against staging + prod (Phase K)
- [ ] Manual smoke done
- [ ] PR description notes: "Implements
  `REGION_CONFIG.c2_org_unique_entity_key.spec.md`. Org-wide
  `(organization_id, key)` uniqueness; surfaces
  `CONNECTOR_ENTITY_KEY_IN_USE_BY_OTHER_CONNECTOR` on commit and
  blocks duplicate-key creation in the editor. One-way migration
  gated on the audit script returning empty."
