# Custom Toolpack Registration — Phase 5 — Spec

**Encrypt `organization_toolpacks.authHeaders` at rest using the existing AES-256-GCM crypto utility.** Today the column is a plain `jsonb` storing user-supplied auth tokens (Bearer, API keys, Basic, etc.) verbatim — visible in DB dumps, replicas, backups, and to anyone with read access on the database role. Phase 5 closes that gap with a repository-level transparent encrypt/decrypt mirror of the pattern already in place for `connector_instances.credentials`.

Discovery: `docs/CUSTOM_TOOLPACK_REGISTRATION.discovery.md`. Phase 1: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_1.{spec,plan}.md`. Phase 2: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_2.{spec,plan}.md`. Phase 3: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_3.{spec,plan}.md`. Phase 4: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_4.{spec,plan}.md`.

After phase 4: collisions surface in the station-edit dialog. The custom-toolpack feature is feature-complete — register, refresh, edit, delete, attach to stations, warn about collisions. The remaining seam is operational/security: every auth header an org admin types into `RegisterToolpackDialog` lands in PostgreSQL as plaintext. A security audit of phase 4 ranked this the single highest-leverage gap (encryption-at-rest absent despite an `ENCRYPTION_KEY` env var already wired up for connector credentials).

The fix is mechanical because the precedent exists:

- `apps/api/src/utils/crypto.util.ts` already exposes `encryptCredentials()` / `decryptCredentials()` — AES-256-GCM with random IV per record, GCM auth tag, base64-encoded payload, and a `v: 1` key-version field for future rotation.
- `apps/api/src/db/repositories/connector-instances.repository.ts` already demonstrates the transparent-encryption repository pattern — overrides `findById` / `findMany` / `create` / `update` / `upsert` to encrypt on write and decrypt on read, so callers see plaintext and never call `encrypt*`/`decrypt*` themselves.

Phase 5 applies that same pattern to `OrganizationToolpacksRepository`. No new utilities, no key-management surface, no API contract change.

Resolved decision points specific to phase 5:

- **P-5.1 (migration approach):** drop the column and force re-registration of any existing rows. Phase 1–4 just merged and the feature has no meaningful production footprint yet; an in-place backfill (read → encrypt → write) would be more code than the data warrants. The migration nulls out `auth_headers`, drops the old `jsonb` column, and adds a new `text` column; org admins re-enter headers via the existing `EditToolpackDialog`. The pre-existing schema/runtime/metadata endpoints continue to work unauthenticated until the admin edits the pack — no functional regression for packs that didn't use auth headers in the first place.
- **P-5.2 (key rotation surface):** out of scope. `crypto.util.ts` writes `v: 1` into every payload so a future rotation is a code change at decrypt time (read `v`, route to the right key) rather than a data migration. Adding a registry of active keys, a re-key job, or a rotation runbook is a separate effort; phase 5 doesn't preempt it.
- **P-5.3 (column shape):** change `auth_headers` from `jsonb` to `text` (rather than store the encrypted blob inside a `jsonb`). Connector credentials already use `text`; consistency wins. The column holds an opaque base64-ish JSON string emitted by `encryptCredentials()` — Postgres has no reason to introspect it.
- **P-5.4 (model / contract):** the `OrganizationToolpack` Zod model in `@portalai/core` continues to type `authHeaders` as `Record<string, string> | null`. Encryption is a storage concern; every consumer of the repository (routes, `tools.service`, the `register-toolpack` flow, the refresh path) keeps seeing plaintext. The drizzle-zod inferred row type widens to `string | null`, and the type-check assertions in `db/schema/type-checks.ts` are updated to skip `authHeaders` from the drizzle→model cross-check (same way `endpoints` / `tools` / `metadata` are already skipped, and same way `credentials` is handled for `connector_instances`).

After this phase: the only place plaintext auth headers exist is (a) in flight on the wire to the toolpack endpoint at runtime/refresh time, and (b) in the request body during `POST /api/toolpacks` / `PATCH /api/toolpacks/:id`. The DB row, replicas, `pg_dump` output, Drizzle Studio, and any future warehouse export hold only the encrypted blob. Loss of `ENCRYPTION_KEY` makes every existing toolpack header undecryptable (admins must re-enter), which is the right failure mode.

---

## Scope

### In scope

