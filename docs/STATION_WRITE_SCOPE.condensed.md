# Station write scope — Condensed design (#824)

**Issue:** [EnterpriseBT/portal-ai#824](https://github.com/EnterpriseBT/portal-ai/issues/824) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** A station with no attached curated views loses every agent write tool, and the agent then blames the plan. A new org can't create its first entity through the portal.

#599 moved `resolveStationCapabilities` to derive the station's connector instances from its **attached views**. The write gate in `buildAnalyticsTools` still uses it to answer "does any attached connector allow writes?". The tools themselves, though, check scope against the station's **attached connectors** (`station_instances`), and so does the connector list the agent sees. The gate and the tools disagree, so the gate drops tools the tools would have allowed.

This fixes the gate, and tells the agent the real reason when writes truly aren't possible. API only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Write gate | `apps/api/src/services/tools.service.ts:915–930` | Drops every write-gated tool unless `resolveStationCapabilities(stationId).some(c => c.capabilities.write)` |
| `resolveStationCapabilities` | `apps/api/src/utils/resolve-capabilities.util.ts:92` | Instances from `instanceIdsForStation` (`:153`): station_views → curated_view → entity → instance. Empty with no views |
| Tool-level scope | `connector-entity-create.tool.ts:65` (`stationInstancesRepo`), `assertStationScope` (`resolve-capabilities.util.ts:174–195`) | Both check the instance against **`station_instances`**, not views |
| Agent's connector list | `portal.service.ts:1277`, `loadConnectorInstanceContexts` (`:1341`) | Lists `station_instances` connectors, so the agent sees Sandbox and is told to pass its id |
| Per-entity caps | `resolveEntityCapabilities` (`resolve-capabilities.util.ts:200`) | Entities from views (the #599 read scope), capability looked up by instance from `resolveStationCapabilities` |
| Plan-limit guidance | `prompts/system.prompt.ts` ("Not Included In This Plan", `unentitledToolPacks`) | Covers plan exclusions only. Nothing tells the agent that write tools were gated by connector capability, so it guesses "plan" |

## Decision — what the write gate counts as "attached"

- **A. The union of `station_instances` and the instances behind the station's views.** This is what the tools already accept: the gate then admits exactly the writes the tools would accept, and a view-only attachment keeps working.
- **B. `station_instances` only.** Simpler, but a station that reaches a write-enabled instance only through a view would lose write tools it has today.
- **C. Drop the station-level gate and rely on per-item checks.** The agent would be handed tools that fail on every call for a read-only station.

**Decision: A.** `resolveStationCapabilities` takes its instance set from `station_instances ∪ instanceIdsForStation`, and keeps its contract ("every connector instance attached to a station").
- `resolveEntityCapabilities` is unaffected. It still takes its entities from views (the read scope #599 set) and only looks capability up by instance, so the extra instances are inert there.

**Plus the explanation.** `ConnectorInstanceContext` gains `writable: boolean`, filled by `loadConnectorInstanceContexts` from `resolveCapabilities(definition, instance).write`. When `entity_management` is effective but no connector the station reaches is writable, the system prompt says so. The condition is `StationContext.stationWritable`, computed from the same `resolveStationCapabilities` the gate uses, so the prompt says writes are off exactly when the gate withheld the tools. *Amended after code review:* a first version keyed it off `station_instances` only, and a station writable through a view was then told its tools didn't exist.
- Its create, update and delete tools are unavailable because no connector attached to this station allows writes.
- The user can enable write on a connector or attach a write-enabled one.
- It is **not** a plan limit.

The agent no longer has to infer the reason from a missing tool.

## Plan — one slice

**Files**
- Edit: `apps/api/src/utils/resolve-capabilities.util.ts`: `resolveStationCapabilities` takes its instances from the de-duplicated union of `stationInstancesRepo.findByStationId` and `instanceIdsForStation`. Its #599 comment explains why writes include the directly attached connectors.
- Edit: `apps/api/src/prompts/system.prompt.ts`: `ConnectorInstanceContext.writable`, and a "Read-only connectors" paragraph rendered when `entity_management` is effective and `stationWritable` is false.
- Edit: `apps/api/src/services/portal.service.ts`: `loadConnectorInstanceContexts` sets `writable`.

**Tests** (`npm run test:unit` / `npm run test:integration` from `apps/api`)
- `src/__tests__/utils/resolve-capabilities.util.test.ts`:
  - a station with an attached write-enabled connector and **no views** resolves `write: true`
  - an instance reached through both links appears once
  - the existing view-path cases still pass
- `src/__tests__/services/tools.service.test.ts`: with no views but a writable attached connector, `connector_entity_create`, `field_mapping_create` and `entity_record_create` are built. With only read-only connectors they're still dropped.
- `src/__tests__/prompts/system.prompt.test.ts`: the read-only paragraph renders exactly when `entity_management` is effective and no connector is writable. It never names the plan.

## Smoke (manual, against your dev stack)

1. **Fresh fixture:** `e2e-fixture` after `e2e:seed`. My Station has Sandbox attached and **no views**. Open a portal and prompt: **"Create an entity called smoke_widgets on the Sandbox connector, map a text field name, then add one record with name Gear."** The agent creates all three, with no "not included in your plan" message.
2. **Read-only connector:** set the Sandbox instance's `enabled_capability_flags.write` to `false` (`db:studio`, or SQL), start a new portal and send the same prompt. The agent says writes aren't available because no attached connector allows them, and does **not** mention the plan or billing. Restore `write: true` afterwards.
3. **View-only scope still works:** on a station with a view on a writable entity, but with that entity's connector not attached, write tools are still offered (the existing behaviour, kept).

## Out of scope

- **Entities outside the station's views are still invisible to the agent's read tools.** That's #599's read scope by design. An entity the agent just created is writable by id but isn't listed in `station_context` until a view is attached. A separate decision if it should be auto-exposed.
- Any change to `assertStationScope` or to the per-tool checks; they're already instance-based.
