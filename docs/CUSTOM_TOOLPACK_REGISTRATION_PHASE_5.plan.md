# Custom Toolpack Registration — Phase 5 — Plan

**TDD-sequenced implementation of encryption-at-rest for `organization_toolpacks.auth_headers`.**

Spec: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_5.spec.md`. Phase 1: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_1.{spec,plan}.md`. Phase 2: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_2.{spec,plan}.md`. Phase 3: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_3.{spec,plan}.md`. Phase 4: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_4.{spec,plan}.md`.

Phase 5 is mechanical because every primitive already exists: `crypto.util.ts` provides AES-256-GCM round-trip; `connector-instances.repository.ts` demonstrates the transparent encrypt-on-write / decrypt-on-read repository pattern; the integration test harness already sets `ENCRYPTION_KEY` (`__tests__/__integration__/setup.ts:38`). The work is one PR with three slices: migration → repository → route regression assertion.

Run tests with the project's npm scripts (per `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
```

Migration commands (per `apps/api/README.md`):

```bash
cd apps/api && npm run db:generate -- --name encrypt_toolpack_auth_headers
cd apps/api && npm run db:migrate
```

---

## Slice 1 — Migration + table type change

Drop pre-existing values (P-5.1) and change the column type so the rest of the slices have something to encrypt into.

**Files**

- New: `apps/api/src/db/migrations/<timestamp>_encrypt_toolpack_auth_headers.sql` (auto-generated; verify and hand-edit the body if drizzle-kit emits a different operator order — see step 2).
- Edit: `apps/api/src/db/schema/organization-toolpacks.table.ts` — `jsonb` → `text` on `authHeaders`; comment block updated.
- Edit: `apps/api/src/db/schema/type-checks.ts` — rename `_OrgToolpackJsonbCols` → `_OrgToolpackOpaqueCols`; comment refreshed.

**Steps**

1. **Edit the table.** Change the column declaration in `organization-toolpacks.table.ts`:

   ```diff
   -    authHeaders: jsonb("auth_headers").$type<Record<string, string> | null>(),
   +    authHeaders: text("auth_headers"),
   ```

   Drop the unused `jsonb` import only if it's no longer used elsewhere in the file (it is — `endpoints`, `tools`, `metadata` still need it).

   Update the file-top comment block to describe the new shape (see spec § "Drizzle table" for the prose).

2. **Generate the migration.**

   ```bash
   cd apps/api && npm run db:generate -- --name encrypt_toolpack_auth_headers
   ```

   Inspect the generated SQL. drizzle-kit will emit `ALTER COLUMN ... SET DATA TYPE text USING auth_headers::text` by default — that is *not* what we want, because `auth_headers::text` would cast the existing jsonb to a string representation (e.g. `'{"Authorization":"Bearer xyz"}'`) which is **plaintext leaked into the new text column**.

   Hand-edit the migration body to:

   ```sql
   UPDATE organization_toolpacks SET auth_headers = NULL;
   ALTER TABLE organization_toolpacks
     ALTER COLUMN auth_headers TYPE text USING NULL;
   ```

   The `UPDATE … SET … = NULL` runs first so the column is empty before the type cast. The `USING NULL` clause is belt-and-braces against any concurrent-insert race during deploy.

3. **Update type-checks.** In `db/schema/type-checks.ts:455-459`:

   ```diff
   -type _OrgToolpackJsonbCols =
   +type _OrgToolpackOpaqueCols =
        | "endpoints"
        | "authHeaders"
        | "tools"
        | "metadata";
   ```

   And rename the use-site:

   ```diff
   -type _OrgToolpackDrizzleToModel = IsAssignable<
   -  Omit<OrganizationToolpackSelect, _OrgToolpackJsonbCols>,
   -  Omit<OrganizationToolpack, _OrgToolpackJsonbCols>
   +type _OrgToolpackDrizzleToModel = IsAssignable<
   +  Omit<OrganizationToolpackSelect, _OrgToolpackOpaqueCols>,
   +  Omit<OrganizationToolpack, _OrgToolpackOpaqueCols>
   >;
   ```

   Update the preceding comment block to mention that `auth_headers` is now an encrypted text blob at the table layer (see spec § "Type-check update").

4. **Apply locally and verify.**

   ```bash
   cd apps/api && npm run db:migrate
   ```

   Open Drizzle Studio (`npm run db:studio`); the `auth_headers` column on `organization_toolpacks` is `text`, nullable.

5. **Run the existing integration tests against an empty `auth_headers` column.**

   ```bash
   cd apps/api && npm run test:integration -- organization-toolpacks
   ```

   Every existing toolpack integration test that sets `authHeaders` will fail at this point because the table column now expects `string` but the repository still hands it a `Record`. That's expected — slice 2 fixes it. Confirm the failure shape is "type mismatch on insert", not something unrelated.

6. **Type-check.** `npm run type-check` from the repo root. Any caller still typing `authHeaders` as `Record<string, string> | null` against the inferred-row type fails — those are exactly the call sites slice 2 keeps passing by overriding the repository return type. Catalog the failures, but do not fix them yet.

**Done when:** the migration applies cleanly to a fresh DB; the table type is `text NULL`; type-check failures are confined to the repository file plus its integration tests (the spec's "no-change surface" should already type-check because those callers see the *repository's* widened return type, not the inferred row type).

**Risk:** drizzle-kit's default `USING auth_headers::text` cast would publish every existing plaintext map to the new column and persist it permanently. Step 2's hand-edit is the load-bearing safety. **Verify the SQL by reading the file before running `db:migrate`** — if `USING auth_headers::text` made it into the file, plaintext is now in the text column and a re-migration won't undo it.

---

## Slice 2 — Repository transparent encryption

The core of phase 5 — wire `encryptCredentials` / `decryptCredentials` into `OrganizationToolpacksRepository` so callers continue to see the plaintext map.

**Files**

- Edit: `apps/api/src/db/repositories/organization-toolpacks.repository.ts` — add helpers; override base methods; thread decrypt through bespoke finders.
- Edit: `apps/api/src/__tests__/__integration__/db/repositories/organization-toolpacks.repository.integration.test.ts` — cases 130–134.

**Steps**

1. **Write the failing tests (cases 130–134).** Place them in a new `describe("authHeaders encryption", () => {...})` block at the bottom of the existing integration test file, after the existing tests. Each builds on the existing `beforeEach` org/user fixture.

   Use raw drizzle to query the column directly when asserting on-disk shape:

   ```ts
   const rawRow = await (db as ReturnType<typeof drizzle>)
     .select({ authHeaders: schema.organizationToolpacks.authHeaders })
     .from(schema.organizationToolpacks)
     .where(eq(schema.organizationToolpacks.id, id))
     .limit(1);
   ```

   - **Case 130** — `create` encrypts before insert. Insert `{ authHeaders: { Authorization: "Bearer abc123" } }` via `repo.create(...)`. Two assertions:

     ```ts
     // (a) raw column is opaque
     expect(typeof rawRow[0].authHeaders).toBe("string");
     expect(rawRow[0].authHeaders).not.toContain("abc123");
     expect(rawRow[0].authHeaders).not.toContain("Bearer");
     const payload = JSON.parse(rawRow[0].authHeaders!);
     expect(payload).toEqual(expect.objectContaining({
       iv: expect.any(String),
       authTag: expect.any(String),
       data: expect.any(String),
       v: 1,
     }));

     // (b) repository return is decrypted
     expect(returned.authHeaders).toEqual({ Authorization: "Bearer abc123" });
     ```

   - **Case 131** — `findByIdScoped` decrypts on read. Given the row from case 130, `repo.findByIdScoped(id, orgId)` returns `authHeaders: { Authorization: "Bearer abc123" }`.

   - **Case 132** — `findByOrganizationId` decrypts every row. Insert two rows, one with `authHeaders: { X-Api-Key: "k1" }` and one with `authHeaders: null`. Call `repo.findByOrganizationId(orgId)`; the returned array contains both rows in their respective shapes (sort by `created` for stability).

   - **Case 133** — partial update preserves on no-touch and re-encrypts on touch. Two sub-assertions in one case:
     1. Insert with `authHeaders: { X-Api-Key: "k1" }`. Capture the raw blob via direct query. Call `repo.update(id, { name: "renamed" })`. Re-query the raw blob; it is byte-equal to the original (no re-encryption when the field isn't in the update payload). The IV is identical → confirms the encryption layer skipped the column.
     2. Call `repo.update(id, { authHeaders: { X-Api-Key: "k2" } })`. Re-query the raw blob; it differs from the prior blob (fresh IV + ciphertext) **and** decrypts (via `repo.findByIdScoped`) to the new map.

   - **Case 134** — `null` round-trip. `repo.create({ ..., authHeaders: null })` stores `auth_headers IS NULL` (`expect(rawRow[0].authHeaders).toBeNull()`); `findByIdScoped` returns `authHeaders: null`. Critically: `encryptCredentials` is **not** called on this path. Verify by spying via `jest.spyOn` on the imported function (or, simpler, by relying on the null-check branch in `encryptInsert` — the spec already specifies the helper's null-skip).

   Run the focused suite — all five fail because the repository hasn't been edited yet:

   ```bash
   cd apps/api && npm run test:integration -- organization-toolpacks
   ```

2. **Author the helpers.** Add at the top of the repository file, above the class:

   ```ts
   import {
     encryptCredentials,
     decryptCredentials,
   } from "../../utils/crypto.util.js";

   /** Decrypt the `authHeaders` column of a single row (if present). */
   function decryptRow<T extends { authHeaders: string | null }>(
     row: T
   ): T & { authHeaders: Record<string, string> | null } {
     return {
       ...row,
       authHeaders: row.authHeaders
         ? (decryptCredentials(row.authHeaders) as Record<string, string>)
         : null,
     };
   }

   /** Decrypt authHeaders on an array of rows. */
   function decryptRows<T extends { authHeaders: string | null }>(
     rows: T[]
   ): (T & { authHeaders: Record<string, string> | null })[] {
     return rows.map(decryptRow);
   }

   /** Encrypt a plaintext authHeaders map into the format stored in the DB. */
   function encryptInsert<
     T extends { authHeaders?: Record<string, string> | string | null }
   >(data: T): T {
     if (data.authHeaders != null && typeof data.authHeaders === "object") {
       return {
         ...data,
         authHeaders: encryptCredentials(
           data.authHeaders as Record<string, unknown>
         ),
       } as T;
     }
     return data;
   }
   ```

   The shape mirrors `connector-instances.repository.ts:46-73` exactly with `credentials` substituted for `authHeaders`.

3. **Add the five base-class overrides.** Inside the class, before the bespoke finders:

   ```ts
   override async findById(
     id: string,
     client: DbClient = db
   ): Promise<OrganizationToolpackSelect | undefined> {
     const row = await super.findById(id, client);
     return row ? decryptRow(row) : undefined;
   }

   override async findMany(
     where?: SQL,
     opts: ListOptions = {},
     client: DbClient = db
   ): Promise<OrganizationToolpackSelect[]> {
     const rows = await super.findMany(where, opts, client);
     return decryptRows(rows);
   }

   override async create(
     data: OrganizationToolpackInsert,
     client: DbClient = db
   ): Promise<OrganizationToolpackSelect> {
     const row = await super.create(encryptInsert(data), client);
     return decryptRow(row);
   }

   override async update(
     id: string,
     data: Partial<OrganizationToolpackInsert>,
     client: DbClient = db
   ): Promise<OrganizationToolpackSelect | undefined> {
     const row = await super.update(id, encryptInsert(data), client);
     return row ? decryptRow(row) : undefined;
   }

   override async upsert(
     data: OrganizationToolpackInsert,
     client: DbClient = db
   ): Promise<OrganizationToolpackSelect> {
     const row = await super.upsert(encryptInsert(data), client);
     return decryptRow(row);
   }
   ```

   Add `SQL` import from `drizzle-orm` if not already present.

4. **Thread decrypt through the bespoke finders.** The three existing methods on this class — `findByOrganizationId`, `findManyByIds`, `findByIdScoped` — currently return raw rows. Wrap each return with `decryptRow{s}`:

   ```diff
    async findByOrganizationId(
      organizationId: string,
      client: DbClient = db
    ): Promise<OrganizationToolpackSelect[]> {
   -  return (await (client as typeof db) … ) as OrganizationToolpackSelect[];
   +  const rows = (await (client as typeof db) … ) as OrganizationToolpackSelect[];
   +  return decryptRows(rows);
    }
   ```

   Same shape for `findManyByIds` (decryptRows) and `findByIdScoped` (decryptRow on the single row, with the existing `undefined` short-circuit preserved).

5. **Run the focused suite.** Cases 130–134 green:

   ```bash
   cd apps/api && npm run test:integration -- organization-toolpacks
   ```

6. **Run the full toolpack integration suite.** Pre-existing tests must stay green:

   ```bash
   cd apps/api && npm run test:integration -- toolpack
   ```

   Any failure here indicates a missed finder. The full surface is the five base-class overrides plus the three bespoke methods enumerated in step 4 — eight call sites total.

7. **Lint + type-check.**

   ```bash
   npm run lint && npm run type-check
   ```

   The slice-1 type-check failures should now resolve because the repository return type widens `authHeaders` back to `Record<string, string> | null`.

**Done when:** cases 130–134 pass; existing `organization-toolpacks.repository.integration.test.ts` cases stay green; type-check + lint clean.

**Risk:** the `encryptInsert` helper's input type (`Record<string, string> | string | null`) intentionally accepts `string` so partial updates that omit `authHeaders` typecheck cleanly — drizzle's `Partial<Insert>` allows missing fields, and the helper's `data.authHeaders != null && typeof === "object"` guard preserves the encrypted blob from prior writes by simply not touching the field. Verify case 133's "no-touch preserves byte-equality" assertion catches any drift here.

---

## Slice 3 — End-to-end route regression

Confirm the public API contract is unchanged after the encryption seam lands. This slice adds one integration test and changes nothing else.

**Files**

- Edit: `apps/api/src/__tests__/__integration__/routes/toolpacks.router.integration.test.ts` — case 135.

**Steps**

1. **Write case 135.** In a new sub-block (e.g. `describe("authHeaders never leak through the API", () => {...})`):

   - `POST /api/toolpacks` with body `{ name, endpoints: { schema, runtime }, authHeaders: { Authorization: "Bearer secret-token-xyz" } }` (use the existing mock toolpack server at `localhost:4100` if the test fixture runs it; otherwise stub `fetch` per the existing register-route test setup).
   - Assert the response body contains `authHeadersStatus: { has: true }` and **does not** contain the substring `"secret-token-xyz"` anywhere (use `JSON.stringify(response.body)` and `.not.toContain`).
   - `GET /api/toolpacks/:id` for the new row. Same assertions on the response body.
   - Raw-DB query of `auth_headers`: assert it is a `string`, parses as the encrypted-payload envelope (`iv`/`authTag`/`data`/`v`), and does not contain `"secret-token-xyz"`.

2. **Run the focused suite.** `cd apps/api && npm run test:integration -- toolpacks.router`.

3. **Run the full API integration + unit suites.** Both stay green:

   ```bash
   cd apps/api && npm run test:integration
   cd apps/api && npm run test:unit
   ```

4. **Manual smoke (dev environment).**
   - `npm run dev` (web + api).
   - Run the mock toolpack server: `cd apps/api && npm run mock-toolpack`.
   - Register a toolpack via the UI with `Authorization: Bearer dev-token-test` in the auth-headers field.
   - Open Drizzle Studio (`cd apps/api && npm run db:studio`); navigate to `organization_toolpacks`; confirm `auth_headers` is an opaque string and does not contain `"dev-token-test"`.
   - From a portal session, invoke a tool from the registered pack; confirm the runtime call still succeeds (the repository decrypted the headers for `tools.service`).

**Done when:** case 135 passes; full integration suite green; manual smoke confirms no plaintext leak in DB and runtime calls still work end-to-end.

**Risk:** the `.not.toContain("secret-token-xyz")` assertion on `JSON.stringify(response.body)` is the load-bearing redaction guard. If a future refactor of `toCustomApiRecord` accidentally widens the response shape (e.g. returning the decrypted map instead of the `{has}` marker), this test catches it. The token string is intentionally distinctive so a substring match is unambiguous.

---

## Sequence summary

| Slice | What lands | Tests added | Test commands |
|---|---|---|---|
| 1 | Migration + table type change + type-checks | 0 (existing tests fail at this checkpoint, by design) | `cd apps/api && npm run db:migrate && npm run test:integration -- organization-toolpacks` |
| 2 | Repository transparent encryption | 5 (130–134) | `cd apps/api && npm run test:integration -- organization-toolpacks` |
| 3 | End-to-end route regression | 1 (135) | `cd apps/api && npm run test:integration` |

Total **6 new test cases**, single PR, ~3 hours of work.

---

## Cross-slice notes

- **One PR.** The three slices land together. Slice 1 deliberately leaves the repo in a broken state; slice 2 fixes it. There's no value in shipping slice 1 alone.

- **Zero new dependencies.** `crypto.util.ts` and the encryption helpers already exist; integration setup already provides `ENCRYPTION_KEY` (`__tests__/__integration__/setup.ts:38`). No new env var, no new package.

- **No frontend, core, or routes changes.** Phase 5 is purely an `apps/api` storage-layer concern. Verified by the spec's "no-change surface" enumeration — confirm by inspection during code review rather than running the web suite.

- **Migration is destructive (P-5.1).** Pre-existing rows lose their auth headers. Org admins re-enter via `EditToolpackDialog`. The migration's `UPDATE … SET auth_headers = NULL` runs first to make this explicit; the type-cast can't fall back to a plaintext `::text` cast because the values are already null at that point.

- **Drizzle-kit pitfall.** The default generated SQL would emit `USING auth_headers::text`, which casts the existing jsonb to its plaintext string representation. **Hand-edit the generated migration** — slice 1 step 2 calls this out explicitly. A code-review check on the migration file is worth the 30 seconds.

- **Loss of `ENCRYPTION_KEY` is a hard failure.** Same operational risk as connector credentials. If the key is rotated without a re-key step, every existing `auth_headers` row becomes undecryptable; org admins must re-enter. P-5.2 defers the rotation surface; the `v: 1` field on every payload preserves the option without committing the work.

- **CLAUDE.md compliance.** New helpers in the repository file follow the suffix convention (`*.repository.ts`). The dual-schema dance (model in `@portalai/core` describes plaintext, table column holds ciphertext, type-check skips the mismatch) mirrors what `connector_instances.credentials` already does — same precedent, same justification.

- **What we're not doing.** No outbound request signing. No SSRF filtering. No replay timestamps. No runtime-response size cap. No TLS pinning. No audit log of credential usage. No envelope encryption / KMS / per-org keys. No key rotation runbook. Each was called out in the security audit; each is its own follow-up. Phase 5 is the encryption-at-rest gap, period.
