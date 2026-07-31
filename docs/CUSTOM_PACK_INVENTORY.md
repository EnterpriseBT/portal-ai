# Custom pack inventory — Condensed design (#306)

**Issue:** [EnterpriseBT/portal-ai#306](https://github.com/EnterpriseBT/portal-ai/issues/306) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Custom toolpack tools are attached to a portal session but absent from every inventory the agent reads, so the agent denies tools it can actually call and sends the user to billing for a non-problem. Investigation found the station's pack list is derived in **two** places that both drop custom rows, so the fix is one canonical resolver rather than two patches. Single package: `apps/api`.

A third derivation — the per-message streaming path, which reads a station field that does not exist and empties the capability surface for **built-in** packs on every turn — is split out as **[#307](https://github.com/EnterpriseBT/portal-ai/issues/307)**: more severe, unrelated to custom packs.

**#307 ships first** (it degrades every turn on every station; this ticket only affects custom-pack users). So #307 lands the corrected derivation directly against `station_toolpacks`, and **this ticket collapses the duplication into the shared resolver** rather than introducing it into a vacuum — i.e. slice 1 below converts #307's call site too.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Attaches the tools (correct) | `tools.service.ts:408-414`, `:647-698` | Splits `station_toolpacks` into `builtinSlugs` **and** `customPackIds` from `organizationToolpackId`; constructs `WebhookTool`s gated only on the tier's `customToolpacks` entitlement. |
| **Defect 1** — session-creation list | `portal.service.ts:333-335` | `.map(r => r.builtinSlug).filter(...)` — custom rows dropped. Its comment ("custom rows … do not yet contribute to the executor — phase 1 only counts built-in slugs") documents a state that stopped being true when #214 shipped. |
| **Defect 2** — `station_context` tool | `station-context.tool.ts:193-205` | Queries `station_toolpacks` itself, then `.map(r => r.builtinSlug).filter(...)` — custom rows dropped again. This is the path that produced the observed reply. |
| *(#307, not this ticket)* | `portal-events.router.ts:99` | Reads a station field that doesn't exist → `effectiveToolPacks` empty every turn, for built-ins too. |
| The split | `entitlement.service.ts:43-73` | `splitBuiltinPacks` puts **any** ref absent from `entitlements.builtinToolpacks` into `unentitled` — so a custom ref, if one ever reached it, would be reported as a plan limit. Source of the "check Subscription & Billing" copy. |
| Custom pack record | `organization-toolpack.model.ts` | Has `name` (slug-shaped), `description`, and `tools[]` with per-tool `name`/`description` — enough to render an inventory entry. |
| Ref convention | `station.router.ts:29-52` | Custom packs are `org:<uuid>` on the wire; built-ins are bare slugs. |

## Decision — one resolver, and custom packs get their own context field

**Options.** (A) Merge custom packs into `effectiveToolPacks` as bare names — one field, but `effectiveToolPacks` is load-bearing for capability gating (`includes("entity_management")`, `portal.service.ts:1078`; `sqlAuthoringAvailable`, `system.prompt.ts:126-131`) and `PACK_PROMPT_SECTIONS` is keyed by `BuiltinToolpackSlug`, so non-builtin entries would sit in a list whose type and consumers assume built-ins. (B) Merge as `org:<uuid>` refs — puts UUIDs in the prompt. (C) A dedicated `customToolPacks` field alongside `effective`/`unentitled`.

**Chosen: C, behind a single resolver.** Add `EntitlementService.resolveStationPacks(stationId, organizationId)` returning `{ effective, unentitled, customPacks }`, where `customPacks: { name, description, toolNames }[]` is empty when the tier's `customToolpacks` entitlement is false. **All three** sites call it — `createPortal`, the `station_context` tool, and the streaming path #307 will have fixed — so the inventories cannot drift again. `splitBuiltinPacks` keeps its name and its built-in-only contract; the new function composes it with the custom-pack lookup.

`StationContext` gains `customToolPacks`; the prompt renders a short "organization-provided tools" block naming each pack and its tools. `station_context`'s `toolPacks` response gains `custom` alongside `effective`/`unentitled` (additive — the agent-facing shape only grows).

## Plan — 2 slices

**Slice 1 — the resolver + the session-creation path + the prompt.**
- **Files.** Edit `apps/api/src/services/entitlement.service.ts` (add `resolveStationPacks`); `apps/api/src/services/portal.service.ts` (`createPortal` uses it; `StationContext.customToolPacks`; drop the stale phase-1 comment); `apps/api/src/routes/portal-events.router.ts` (convert #307's derivation to the resolver); `apps/api/src/prompts/system.prompt.ts` (render the custom block).
- **Tests.** `apps/api/src/__tests__/services/entitlement.service.test.ts` — resolver returns custom packs, omits them when the entitlement is false, never classifies a custom ref as `unentitled`. `apps/api/src/__tests__/services/portal.service.test.ts` — `createPortal`'s context carries the custom packs. `apps/api/src/__tests__/prompts/system.prompt.test.ts` — the custom block renders iff `customToolPacks` is non-empty. Run: `cd apps/api && npm run test:unit`.

**Slice 2 — the `station_context` tool.**
- **Files.** Edit `apps/api/src/tools/station-context.tool.ts` (use the resolver; add `custom` to the `toolPacks` section + its description) and `apps/api/src/config/swagger.config.ts` if the station-context response shape is registered there (`:1266-1278` carries a `toolPacks` shape).
- **Tests.** `apps/api/src/__tests__/tools/station-context.tool.test.ts` — the `toolPacks` section includes registered custom packs and their tool names. Run: `cd apps/api && npm run test:unit`.

## Smoke (manual, against your dev stack)

1. `npm run build --workspace=packages/core` (if `StationContext` moves types), then `npm run dev`.
2. Start the mock toolpack server (`node mock-toolpack-server.mjs 4599`, the #279 fixture) and register it if it isn't still registered; attach it to a station.
3. Prompt **"what can the smoke toolpack do?"** → the agent names the pack **and** its two tools (`refresh_crm`, `sync_all_records`). It does **not** deny the pack, and does **not** mention Subscription & Billing.
4. Detach the custom pack, ask again → the agent no longer lists it, and still describes the built-ins.
5. On an org whose tier excludes custom toolpacks, attach a registered pack → the agent does not list it (matching #214's "inactive on your plan" behavior), and its tools are not offered.

## Out of scope

- **Changing which tools are attached.** `tools.service.ts` is already correct; this ticket only fixes what the agent is *told*.
- **Diagnosing the streaming path's phantom field** — #307 owns that fix; this ticket only converts its call site to the shared resolver afterwards.
- **The `unentitled` copy for built-ins** (#284's plan-limit guidance) — unchanged.
- **Surfacing custom packs in the web UI** — the station editor already resolves `org:<uuid>` labels via `ToolPackUtil.getLabel`; nothing observed wrong there.
- **Signature verification hardening** on the mock fixture — it is a scratchpad smoke aid, not shipped code.