1. **Schema migration** — change `organization_toolpacks.auth_headers` from `jsonb` to `text`. Pre-existing values are dropped (P-5.1); the migration nulls the column before changing the type so no row has a non-null `jsonb` value at the type-change boundary.
2. **Drizzle table update** — `organization-toolpacks.table.ts` declares the column as `text("auth_headers")` (no `$type<>()`; the column holds an opaque ciphertext string).
3. **Repository overrides** — `OrganizationToolpacksRepository` adds the same transparent encrypt-on-write / decrypt-on-read overrides that `ConnectorInstancesRepository` already uses. The class continues to expose `OrganizationToolpackSelect` to callers, but the `authHeaders` field on returned rows is `Record<string, string> | null` (decrypted) rather than the raw `string | null` from the table.
4. **Type-check update** — `db/schema/type-checks.ts` excludes `authHeaders` from the drizzle→model assignability check (column is `string | null` after the migration, model is `Record<string, string> | null`); the inferred-row check on the model side already passes because the table no longer constrains the JSON shape.
5. **Route compatibility** — verify (no code change expected) that `toolpacks.router.ts` continues to read `existing.authHeaders` as a plaintext map at the four call sites:
   - `POST /api/toolpacks` (create) — passes `authHeaders` straight to `findByOrganizationId` collision check / `model.update()` / `repo.create()`.
   - `PATCH /api/toolpacks/:id` (update) — reads `existing.authHeaders` to compute `effectiveAuth` before re-fetching the schema (`router.ts:469-470`).
   - `POST /api/toolpacks/:id/refresh` — reads `existing.authHeaders` to drive the schema/metadata fetch (`router.ts:649-651`).
   - `GET /api/toolpacks` / `GET /api/toolpacks/:id` — `toCustomApiRecord` only reads `Object.keys(row.authHeaders).length` for the `{has}` presence marker; the wire-side redaction still works because the repository hands routes the decrypted map.
6. **Tools-service compatibility** — verify (no code change expected) that `tools.service.ts:363-367` continues to receive a plaintext `Record<string, string> | null` when expanding custom toolpacks into `WebhookTool` instances. The runtime caller (`callWebhook`, `tools.service.ts:154-182`) gets the decrypted headers from the repository, spreads them into `fetch`, and the wire path is unchanged.
7. **Tests** — cases 130–135. Repository-level encryption round-trip, route-integration regression, and a focused unit test that confirms the on-disk column is opaque (does not contain the plaintext header value).

### Out of scope

