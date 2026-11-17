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

**Decided: B.** A names-only repository read (`id`, `name`; org-scoped; not deleted), run only when the station has custom packs attached and the plan excludes them. The lookup returns them as `excludedCustomPacks: string[]`, sorted by name, on the split, so `resolveStationPacks` and `resolveStationPackSplit` both carry it. Three readers use it:

1. **System prompt.** "Not Included In This Plan" renders when either list is non-empty and lists each excluded custom pack by name, as a pack the organization registered itself. The section's existing instructions then apply to it (state the plan as the reason; point at Subscription & Billing).
2. **`platform_help`.** Its plan-limit answer names them in one list, `(gis; registered by your organization: acme, crm)`: custom packs sit under their own label since one can share a built-in pack's slug. That answer also follows whichever other answer leads (missing attachments, no records); it used to be given only when nothing else matched, which hid the plan on a station with a second problem.
3. **`station_context`.** `toolPacks` gains `customNotInPlan: string[]`, described in the tool's description next to `unentitled`.

## Decision — how such a station is described

Before this, a station was either "set up for data" or not. Neither fits a station whose only data-capable packs are excluded by the plan, and review went back and forth: counted as set up for data, it is told to attach a view no tool could read; counted as not, it is told "that is how it is set up" beside "the plan is the reason". So there are three states (`stationDataSetup`, `apps/api/src/utils/station-data-packs.util.ts`), read by the prompt and `platform_help` alike:

| State | When | What leads |
|---|---|---|
| `usable` | a pack whose tools exist in the session works on data | missing views or connectors, if any (as before) |
| `plan-excluded` | packs that work on data are attached, and the plan excludes every one | the plan limit; no "attach a view" advice |
| `none` | no pack on the station works on data | "that is how it is set up, not a fault" (#848) |

**This applies to built-in packs too.** A station whose only data pack is an excluded built-in one used to get the missing-attachments line (#848 pinned it); it now leads with the plan, like the custom case.

A custom pack counts as working on data (a custom tool can take records as input). An excluded one counts by its resolved name, so an attachment whose pack row is gone classifies nothing, in the prompt and in `platform_help` alike.

Pack lists have a defined order: the station's attachment rows are read oldest first, and both custom-pack lists are sorted by name. Without one, the prompt's lists could reorder between turns.

## Plan — one slice

**Files**
- Edit: `organization-toolpacks.repository.ts` — `findNamesByIds(ids, { organizationId })`.
- Edit: `station-toolpacks.repository.ts` — `findByStationId` orders by `created, id`.
- Edit: `entitlement.service.ts` — `excludedCustomPacks` on `StationPackSplit`, filled in the shared read; custom packs sorted.
- Edit: `apps/api/src/utils/station-data-packs.util.ts` — `stationDataSetup`.
- Edit: `apps/api/src/services/portal.service.ts` — carry the names into the prompt context.
- Edit: `system.prompt.ts` — the plan-limit section, and the Available Data block's three states.
- Edit: `platform-help.tool.ts` (the three states, the list, the trailing plan note), `station-context.tool.ts` (field, type and description).

**Tests** (written first; `npm run test:unit -- --testPathPattern "station-data-packs|entitlement.service|system.prompt|platform-help|station-context|portal.service"` in `apps/api`)
- `station-data-packs.util.test.ts`: the three states.
- `entitlement.service.test.ts`: names returned, sorted, when the plan excludes custom packs; empty when it includes them or none are attached; the decrypting read is not called for them; usable custom packs sorted.
- `system.prompt.test.ts`: the plan section renders for an excluded custom pack alone and names it; "Organization-Provided Tools" never lists it; a station whose only data-capable pack is plan-excluded (built-in or custom) leads with the plan and has no missing-attachments line; with a usable data pack beside it the missing line stays.
- `platform-help.tool.test.ts`: the plan answer names it; the plan leads on a `plan-excluded` station; the plan note follows another lead; the list format; a custom attachment whose row is gone counts for nothing.
- `station-context.tool.test.ts`: `customNotInPlan` is returned.
- Integration (`npm run test:integration -- --testPathPattern "organization-toolpacks.repository|station-toolpacks.repository"`): the names read is org-scoped and skips deleted rows; `findByStationId` returns oldest first.
- Then `npm run lint`, `npm run type-check`, `npm run format:check`.

## Smoke (manual, against your dev stack)

Needs an org on a plan with custom packs (enterprise), one custom pack registered and attached to a station, then the org moved to a plan without them (`portalai org set-tier <org> standard`; wait a minute for the plan cache or restart the API).

Registering a pack in the app fetches its schema from a reachable webhook. Without one, a pack row can be created through `DbService.repository.organizationToolpacks.create` (so its credential columns are encrypted) and attached with `PATCH /api/stations/<id>` and `toolPacks: [..., "org:<packId>"]`. The steps below only list the pack's tools; they never call them.

1. Before the downgrade, on that station: "What tools do you have from the <pack> pack?" The assistant lists them.
2. After the downgrade, same station, new portal: "Why did the <pack> tools stop working?" The assistant says the <pack> pack isn't included in the organization's current plan and points at Settings → Subscription & Billing. It doesn't say the station lacks the pack or suggest attaching it.
3. Same portal: "What can I do on this station?" The answer doesn't offer the pack's tools, and if it mentions the pack it says the plan excludes it. Then: "Check with platform help and the station context: which tool packs on this station aren't working, and why?" Both tools name the pack as a plan limit. On a station where it is the only data-capable pack, `platform_help`'s answer opens with the plan limit and doesn't suggest attaching views or connectors.
4. Move the org back to the plan with custom packs. A new portal lists the pack's tools again and doesn't mention a plan limit.
5. The built-in case. On the plan with every pack, give a station only a built-in data pack the smaller plan lacks (GIS) plus a pack that doesn't work on data (Curated Views), leave it without views, then move the org to the smaller plan. Ask: "Why can't I make a map here?" and have it quote platform help on why answers are empty. Both name `gis` as a plan limit; neither opens with missing views.

## Out of scope

- **A station pointing at a custom pack that no longer exists.** The prompt goes by the pack rows that resolve and `platform_help` by the count of attached ids, so they can differ for a dangling row. Rare, and a different cause.
- **Showing excluded custom packs in the web app.** The station page's chips for them are unchanged.
- **The station page's own notice.** It still says "No views are attached to this station. Attach a view to query entity data here." on a station whose data packs are all excluded by the plan, where the assistant now leads with the plan. The notice comes from shared copy that knows only attachment counts; making it plan-aware is a web change.
- **The prompt and the session's tools resolve the plan separately.** Across a plan change within one turn they could disagree about a pack. That is how built-in packs already work.
