# Gate: unresolvable target → not found — Condensed design (#835)

**Issue:** [EnterpriseBT/portal-ai#835](https://github.com/EnterpriseBT/portal-ai/issues/835) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The agent permission gate answers a target the caller can't see with the generic `TOOL_PERMISSION_DENIED` ("You don't have permission to write this entity."). A target id that resolves to nothing, or to another org's row, should be "not found", as an unreadable owning entity or connector already is (#829). The agent relays the wrong code, and its prompt teaches the two as different things. API only (the gate, its tests, one prompt line).

## Current shape

| Piece | Location | Note |
|---|---|---|
| `parts` by part id | `src/services/permission-gate.service.ts:153–178` | `resolvePartOwner` null → `owners = null` → generic denial |
| `parts` owner refusal | same, `allPass("entity", owners, "write")` | an unreadable owner answers `Entity <entityId> was not found`, naming an id the caller never sent |
| `single` / `batch` | same, `:210–253` | `resolveRow` null → generic denial; a resolved but **unreadable** row fails `can(verb)` → generic denial |
| Fallback | same, `:258–265` | `refused ?? permissionDenied(…)`; the `catch` resets to generic (fail-closed) |
| Refusal shapes | same, `:62–88` (`permissionDenied`, `targetNotFound`, `refusalResult`) | |
| Labels | `src/services/permission-refusal.ts:33` `TYPE_LABELS`, `resourceTypeLabel` | no part labels (parts aren't permission types since #829) |
| Agent guidance | `src/prompts/system.prompt.ts:411` | describes `TOOL_TARGET_NOT_FOUND` as "the entity or connector" |

## Decision — unreadable == absent, named by the id the caller sent

- **`single` / `batch`:** resolve every target first.
  - A target that's missing, in another org, or not readable is refused as `TOOL_TARGET_NOT_FOUND` "`<Label> <id>` was not found." **Readable is part of the test:** if missing became not-found while unreadable stayed denied, the two answers would tell the caller which ids exist.
  - Only when every target is readable does the verb check run. A failure there is `TOOL_PERMISSION_DENIED` "You don't have permission to `<verb>` `<label>` `<id>`."
  - Not-found outranks denied across the call, as `firstRefusal` already orders them, so a mixed batch never confirms an id.
- **`parts` by part id:**
  - A part that doesn't resolve is `TOOL_TARGET_NOT_FOUND` "`<Record | Field mapping>` `<partId>` was not found."
  - An owner entity that's unreadable is refused the same way, **naming the part id**, so the refusal doesn't disclose the owning entity's id.
  - An owner that's readable but not writable keeps today's denial naming the entity, which the caller can see.
- **Unchanged:** an id missing from the input (schema-level) and an exception in the check stay the generic denial, fail-closed. `parts` by entity id (`objectPaths`), `create`, `readPaths` and `references` already answer this way.
- **Labels:** the gate gets a local part-label map (`entity_record` → "record", `field_mapping` → "field mapping"). `TYPE_LABELS` stays permission types only.
- **Prompt:** "`TOOL_TARGET_NOT_FOUND` means what the call names doesn't exist for the user". Same instruction otherwise.

## Plan — one slice

**Files**
- Edit: `apps/api/src/services/permission-gate.service.ts`.
- Edit: `apps/api/src/prompts/system.prompt.ts` (+ its pinning test if it pins the sentence).

**Tests** (`npm run test:unit` / `npm run test:integration` from `apps/api`)
- `src/__tests__/services/permission-gate.service.test.ts`:
  - `single`: an unresolved row → `TOOL_TARGET_NOT_FOUND` naming the id, and the tool doesn't run;
  - `single`: a resolved row the caller can't read → the same;
  - `single`: readable but not writable → `TOOL_PERMISSION_DENIED`;
  - `batch`: [readable-not-writable, missing] → `TOOL_TARGET_NOT_FOUND` (not-found outranks);
  - `parts` part id: unresolved → not found naming the part;
  - `parts` part id: unreadable owner → not found naming the **part** id, not the entity's;
  - `parts` part id: readable, unwritable owner → denied;
  - a thrown resolver → generic denial.
- `src/__tests__/__integration__/routes/parts-and-containers.agreement.integration.test.ts`:
  - a member's `entity_record_delete` with another org's record → `TOOL_TARGET_NOT_FOUND`;
  - `connector_entity_update` on a missing entity id → the same.
- Existing expectations that pin the old generic code for these cases are updated (`grep TOOL_PERMISSION_DENIED`).

## Smoke (manual, against your dev stack)

As **member** in a portal on a station with a writable connector and its entity (the #829 fixture shape):

1. "Delete record `00000000-0000-0000-0000-000000000000` from <my entity>". The tool result is `TOOL_TARGET_NOT_FOUND` "Record 0000… was not found.", and the agent says it wasn't found, not that permission is missing.
2. "Rename entity `00000000-0000-0000-0000-000000000000` to X" → `TOOL_TARGET_NOT_FOUND` "Entity 0000… was not found."
3. As **owner**, create an entity the member can't read, then as **member** "Rename entity `<that id>` to X" → the same `TOOL_TARGET_NOT_FOUND` as step 2. Nothing changes.
4. Grant the member **read** (not write) on that entity. The same prompt → `TOOL_PERMISSION_DENIED` naming the permission. Remove the grant.

## Adversarial

All probes are `— backend`: agent tools run in-process through `ToolService.buildAnalyticsTools` as **member**, with DB checks before and after. Fixtures: the member's writable connector and entity with a record and a mapping, an owner-only entity with a record and a mapping, and an entity in another org. §2 (concurrency) is N/A: the gate makes a read-only decision before the tool runs.

**§1 Malformed input**
- [ ] `connector_entity_update` with ids `not-a-uuid`, `x' or '1'='1` and a 5,000-character string → a typed `TOOL_TARGET_NOT_FOUND` naming the id. No throw, no DB error text, nothing written. — backend

**§4 Permission boundaries**
- [ ] A batch `[my entity, owner-only entity]` → the whole call is refused `TOOL_TARGET_NOT_FOUND` naming the owner-only id. My entity's label is unchanged. — backend
- [ ] `entity_record_delete` with an owner-only record id and **my** `connectorEntityId` → `TOOL_TARGET_NOT_FOUND` naming the record. The record isn't deleted. — backend
- [ ] `field_mapping_update` and `field_mapping_delete` on an owner-only mapping → `TOOL_TARGET_NOT_FOUND` naming the mapping. It isn't changed. — backend

**§5 Tenant isolation**
- [ ] `connector_entity_update` and `field_mapping_delete` on the other org's entity and mapping → the same message shape as a random uuid. The other org's rows are untouched. — backend

**§6 Lifecycle**
- [ ] My own soft-deleted entity and a record under it → `TOOL_TARGET_NOT_FOUND`. — backend

**§7 Misuse: telling hidden from missing**
- [ ] The batches `[missing, hidden]` and `[hidden, missing]` each name their **first** item with identical wording, so the order of refusals doesn't separate a hidden id from a missing one. — backend
- [ ] The batch `[read-only (granted read), hidden]` names the read-only item as denied. The hidden item isn't mentioned. — backend

### Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| §1 a 5,000-character id | the refusal echoes the whole id | low (reflection only; the input is already in the agent's context) | waived: the id is already in the agent's context, so echoing it reveals nothing new |
| §7 `[read-only, hidden]` | names the hidden id as not found, not the read-only id as denied: not found outranks denied in a batch (`firstRefusal`, #829), and `[read-only, missing]` reads the same | none (the probe's expectation was wrong) | no change needed |

## Out of scope

- REST routes: they already answer 404 / 403 through `loadForVerb`.