- **In-place backfill of pre-existing auth headers.** P-5.1.
- **Key rotation surface, key registry, re-key script, runbook.** P-5.2. The `v: 1` field already on every payload preserves the option without committing the work.
- **Envelope encryption, KMS, per-org keys.** A single-key static `ENCRYPTION_KEY` is what `connector_instances` uses; matching it keeps operational surface flat. Upgrading both columns at once is a future effort.
- **Encrypting `endpoints`, `tools`, `metadata`.** None of these are user secrets — they're URLs and tool definitions the toolpack itself publishes. Only `auth_headers` carries credentials.
- **Outbound request signing, SSRF filtering, replay-prevention timestamps, runtime-response size cap, TLS pinning, audit log of credential usage.** All called out in the audit; each is its own concern. Phase 5 is the encryption-at-rest gap only.
- **Frontend changes.** `RegisterToolpackDialog` / `EditToolpackDialog` already capture and send headers in the request body; the on-wire flow is unchanged. The presence indicator (`{has: true/false}`) is computed by the repository response — still works without change because the repository returns decrypted plaintext to the route.
- **Logging changes.** No phase-5 audit log of credential usage; the existing `tools.service:55-61` invocation log already redacts headers (it doesn't include them).
- **`station_toolpacks` table.** Holds only the join, not the headers. No change.

---

## Surface

### Schema migration

**File: `apps/api/src/db/migrations/<timestamp>_encrypt_toolpack_auth_headers.sql`** (new — generated via `npm run db:generate -- --name encrypt_toolpack_auth_headers`)

```sql
-- P-5.1: drop pre-existing plaintext auth headers; org admins re-enter
-- via EditToolpackDialog after deploy. The column type changes from
-- jsonb to text to hold the encrypted blob produced by encryptCredentials().
UPDATE organization_toolpacks SET auth_headers = NULL;
ALTER TABLE organization_toolpacks
  ALTER COLUMN auth_headers TYPE text USING NULL;
```

The `USING NULL` clause is belt-and-braces: even if a row escapes the prior `UPDATE` (concurrent insert mid-migration), the type cast forces it to `NULL`. After migration the column is `text NULL` — never `NOT NULL`, since toolpacks without auth headers are a first-class case.

### Drizzle table

**File: `apps/api/src/db/schema/organization-toolpacks.table.ts`** (edit)

```diff
-    authHeaders: jsonb("auth_headers").$type<Record<string, string> | null>(),
+    authHeaders: text("auth_headers"),
```

Comment block at the top of the file updated:

```diff
-/**
- * `auth_headers` is plain jsonb redacted on every read endpoint —
- * actual values are returned only as a presence marker (`{has: true}`)
- * on the wire.
- */
+/**
+ * `auth_headers` is an opaque ciphertext blob produced by
+ * `encryptCredentials()` (AES-256-GCM, see `utils/crypto.util.ts`).
+ * The repository decrypts on every read so route handlers and
+ * `tools.service` see a `Record<string, string> | null` plaintext
+ * map. API responses still redact to `{has: true/false}` —
+ * plaintext never crosses the API boundary.
+ */
```

### Repository overrides

**File: `apps/api/src/db/repositories/organization-toolpacks.repository.ts`** (edit)

Mirror of the connector-instances helpers, with `authHeaders` instead of `credentials`. Helpers live alongside the class — same shape as `connector-instances.repository.ts:46-73`.

```ts
import {
  encryptCredentials,
  decryptCredentials,
} from "../../utils/crypto.util.js";

// ── Helpers ────────────────────────────────────────────────────────

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

The class adds the same five overrides that `ConnectorInstancesRepository` has — `findById`, `findMany`, `create`, `update`, `upsert` — plus `findByOrganizationId`, `findManyByIds`, and `findByIdScoped` already on this class. Each calls the parent and runs the rows through `decryptRow` / `decryptRows`. Each writer (`create`, `update`, `upsert`) runs `encryptInsert` on the input.

The narrow override list mirrors connector-instances exactly:

```ts
override async findById(id, client = db) { … }            // uses super + decryptRow
override async findMany(where, opts, client = db) { … }    // uses super + decryptRows
override async create(data, client = db) { … }             // encryptInsert + super + decryptRow
override async update(id, data, client = db) { … }         // encryptInsert + super + decryptRow
override async upsert(data, client = db) { … }             // encryptInsert + super + decryptRow
```

The bespoke methods on this class also need to decrypt:

```ts
async findByOrganizationId(...) { … return decryptRows(rows); }
async findManyByIds(...) { … return decryptRows(rows); }
async findByIdScoped(...) { … return row ? decryptRow(row) : undefined; }
```

The factory in `OrganizationToolpackModelFactory.create()` is unchanged — the model still emits a plaintext map; the encryption seam is at the DB boundary.

### Type-check update

**File: `apps/api/src/db/schema/type-checks.ts`** (edit lines 446–472)

Add `authHeaders` to the comment-justified jsonb-skip list, even though it's now `text` rather than `jsonb`. The reason for skipping is the same: the table column type (`string | null`) doesn't match the model column type (`Record<string, string> | null`), and the inferred-row check on the model side is the canonical guard. Either rename `_OrgToolpackJsonbCols` → `_OrgToolpackEncryptedAndJsonbCols` for accuracy, or keep the name and update the comment. Recommended: rename for clarity.

```diff
-// drizzle-zod widens jsonb columns to a generic JSON union that the
-// model's specific Zod refinements don't satisfy directly. Skip the
-// jsonb columns (`endpoints`, `authHeaders`, `tools`, `metadata`) on
-// the drizzle→model assignability check; the inferred-row check
-// (which uses the table's `$type<>()` annotations) catches drift on
-// those columns.
-
-type _OrgToolpackJsonbCols =
-  | "endpoints"
-  | "authHeaders"
-  | "tools"
-  | "metadata";
+// drizzle-zod widens jsonb columns to a generic JSON union, and the
+// `auth_headers` column is an opaque encrypted text blob at the table
+// layer but a `Record<string, string> | null` plaintext map at the
+// model layer (the repository decrypts on read). Skip these columns
+// on the drizzle→model assignability check; the inferred-row check
+// (which uses `$type<>()` annotations / the model schema) catches
+// drift on the structured columns.
+
+type _OrgToolpackOpaqueCols =
+  | "endpoints"
+  | "authHeaders"
+  | "tools"
+  | "metadata";
```

`_OrgToolpackJsonbCols` → `_OrgToolpackOpaqueCols` rename ripples to lines 461–464.

### No-change surface (called out for the plan)

These files are read-only validations — listed so the plan can confirm them by inspection rather than edit:

- `apps/api/src/routes/toolpacks.router.ts` — all four call sites (POST / PATCH / refresh / GET) already use the repository's return type. After the override they see the same `Record<string, string> | null` shape they see today. No edit.
- `apps/api/src/services/tools.service.ts:363-367` (custom toolpack → `WebhookTool` expansion) — receives `pack.authHeaders` from the repository result. Same shape. No edit.
- `apps/api/src/services/toolpack-registration.service.ts` — never touches the DB; only operates on `Record<string, string> | undefined` already in memory. No edit.
- `apps/web/**` — the API contract is unchanged; the frontend already only ever sees `{has: true/false}` for read responses and submits a plaintext map on write. No edit.
- `packages/core/src/models/organization-toolpack.model.ts` — `authHeaders: z.record(z.string(), z.string()).nullable()` continues to describe the *plaintext* shape callers see. No edit.

---

## TDD test plan

Cases 130–135, continuing from phase 4.

### Layer 1 — Crypto round-trip (unit, pure)

Already covered by `apps/api/src/__tests__/utils/crypto.util.test.ts`. No new cases at this layer; the helpers already pass for arbitrary `Record<string, unknown>` and the `authHeaders` shape is a strict subset (`Record<string, string>`).

### Layer 2 — Repository encryption boundary (integration, with real DB)

**File: `apps/api/src/__tests__/__integration__/db/repositories/organization-toolpacks.repository.integration.test.ts`** (extend)

130. **`create` encrypts authHeaders before insert** — call `repo.create({ ..., authHeaders: { Authorization: "Bearer abc123" } })`. Re-query the row with raw drizzle (bypassing the repository) and assert (a) `auth_headers` is a `string`, not an object, (b) the string does **not** contain the substring `"abc123"` or `"Bearer"`, (c) the string parses as JSON with `iv`, `authTag`, `data`, `v` keys. The repository's own return value has the plaintext map.
131. **`findByIdScoped` decrypts authHeaders on read** — given a row inserted in case 130, `repo.findByIdScoped(id, orgId)` returns `authHeaders === { Authorization: "Bearer abc123" }`.
132. **`findByOrganizationId` decrypts every row** — insert two rows for the same org, one with auth headers and one with `null`; the call returns both with their respective shapes (`Record<string, string>` and `null`).
133. **`update` re-encrypts on partial update touching authHeaders** — update only `name`; the encrypted blob in the DB is byte-equal to the prior blob (no re-encryption when the field isn't in the update payload). Then update with a new `authHeaders` map; the blob differs and the IV is fresh (decrypts to the new map).
134. **`null` round-trip** — `repo.create({ ..., authHeaders: null })` stores `auth_headers IS NULL` and `findById` returns `authHeaders: null`. No `encryptCredentials` call attempted.

### Layer 3 — Route integration regression (no behavior change)

**File: `apps/api/src/__tests__/__integration__/routes/toolpacks.router.integration.test.ts`** (extend)

135. **End-to-end POST → GET retains the redaction contract** — register a toolpack via `POST /api/toolpacks` with `authHeaders: { Authorization: "Bearer secret-token" }`; the response body's `authHeadersStatus` is `{has: true}` and the body **does not** contain the substring `"secret-token"`. Then `GET /api/toolpacks/:id` — same shape, same redaction. Finally a raw-DB query confirms `auth_headers` column is opaque (mirrors case 130 from the API surface side, end-to-end).

The existing route-integration cases from phases 1–4 should pass without modification — the repository abstraction makes encryption transparent. If any existing case fails, the override is incorrect (most likely a missed decrypt path on a custom finder).

### Test totals

**6 new test cases** (130–135). All in `apps/api`. No frontend test changes. No new mock harness — the integration tests already have an `ENCRYPTION_KEY` in `__tests__/__integration__/setup.ts` for the connector-instances tests; phase 5 reuses it.

---

## Acceptance criteria

- [ ] Cases 130–135 pass.
- [ ] All existing toolpack route + repository integration tests stay green without modification.
- [ ] `cd apps/api && npm run test:unit && npm run test:integration` green.
- [ ] `npm run lint && npm run type-check` clean from the repo root.
- [ ] Manual smoke (dev environment): register a custom toolpack with an `Authorization: Bearer xyz` header; query the row directly via `npm run db:studio` and confirm `auth_headers` is opaque (not `{Authorization: ...}`); confirm the toolpack still works end-to-end (schema fetch on registration, runtime call from a portal session).
- [ ] Pre-existing rows (if any) cleanly migrate: `auth_headers IS NULL` for every pre-existing row after `db:migrate`. Org admins are notified out-of-band that they must re-enter auth headers via the edit dialog.

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| `ENCRYPTION_KEY` not set in some environment → `getKey()` throws on first read of any toolpack with auth headers. | Already true for `connector_instances` — the env var is part of the standard deploy contract. Phase 5 inherits the same operational requirement. The error message from `getKey()` is explicit (`ENCRYPTION_KEY is not configured. Generate one with: openssl rand -base64 32`). |
| `ENCRYPTION_KEY` is rotated without a re-key step → every existing `auth_headers` blob becomes undecryptable. | Out of scope for phase 5 (P-5.2). The `v: 1` field on every payload makes a future rotation a code change, not a data migration. Until then, treat `ENCRYPTION_KEY` as immutable per environment. |
| Pre-existing org admins lose their auth headers at deploy. | P-5.1: documented; the toolpack's schema/metadata/runtime URLs survive, only the auth headers are nulled. Admins re-enter via `EditToolpackDialog`. The presence indicator on the listing page (`authHeadersStatus.has`) flips to `false` after migration, signaling which packs need attention. |
| Repository override misses a finder, returns the encrypted string to a caller, which then breaks at runtime when `tools.service` spreads a string into `fetch` headers. | The phase plan enumerates every finder on `OrganizationToolpacksRepository` and the integration tests round-trip through every method. The five base-class overrides plus three bespoke finders is the full surface. |
| The drizzle-zod `OrganizationToolpackSelect` type infers `authHeaders: string \| null` after the migration; downstream type-checks fail. | Type-check assertion in `db/schema/type-checks.ts` is updated to skip `authHeaders` (P-5.4). The model-side check still enforces the plaintext shape. |
| Storage growth — encrypted blob is larger than the plaintext jsonb. | Encrypted blob ≈ `len(plaintext) + 80–100 bytes` overhead (IV + tag + JSON envelope). For typical auth-header maps (one or two `Authorization` headers, ~100–200 bytes plaintext) the row grows to ~300 bytes. Negligible at any conceivable org count. |

**Rollback** is a single-PR revert plus a follow-up migration that converts `auth_headers` back to `jsonb`. Any auth headers entered after phase 5 ships and before rollback would be lost (the encrypted blob can't be parsed as `jsonb`); admins re-enter. Same operational shape as the forward migration.

---

## Files touched

### `apps/api`

- New: `src/db/migrations/<timestamp>_encrypt_toolpack_auth_headers.sql` (auto-generated from a `db:generate -- --name encrypt_toolpack_auth_headers` run; verify it nulls + retypes as described above; hand-edit if drizzle-kit emits a different operator order).
- Edit: `src/db/schema/organization-toolpacks.table.ts` — `jsonb` → `text` on `authHeaders`; comment block updated.
- Edit: `src/db/repositories/organization-toolpacks.repository.ts` — add helpers (`decryptRow`, `decryptRows`, `encryptInsert`); override `findById`, `findMany`, `create`, `update`, `upsert`; thread `decryptRow{s}` through `findByOrganizationId`, `findManyByIds`, `findByIdScoped`.
- Edit: `src/db/schema/type-checks.ts` — rename `_OrgToolpackJsonbCols` → `_OrgToolpackOpaqueCols`; comment update.
- Edit: `src/__tests__/__integration__/db/repositories/organization-toolpacks.repository.integration.test.ts` — cases 130–134.
- Edit: `src/__tests__/__integration__/routes/toolpacks.router.integration.test.ts` — case 135.

### `packages/core`

No changes. `OrganizationToolpackSchema.authHeaders` continues to describe the plaintext shape.

### `apps/web`

No changes. The API contract is unchanged on the wire.

### Migrations

- One new migration file (per above).
- No env-var addition. `ENCRYPTION_KEY` is already required in every deployed environment for connector credentials.
