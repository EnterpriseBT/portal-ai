# Agent create upsert — Condensed design (#825)

**Issue:** [EnterpriseBT/portal-ai#825](https://github.com/EnterpriseBT/portal-ai/issues/825) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). **Security fix:** the security review is required.

**Why.** The agent's `connector_entity_create` and `field_mapping_create` upsert: on an existing key they update the existing row and report `"created"`, with `updated_by` left NULL.

While scoping this I found it's also an **authorization bypass**. The create tools are gated as "may the caller create a row they'd own", but the upsert then changes a row someone else owns, which nothing checks.
- **Entities:** the `e2e-member`, who gets `404` on both `GET` and `PATCH` of the owner's `smoke_widgets`, relabelled it through `connector_entity_create` and got its id back.
- **Field mappings:** the conflict update also rewrites `sourceField`, `columnDefinitionId`, `isPrimaryKey`, `required` and the rest.

The fix: the agent's **create** tools only create, and changing an existing object goes through the **update** tools, which authorize per object. API and the core tool-description mirror.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Create auth | `packages/core/src/registries/builtin-toolpacks.ts:1769` (`connector_entity_create`), `:1803` (`field_mapping_create`) | `mode: "create"` |
| Create check | `apps/api/src/services/permission-gate.service.ts:102–108` | `can(write, { type, createdBy: caller })`, i.e. a new row the caller owns; never the existing row |
| Entity upsert | `connector-entity-create.tool.ts:159` → `connectorEntities.upsertByKey` (`connector-entities.repository.ts:226`) | Existing key: `set { label, updated, updatedBy: data.updatedBy }`, where `updatedBy` is null on a fresh model. Also used by `layout-plan-commit.service.ts:276` and `demo-seed.service.ts:554` |
| Mapping upsert | `field-mapping-create.tool.ts:186` → `fieldMappings.upsertByEntityAndNormalizedKey` (`field-mappings.repository.ts:248`) | `onConflictDoUpdate` rewrites the mapping's fields. Also used by `field-mappings/reconcile.ts:258` and `demo-seed.service.ts:585` |
| Update tools | `connector_entity_update` / `field_mapping_update` (`builtin-toolpacks.ts:1779`, `:1813`) | `mode: "batch"` by id, so write is checked on **each existing object** |
| Existing-key lookup | `connectorEntities.findByKey(connectorInstanceId, key)` (`connector-entities.repository.ts:114`) | Entity key is unique per org (`upsertByKey` matches `(organizationId, key)`) |
| Tool descriptions | `field_mapping_create`: "Creates **or updates** …" (tool + `builtin-toolpacks.ts:957` mirror) | Promises the upsert |

## Decision — what an agent "create" does on an existing key

- **A. Refuse it per item:** "already exists; use `<x>_update` to change it". The update tools already authorize write on the existing object.
- **B. Keep the upsert, but authorize the existing row as an update** (check `write` on `{ type, id, createdBy }`), report `updated`, stamp `updated_by`. This needs a permission set inside the tools, and it duplicates what the update tools exist for.
- **C. Fix only the reporting and `updated_by`.** This leaves the bypass.

**Decision: A.** It closes the bypass by construction, because no create path can touch an existing row.
- **Separation:** create versus change maps onto the tools that already exist, each with the right authorization.
- **Not leaking existence:** the per-item failure doesn't say whose row it is or confirm details. The entity message is "an entity with this key already exists in this organization", which the unique key reveals today anyway (a REST create on a taken key fails too).
- **The shared upserts are unchanged.** Layout-plan commit, reconcile and demo seed are system flows authorized elsewhere; only the two agent tools stop calling them on an existing key.

**Shape:**
- Inside each tool's existing write transaction, look the key up first:
  - entity: an existing `(organizationId, key)`, matching `upsertByKey`'s match
  - mapping: `(connectorEntityId, normalizedKey)`
- **Found** → a per-item validation failure. As with the tools' other validation failures, the call is all-or-nothing: if any item fails, nothing is written. *(Amended during implementation; the first draft said the other items still run.)*
- **Not found** → insert with `create` (not upsert).
- **A concurrent insert of the same key** trips the unique index; that item is reported as the same "already exists" failure, never as an update.

## Plan — one slice

**Files**
- Edit: `apps/api/src/tools/connector-entity-create.tool.ts`: pre-check plus `create`, and the "already exists — use `connector_entity_update`" failure.
- Edit: `apps/api/src/tools/field-mapping-create.tool.ts`: the same, with `field_mapping_update`. The description becomes "Creates one or more field mappings… To change an existing mapping, use `field_mapping_update`."
- Edit: `packages/core/src/registries/builtin-toolpacks.ts`: mirror the `field_mapping_create` description (and the entity tool's, if it gains the pointer).
- Edit: `apps/api/src/db/repositories/field-mappings.repository.ts`, only if no `(connectorEntityId, normalizedKey)` lookup exists; add `findByEntityAndNormalizedKey`.

**Tests** (`npm run test:unit` / `npm run test:integration` from `apps/api`; `test:unit` in `packages/core` for the mirror)
- `src/__tests__/tools/connector-entity-create.tool.test.ts` and `field-mapping-create.tool.test.ts`:
  - an existing key yields a per-item failure naming the update tool
  - `upsertByKey` / `upsertByEntityAndNormalizedKey` are **not** called
  - a new key still creates
  - a batch with one existing key fails that item and writes nothing (all-or-nothing, like the tools' other validation)
- New integration `src/__tests__/__integration__/tools/agent-create-existing-key.integration.test.ts`: as a member with `created_by_caller` write, `connector_entity_create` and `field_mapping_create` on the owner's existing key leave the owner's row byte-for-byte unchanged and return the failure. A new key still creates, owned by the member.
- `builtin-toolpacks.test.ts` (core) keeps the tool and mirror descriptions in sync.

## Smoke (manual, against your dev stack)

1. **Owner, existing key:** with `smoke_widgets` existing, prompt **"Create an entity smoke_widgets with label Again on Sandbox."** The agent reports that it already exists and offers the update instead. The label and `updated` are unchanged.
2. **Owner, intended change:** prompt **"Rename smoke_widgets to Smoke Widgets Renamed."** The agent uses `connector_entity_update`, and the label and `updated_by` change.
3. **Member, the bypass:** as the member, in a portal on a station that reaches Sandbox, prompt **"Create an entity smoke_widgets with label Hijacked on Sandbox."** The owner's row is unchanged (`select label, updated, updated_by from connector_entities where key='smoke_widgets'`), and the agent reports the key exists.
4. **Mappings:** prompt **"Map a text field name on smoke_widgets"** where `name` exists. The agent reports it exists. The mapping's `source_field`, `column_definition_id` and `updated` are unchanged.

## Out of scope

- The shared repository upserts' null `updatedBy` on their update branch, used by layout-plan commit, reconcile and demo seed. Those are system flows; a follow-up if their audit trail matters.
- A REST `POST /api/connector-entities` on a taken key probably surfaces as `500 CONNECTOR_ENTITY_CREATE_FAILED` (the unique-index error is wrapped as a 500 in its catch) rather than a `409`. Unverified; a separate bug if confirmed.

## Adversarial

Probes for how the fix breaks. Each runs the agent tool as a session builds it (every gate wraps it), on a station that reaches Sandbox. A `— backend` probe is a direct tool call or SQL check rather than a portal prompt.

### §2 — Malformed input
- [ ] Create with a key differing only in case from an existing one (`Smoke_Widgets` against `smoke_widgets`). Expected SAFE: refused by the key schema (lowercase only), nothing written. A case variant can never slip past the existence check into a second row. — backend

### §3 — Concurrency
- [ ] Two `connector_entity_create` calls for the same **new** key, fired concurrently. Expected SAFE: exactly one row. The other call is refused as "already exists" (pre-check or the unique index), and neither call updates the other's row. — backend
- [ ] The same for `field_mapping_create` on one entity and a new `normalizedKey`. Expected SAFE: one mapping, one refusal. — backend

### §4 — Auth boundaries
- [ ] As the **member**, `connector_entity_create` on the owner's existing key. Expected SAFE: refused, the owner's row byte-identical, no entity id in the result. — backend
- [ ] As the **member**, `field_mapping_create` on the owner's existing mapping key, with a different `sourceField` and `isPrimaryKey: true`. Expected SAFE: refused, the mapping unchanged. — backend
- [ ] As the **member**, `connector_entity_update` on the owner's entity, the path the refusal points to. Expected SAFE: refused by the per-object permission check (the member has no write on it), and the row is unchanged. The pointer never becomes a way around the gate. — backend

### §5 — Multi-tenant
- [ ] A key that exists only in **another org**. Expected SAFE: the create in this org succeeds as a new row. The other org's row is untouched, and the refusal never fires across orgs. — backend

### §6 — Lifecycle
- [ ] Create over a **soft-deleted** entity's key. Expected SAFE: a new row with a new id. The deleted row stays deleted and unchanged; it's neither resurrected nor modified. — backend

### §7 — Misuse sequences
- [ ] One call with the same new key twice. Expected SAFE: refused with "This batch repeats key", naming item 1, and nothing written. — backend
- [ ] One call mixing a new key with an existing one. Expected SAFE: the whole call refused, nothing written (all-or-nothing), the new key not created either. — backend

N/A: §1 boundary (no size or range input changed).

### Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk)_ | | | |
