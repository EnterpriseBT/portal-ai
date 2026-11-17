# A custom tool pack the plan excludes — Condensed design (#1045)

**Issue:** [EnterpriseBT/portal-ai#1045](https://github.com/EnterpriseBT/portal-ai/issues/1045) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** When a station has an organization-registered (custom) tool pack attached and the plan doesn't include custom packs, the assistant has no way to know. Asked why the pack's tools stopped working, it answers as if the pack weren't there. For a built-in pack the plan excludes, it names the pack and says it is a plan limit. `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The pack lookup | `apps/api/src/services/entitlement.service.ts:144-172` | For a plan without custom packs, `resolveStationPacks` returns `customPacks: []`. The split (`:33-50`) carries only `configuredCustomPackCount` and `customPacksEntitled` |
| Why they are dropped | `entitlement.service.ts:53-60` | #306: the tools aren't constructed, so listing the pack among callable tools would describe nothing. Right for the inventory, but it also drops the fact the assistant needs |
| The prompt's plan-limit section | `apps/api/src/prompts/system.prompt.ts:1145-1195` | "Not Included In This Plan": built-in slugs from `unentitledToolPacks` only |
| The prompt's custom-pack section | `system.prompt.ts:1114-1143` | "Organization-Provided Tools": entitled packs only, and says never to blame the plan for a pack listed there |
| `platform_help`'s plan answer | `apps/api/src/tools/platform-help.tool.ts:271-276` | Lists `unentitledPacks`, built-in slugs only |
| `station_context`'s pack field | `apps/api/src/tools/station-context.tool.ts:125-134, 216` | `{ effective, unentitled, custom }`; `custom` is empty on such a plan |
| Reading pack rows | `apps/api/src/db/repositories/organization-toolpacks.repository.ts:278` | `findManyByIds` decrypts each pack's stored credentials. There is no names-only read |

## Decision — what the assistant is told

- **A. A count.** "1 organization tool pack on this station isn't included in the plan." Needs no new read, but the assistant can't say which pack, and "why did the acme tools stop working?" gets a vague answer.
- **B. The packs' names.** The assistant can answer by name. Needs a read of the attached packs' names; it must not go through the decrypting read, since nothing here uses credentials.

**Decided: B.** A names-only repository read (`id`, `name`; org-scoped; not deleted), run only when the station has custom packs attached and the plan excludes them. The lookup returns them as `excludedCustomPacks: string[]` on the split, so `resolveStationPacks` and `resolveStationPackSplit` both carry it. Three readers use it:

1. **System prompt.** "Not Included In This Plan" renders when either list is non-empty and lists each excluded custom pack by name, as a pack the organization registered itself. The section's existing instructions then apply to it (state the plan as the reason; point at Subscription & Billing).
2. **`platform_help`.** `unentitledPacks` includes the names, so the plan-limit answer covers them.
3. **`station_context`.** `toolPacks` gains `customNotInPlan: string[]`, described in the tool's description next to `unentitled`.

Not changed: whether such a station counts as "set up for data". A custom pack the plan excludes still doesn't (#848). The one sentence that says a station with no data pack is "how it is set up, not a fault" is dropped when the station has an excluded custom pack, since there the plan is part of why.

## Plan — one slice

**Files**
- Edit: `organization-toolpacks.repository.ts` — `findNamesByIds(ids, { organizationId })`.
- Edit: `entitlement.service.ts` — `excludedCustomPacks` on `StationPackSplit`, filled in the shared read.
- Edit: `apps/api/src/services/portal.service.ts` — carry it into the prompt context.
- Edit: `system.prompt.ts` — the plan-limit section and the one sentence above.
- Edit: `platform-help.tool.ts`, `station-context.tool.ts` (field, type and description).

**Tests** (written first; `npm run test:unit -- --testPathPattern "entitlement.service|system.prompt|platform-help|station-context|portal.service"` in `apps/api`)
- `entitlement.service.test.ts`: names returned when the plan excludes custom packs; empty when it includes them or none are attached; the decrypting read is not called for them.
- `system.prompt.test.ts`: the section renders for an excluded custom pack alone, names it, and still renders built-ins as before; "Organization-Provided Tools" never lists it; the "how it is set up" sentence is absent on such a station.
- `platform-help.tool.test.ts`: the plan answer names it.
- `station-context.tool.test.ts`: `customNotInPlan` is returned.
- An integration test for the repository read (org-scoped, skips deleted): `npm run test:integration -- --testPathPattern organization-toolpacks`.
- Then `npm run lint`, `npm run type-check`, `npm run format:check`.

## Smoke (manual, against your dev stack)

Needs an org on a plan with custom packs (enterprise), one custom pack registered and attached to a station, then the org moved to a plan without them (`portalai org set-tier <org> standard`; wait a minute for the plan cache or restart the API).

1. Before the downgrade, on that station: "What tools do you have from the <pack> pack?" The assistant lists them.
2. After the downgrade, same station, new portal: "Why did the <pack> tools stop working?" The assistant says the <pack> pack isn't included in the organization's current plan and points at Settings → Subscription & Billing. It doesn't say the station lacks the pack or suggest attaching it.
3. Same portal: "What can I do on this station?" The answer doesn't offer the pack's tools, and if it mentions the pack it says the plan excludes it.
4. Move the org back to the plan with custom packs. A new portal lists the pack's tools again and doesn't mention a plan limit.

## Out of scope

- **A station pointing at a custom pack that no longer exists.** The prompt goes by the pack rows that resolve and `platform_help` by the count of attached ids, so they can differ for a dangling row. Rare, and a different cause.
- **Showing excluded custom packs in the web app.** The station page's chips for them are unchanged.
