# Custom pack inventory — Condensed design (#306)

**Issue:** [EnterpriseBT/portal-ai#306](https://github.com/EnterpriseBT/portal-ai/issues/306) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Custom toolpack tools are attached to a portal session but absent from every inventory the agent reads, so the agent denies tools it can actually call and sends the user to billing for a non-problem. Two paths drop the custom rows, and a third refuses to open a portal at all on a custom-only station — one root cause (custom packs treated as second-class by the pack-counting paths), so one canonical resolver rather than three patches. Single package: `apps/api`.

A fourth derivation — the per-message streaming path, which read a station field that does not exist and emptied the capability surface for **built-in** packs on every turn — was split out as **[#307](https://github.com/EnterpriseBT/portal-ai/issues/307)** and **shipped first** (merged as #308). It consolidated the built-in derivation into `buildStationContext`, which now fetches **all** `station_toolpacks` rows itself (`portal.service.ts:1060-1075`) — including the custom ones it currently discards. That shrinks this ticket: there is no longer a router-side derivation to convert, and the rows we need are already in hand at the one place that builds the context.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Attaches the tools (correct) | `tools.service.ts:408-414`, `:647-698` | Splits `station_toolpacks` into `builtinSlugs` **and** `customPackIds` from `organizationToolpackId`; constructs `WebhookTool`s gated only on the tier's `customToolpacks` entitlement. |
| **Defect 1** — the context builder | `portal.service.ts:1060-1075` | Post-#307 this is the single derivation for both portal creation and every streamed turn. It fetches all rows, then `.map(r => r.builtinSlug).filter(...)` — so custom rows are fetched and thrown away. |
| **Defect 2** — `station_context` tool | `station-context.tool.ts:193-205` | Queries `station_toolpacks` itself, then drops custom rows the same way. This is the path that produced the observed reply. |
| **Defect 3** — portal creation is blocked | `portal.service.ts:329-343` | `createPortal` counts **built-in** slugs only and throws `PORTAL_STATION_NO_TOOLS` when there are none — so a station whose only pack is a custom one **cannot open a portal at all**, even though `tools.service.ts:416` explicitly accepts builtin-**or**-custom. Not a reporting bug: the feature is unusable in that configuration. Its comment still describes the pre-#214 world. |
| The split | `entitlement.service.ts:43-73` | `splitBuiltinPacks` puts **any** ref absent from `entitlements.builtinToolpacks` into `unentitled` — so a custom ref, if one ever reached it, would be reported as a plan limit. Source of the "check Subscription & Billing" copy. |
| Custom pack record | `organization-toolpack.model.ts` | Has `name` (slug-shaped), `description`, and `tools[]` with per-tool `name`/`description` — enough to render an inventory entry. |
| Ref convention | `station.router.ts:29-52` | Custom packs are `org:<uuid>` on the wire; built-ins are bare slugs. |

## Decision — one resolver, and custom packs get their own context field

**Options.** (A) Merge custom packs into `effectiveToolPacks` as bare names — one field, but `effectiveToolPacks` is load-bearing for capability gating (`includes("entity_management")`, `portal.service.ts:1078`; `sqlAuthoringAvailable`, `system.prompt.ts:126-131`) and `PACK_PROMPT_SECTIONS` is keyed by `BuiltinToolpackSlug`, so non-builtin entries would sit in a list whose type and consumers assume built-ins. (B) Merge as `org:<uuid>` refs — puts UUIDs in the prompt. (C) A dedicated `customToolPacks` field alongside `effective`/`unentitled`.

**Chosen: C, behind a single resolver.** Add `EntitlementService.resolveStationPacks(stationId, organizationId)` returning `{ effective, unentitled, customPacks }`, where `customPacks: { name, description, toolNames }[]` is empty when the tier's `customToolpacks` entitlement is false. It owns the `station_toolpacks` fetch, the built-in split (delegating to `splitBuiltinPacks`, which keeps its name and its built-in-only contract), and the custom-pack lookup. Both context paths call it — `buildStationContext` (replacing its own fetch + map + split) and the `station_context` tool — so the two inventories cannot drift again.

`StationContext` gains `customToolPacks`; the prompt renders a short "organization-provided tools" block naming each pack and its tools. `station_context`'s `toolPacks` response gains `custom` alongside `effective`/`unentitled` (additive — the agent-facing shape only grows).

**Defect 3** is a separate rule in the same function: `createPortal` must count **builtin + custom** rows before throwing `PORTAL_STATION_NO_TOOLS`, matching `tools.service.ts:416`. A custom-only station is a valid configuration — the executor already treats it as one.

## Plan — 2 slices

**Slice 1 — the resolver, the context builder, the prompt, and the creation guard.**
- **Files.** Edit `apps/api/src/services/entitlement.service.ts` (add `resolveStationPacks`); `apps/api/src/services/portal.service.ts` (`buildStationContext` calls it and sets `customToolPacks`; `createPortal` counts builtin + custom before throwing, and its stale phase-1 comment goes); `apps/api/src/prompts/system.prompt.ts` (`StationContext.customToolPacks` + render the block).
- **Tests.** `apps/api/src/__tests__/services/entitlement.service.test.ts` — resolver returns custom packs with their tool names; omits them when the entitlement is false; never classifies a custom ref as `unentitled`. `apps/api/src/__tests__/services/portal.service.test.ts` — the context carries custom packs; **`createPortal` succeeds on a custom-only station** (defect 3's pin, currently a 400); a station with zero rows of either kind still throws. `apps/api/src/__tests__/prompts/system.prompt.test.ts` — the block renders iff `customToolPacks` is non-empty, and names each pack's tools. Run: `cd apps/api && npm run test:unit`.

**Slice 2 — the `station_context` tool.**
- **Files.** Edit `apps/api/src/tools/station-context.tool.ts` (call the resolver; add `custom` to the `toolPacks` section and to the tool's own description of that section). **No swagger change:** the `toolPacks` shape at `swagger.config.ts:1266-1281` belongs to the `Station` REST schema, not this tool — the tool's output is the `StationContextResponse` interface (`station-context.tool.ts:57`), which has no OpenAPI registration because it is an agent-facing tool result rather than an HTTP payload.
- **Tests.** `apps/api/src/__tests__/tools/station-context.tool.test.ts` — the `toolPacks` section includes registered custom packs and their tool names. Run: `cd apps/api && npm run test:unit`.

## Smoke (manual, against your dev stack)

The #279 mock toolpack fixture (`mock-toolpack-server.mjs`, port 4599) and the `smoke` pack registered against it are the setup for steps 2-4.

1. `npm run dev`. No migration and no core rebuild — the changes are `apps/api`-only.
2. With the `smoke` pack attached to a station, prompt **"what can the smoke toolpack do?"** → the agent names the pack **and** its tools (`refresh_crm`, `sync_all_records`). It does **not** deny the pack, and does **not** mention Subscription & Billing. *(This is the exact reply that opened the ticket.)*
3. Prompt **"what can you do on this station?"** → both the built-in capabilities **and** the custom pack are described. (Before this fix the built-ins were right — #307 — and the custom pack was missing.)
4. Detach the custom pack, ask again → it is no longer listed, and the built-ins still are.
5. **Defect 3:** create a station with **only** the `smoke` pack (no built-ins) and open a portal on it → the session opens instead of failing with "Station must have at least one tool pack enabled", and `refresh_crm` is callable in it.
6. On an org whose tier excludes custom toolpacks, attach a registered pack → the agent does not list it (matching #214's "inactive on your plan" behavior) and its tools are not offered. *Mark unverified if your local tier includes custom packs — there is nothing to observe.*

## Out of scope

- **Changing which tools are attached.** `tools.service.ts` is already correct; this ticket only fixes what the agent is *told*.
- **The streaming path's phantom field** — fixed by #307 (merged as #308); this ticket inherits its consolidated derivation.
- **The `unentitled` copy for built-ins** (#284's plan-limit guidance) — unchanged.
- **Surfacing custom packs in the web UI** — the station editor already resolves `org:<uuid>` labels via `ToolPackUtil.getLabel`; nothing observed wrong there.
- **Signature verification hardening** on the mock fixture — it is a scratchpad smoke aid, not shipped code.
