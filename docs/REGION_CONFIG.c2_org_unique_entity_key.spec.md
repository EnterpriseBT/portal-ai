# C2 — Entity Key Unique per Organization

Scope for a single PR. Rationale and higher-level context live in
`docs/REGION_CONFIG_FLEXIBILITY.discovery.md` § "Simplifying
constraints → C2".

## Rule

`ConnectorEntity.key` is unique within the organization, not merely
within a connector instance. Each connector still owns its own
entities — the constraint is a **lookup-space guarantee** so that any
`FieldMapping.refEntityKey` resolves to exactly one entity org-wide.

There is no cross-connector append or shared ownership. A collision
is a hard error; the user must pick a different key.

## Schema change

**`apps/api/src/db/schema/connector-entities.table.ts`**:

- Drop the existing `UNIQUE(organization_id, connector_instance_id,
  key)` index.
- Add `UNIQUE(organization_id, key) WHERE deleted IS NULL` (partial
  index, so soft-deleted keys free up for reuse under the new
  namespace).

Migration generated via `npm run db:generate -- --name
connector_entities_org_unique_key`. The generated SQL goes in
`apps/api/src/db/migrations/`. Hand-edit if drizzle-kit can't emit
the partial index — PostgreSQL supports it natively
(`CREATE UNIQUE INDEX ... WHERE deleted IS NULL`).

## Migration playbook

### Dry-run audit

Before applying the migration, run a one-off script that counts
duplicates per org:

```sql
SELECT organization_id, key, COUNT(*) AS rows, array_agg(id) AS ids
FROM connector_entities
WHERE deleted IS NULL
GROUP BY organization_id, key
HAVING COUNT(*) > 1
```

The script lives at
`apps/api/scripts/audit-duplicate-entity-keys.ts` and is runnable via
`npm --workspace apps/api run audit:entity-keys`. Output format: one
line per `(org, key)` collision with the affected entity ids.

### Remediation (support-led)

Any org with collisions is blocked from the migration. Support
contacts those orgs individually, chooses a renaming convention, and
issues manual `UPDATE connector_entities SET key = ...` statements
under the old uniqueness constraint. Once the audit returns empty,
the migration runs.

### Rollback

The migration is reversible in principle (drop the new index, restore
the old). In practice, if C2 ships and later code depends on org-wide
uniqueness, rollback is destructive. Treat the migration as one-way;
document the rollback SQL in the migration file but don't plan for it.

## API changes

### Entity upsert path

**`apps/api/src/db/repositories/connector-entities.repository.ts`** —
`upsertByKey` today keys on `(connectorInstanceId, key)`. New
behavior:

1. Look up any existing `ConnectorEntity` in this org with this key
   (`deleted IS NULL`).
2. If it exists and belongs to **this** connector instance → update
   it (same as today's upsert).
3. If it exists and belongs to **another** connector instance →
   throw `ApiError(400,
   CONNECTOR_ENTITY_KEY_IN_USE_BY_OTHER_CONNECTOR,
   "Entity key '${key}' is already used by connector '${other.connectorInstanceId}' in this org.")`.
4. If none exists → create a new entity under the current connector
   instance.

**`apps/api/src/services/layout-plan-commit.service.ts`** — the
upsert already bubbles errors through; no additional handling needed
beyond letting the new `ApiError` surface to the route response.

**`apps/api/src/constants/api-codes.constants.ts`** — add
`CONNECTOR_ENTITY_KEY_IN_USE_BY_OTHER_CONNECTOR` to `ApiCode`.

### Reference resolution

**`apps/api/src/services/field-mappings/reconcile.ts`** —
`lookupDbEntityNormalizedKeys` today walks the org-wide
`ConnectorEntity` table with a first-row-wins fallback for the same
key across connectors. Simplify:

- The index now guarantees at most one match.
- Drop the first-row-wins comment and the loop — a single
  `findOne()` suffices.
- Error message `LAYOUT_PLAN_INVALID_REFERENCE` stays the same.

## Frontend changes — `apps/web/`

### Entity picker

**`src/api/connector-entities.api.ts`** — the `search` endpoint
already returns org-wide results. Payload shape gains a
`connectorInstanceName` on each option (for the display label). Route
handler on the API side adds a join.

**`src/modules/RegionEditor/RegionConfigurationPanel.component.tsx`**
and consumers feeding `entityOptions` — the option label format
becomes `${entity.label} — ${connectorInstanceName}` for existing
DB-backed entities, so users see which connector owns the key.
Staged (this-import) options are unaffected.

### Key-collision pre-check

When the user creates a new entity (via the "+ Create new entity"
affordance in the editor), validate the chosen key against the
org-wide entity catalog before committing. If the key is already in
use by another connector, show an inline error with the owning
connector's name and block the Create action. Reuses the same search
endpoint, scoped to `key = <input>`.

## Test plan

### DB / migrations (`apps/api/src/__tests__/__integration__/db/`)

- Migration integration test seeds two entities in different
  connectors with the same key, runs the audit script, asserts both
  show up in the output.
- Clean-slate migration (no duplicates) applies cleanly; attempting
  an insert with a duplicate key in a different connector fails with
  a unique-constraint violation at the DB layer.

### Repository / Service
(`apps/api/src/__tests__/__integration__/db/repositories/connector-entities.repository.integration.test.ts`)

- `upsertByKey` with same connector + same key → updates the existing
  row.
- `upsertByKey` with different connector + same key in the same org →
  throws `CONNECTOR_ENTITY_KEY_IN_USE_BY_OTHER_CONNECTOR`.
- `upsertByKey` with different connector + same key in a *different*
  org → succeeds (org scope still respected).

### Reference validation
(`apps/api/src/__tests__/__integration__/services/field-mappings/reconcile.integration.test.ts`)

- Reference to a key owned by another connector in the same org →
  resolves correctly (no "first-row-wins" ambiguity).
- Reference to a non-existent key → fails with
  `LAYOUT_PLAN_INVALID_REFERENCE` as today.

### Frontend

- `RegionConfigurationPanel.test.tsx` — entity picker's display label
  includes the owning connector's name.
- `NewEntityDialog.test.tsx` (or equivalent create-entity component)
  — submitting a key already in another connector shows an inline
  error and doesn't call the create handler.

## Acceptance criteria

- Before the migration, the audit script runs and returns zero
  duplicates for the target deploy (staging and prod).
- After the migration, the unique index is
  `UNIQUE(organization_id, key) WHERE deleted IS NULL`.
- A commit that would create an entity whose key is already owned by
  another connector in the same org fails with
  `CONNECTOR_ENTITY_KEY_IN_USE_BY_OTHER_CONNECTOR` and writes no
  rows.
- References to keys owned by any connector in the same org resolve
  correctly at commit time.
- Users see which connector owns each entity in the picker.

## Non-regression

- Intra-connector key uniqueness is preserved (it was always
  implied by the old index; the new index is strictly broader).
- Soft-deleted entities free up their key for reuse (partial index
  behavior).
- Cross-org scoping unchanged — different orgs can freely share
  keys.

## Rollout

One PR covering migration + repository + service + frontend. Sequence
in the PR body:

1. Ship the audit script first (can be run against production before
   any schema change).
2. Remediate any reported duplicates via support-led rename.
3. Merge + deploy the migration + code.

Feature-flagging is unnecessary because the rule is universally
correct and the migration refuses to apply if the dry-run surfaces
conflicts.
