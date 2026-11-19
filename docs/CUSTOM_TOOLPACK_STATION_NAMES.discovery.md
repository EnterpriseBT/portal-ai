# Custom tool packs on a station: names and plan treatment — Discovery

**Issue:** [EnterpriseBT/portal-ai#1063](https://github.com/EnterpriseBT/portal-ai/issues/1063)

**Why this exists.** A station stores its tool packs as bare refs: a built-in slug, or `org:<uuid>` for a custom pack. Only the web turns a custom ref into a name, by looking it up in `GET /api/toolpacks`. That route is class-gated to owners and admins (#630), so a member who can read a station (or edit it) sees `org:<uuid>` on the station page. In Edit Station they see "1 tool pack on this station can't be changed here." with nothing to say which pack. Their portal sessions on that station still run the pack's tools, because the runtime admits custom packs by plan, not by the caller's read on the pack.

There's a second gap beside it. When the org's plan drops `customToolpacks`, the runtime drops every custom pack from the session, but the web still renders them as active, and the station update lets a custom pack be added anyway. Built-in packs have had the "not included in your plan" treatment since #284/#1052. This ticket makes **reading a station convey the names of the packs attached to it**, and gives custom packs the same plan treatment built-ins get.

## The current shape

### Station contract and routes

| Piece | Location | Note |
|---|---|---|
| `StationWithToolpacksSchema` | `packages/core/src/contracts/station.contract.ts:31` | `enabledToolpacks: string[]` of bare refs, no names. List (`:37`) and get (`:101`) payloads wrap it with `withShareableCapabilities`. Create (`:136`) and update (`:200`) responses reuse it. |
| `UpdateStationBodySchema` | `station.contract.ts:176` | `.strict()`. `toolPackChanges: {add?, remove?}` (`:157`); an id can't be in both (`:164`). |
| GET list | `apps/api/src/routes/station.router.ts:320` → `StationQueryService.listForCaller` (`apps/api/src/services/station-query.service.ts:44`) | `enabledToolpacks` comes from one grouped `findByStationIds` read (`:79-95`). The `station_list` tool reads the same listing. |
| GET by id | `station.router.ts:426` | Maps `stationToolpacks.findByStationId` rows to `builtinSlug ?? "org:"+id` (`:477-483`). |
| POST | `station.router.ts:595-680` | `parseToolpackRefs` (`:92`) checks custom ids exist in the org. `denyUnentitledBuiltins` (`:138`) checks built-ins only. |
| PATCH | `station.router.ts:782`, `planToolPackChanges` (`:196`) | A custom add must be readable by the caller (`:240`), else 400 `STATION_INVALID_TOOLPACK`. A custom remove the caller can't read is dropped (`:256`). The plan check is `EntitlementService.splitBuiltinPacks(add.builtinSlugs)` (`:260`), so `org:` refs are never plan-checked. In the transaction, `live` is built from `builtinSlug` only (`:881`) and `denied = unentitled − live` (`:882`), throwing `toolpacksNotEntitled` (`:154`): 403 `STATION_TOOLPACK_NOT_ENTITLED`. |

### Entitlements and names

| Piece | Location | Note |
|---|---|---|
| `findNamesByIds` | `apps/api/src/db/repositories/organization-toolpacks.repository.ts:306` | Selects id and name only, org-scoped, skips deleted rows, never decrypts (#1045). |
| `readStationPacks` | `apps/api/src/services/entitlement.service.ts:207` | Already names custom packs when the plan excludes them (`excludedCustomPacks`, `:237-246`). |
| `splitBuiltinPacks` | `entitlement.service.ts:95` | Treats every non-built-in ref as unentitled, which is why `org:` refs are kept away from it (`:143`). |
| `customToolpacks` | `packages/core/src/models/tier.model.ts:72` | Off on standard and plus, on for pro and enterprise (`packages/core/src/registries/tier-catalog.ts`). |
| Runtime | `apps/api/src/services/tools.service.ts:532-536`, `:951` | Custom packs enter a session only when `customToolpacks` is true; otherwise they're dropped silently. |
| Agent surfaces | `apps/api/src/tools/station-context.tool.ts:215-228`, `apps/api/src/tools/curated-views/station-list.tool.ts:82` | `station_context` already returns `custom` and `customNotInPlan` with names. `station_list` returns raw `toolpacks: s.enabledToolpacks`. |

### Web

| Piece | Location | Note |
|---|---|---|
| `ToolPackChipWithMetadata` | `apps/web/src/components/ToolPackChipWithMetadata.component.tsx:24,116,132` | Names `org:` refs from `sdk.toolpacks.list()`. A 403 leaves no label (the chip falls back to the ref via `ToolPackUtil.getLabel`, `apps/web/src/utils/tool-packs.util.ts:26`). `entitled` defaults to `isEntitled`, which is built-in only. |
| Plain chips | `StationList.component.tsx:152`, `DefaultStationCard.component.tsx:128`, `PortalHeaderMeta.component.tsx:117,160` | Plain `ToolPackChip` with no lookup, so even admins see `org:<uuid>` in these places. |
| Entitlement helpers | `tool-packs.util.ts:59,69,81`; `apps/web/src/utils/use-builtin-entitlements.util.ts:38,46` | `isBuiltinPackEntitled` treats any non-built-in ref as entitled. `useBuiltinEntitlements` already exposes `customPacksEntitled`. |
| Station detail | `apps/web/src/views/StationDetail.view.tsx:58,245-265,302,378` | Tool Packs row, attachment notice (`stationDataSetupFor`, `tool-packs.util.ts:96`, which names excluded custom packs only as "Your organization's tool packs"), Edit Station. |
| Edit Station | `apps/web/src/components/EditStationDialog.component.tsx:59,243,274-285,418,429` | Custom options come from the 403-ing list. `unshownPacks` feeds the count line and is preserved across edits. `withEntitlements` and `ToolPackUpgradeNoteUI` cover built-ins only. |

## The design space

### Decision 1 — Where names travel

**A. Station responses carry the names.** Add a `toolpacks: [{ ref, kind, name }]` array beside `enabledToolpacks` on every station response (list, get, create, update), resolved from the station's own refs: built-in names from the registry, custom names from `findNamesByIds`.

**B. A narrow names endpoint.** `GET /api/stations/:id/toolpacks` returns names for that station's refs. The web calls it next to the station read.

**C. Open `GET /api/toolpacks` to members**, filtered to names.

| | A | B | C |
|---|---|---|---|
| Authorization | Inherits the station read: one rule | Its own route and route-map entry | Re-opens the #630 class gate and leaks every pack in the org |
| Covers list cards and portal header | Yes, the list carries it | Needs a call per card | Yes, but at the cost above |
| Extra query | One batched `findNamesByIds` per response | One per station | None |

**Lean: A.** Reading a station conveys what's attached to it, the same way a curated view conveys its projection (#829). Only the name, ref and kind are exposed: never endpoints, headers or secrets, and never other packs.

### Decision 2 — Shape of the new field

**A. `toolpacks: [{ ref, kind: "builtin" | "custom", name }]`**, kept beside `enabledToolpacks`.
**B. `toolpackNames: Record<ref, string>`.**
**C. Replace `enabledToolpacks` with the richer array.**

| | A | B | C |
|---|---|---|---|
| Order and kind explicit | Yes | No | Yes |
| Callers that compare refs | Untouched | Untouched | Every one rewritten (Edit Station, chips, tests) |
| Room for later fields | Yes (entitlement) | Awkward | Yes |

**Lean: A.** It's additive, and it carries the kind the web otherwise re-derives from the `org:` prefix. Removing `enabledToolpacks` isn't required by this bug.

### Decision 3 — Who resolves plan status for custom packs

**A. The server adds `entitled: boolean` to each `toolpacks` item**, from the org's tier.
**B. The web derives it** from `useBuiltinEntitlements().customPacksEntitled` (already read from `organizations.usage()`), alongside its existing built-in derivation.

| | A | B |
|---|---|---|
| One rule for built-ins and custom | Moves both server-side, or splits the rule | Matches how built-ins work today |
| Extra server read | A tier lookup on every station read | None |
| Stale after a plan change | Until the station refetches | Until usage refetches (the same as built-ins today) |

**Lean: B.** Built-ins already take their plan status from `useBuiltinEntitlements`. Custom packs should go through the same helper (`isPackEntitled(ref, entitlements)`), so the chip, the picker and the notice change in one place.

### Decision 4 — Plan check on the station write

Today the PATCH and POST guards only see built-ins. Options: **A.** Add a custom branch: when `customToolpacks` is false, refuse any `org:` add that isn't already attached, with the same 403 `STATION_TOOLPACK_NOT_ENTITLED` naming the packs. **B.** Leave writes ungated and rely on the runtime dropping them.

**Lean: A.** The issue decided it, and B is what lets a station show a pack that never runs. Removal stays unconditional, and a re-add of an attached pack stays a no-op. That means fixing `live` at `station.router.ts:881` to include custom rows (`builtinSlug ?? "org:"+id`).

## Tradeoff comparison

|  | D1: names on station responses | D2: `toolpacks[]` beside refs | D3: web derives plan status | D4: server refuses unentitled custom adds |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |

## Recommendation

1. Every station response (list, get, create, update) carries `toolpacks: { ref, kind, name }[]` beside `enabledToolpacks`. Built-in names come from the registry, custom names from one org-scoped `findNamesByIds` call per response. A ref whose custom pack is deleted or missing gets no item, and the web keeps its ref fallback.
2. `StationQueryService.listForCaller` batches names across the page's stations into one `findNamesByIds` call. GET by id, POST and PATCH use the same helper.
3. Register the field in `swagger.config.ts` (the hand-written `Station` and `StationListResponse` and the Zod-generated payloads) and extend `swagger.config.test.ts`.
4. The web chip prefers the station's own name for a ref and falls back to the list lookup only for surfaces that have no station. `StationList`, `DefaultStationCard` and `PortalHeaderMeta` pass the name too.
5. One web helper decides a pack's plan status: built-ins as today, and `org:` refs entitled exactly when `customPacksEntitled`. The chip, the Edit Station picker, `ToolPackUpgradeNote` and `stationDataSetupFor` all use it. Excluded custom packs are named by their real names, not "Your organization's tool packs".
6. Edit Station's count line names the packs it can't change ("Acme CRM can't be changed here.").
7. POST and PATCH refuse adding a custom pack the plan excludes, with 403 `STATION_TOOLPACK_NOT_ENTITLED`. Removal always works, and a re-add of an attached pack is a no-op (`live` includes custom rows).
8. `station_list` returns names next to refs. `station_context` already does.

## Open questions

1. **Does `station_list` need names?** It returns refs today, and an agent can't do anything with `org:<uuid>`. **Lean: yes.** Return `toolpacks: [{ ref, name }]` from the same listing. It's free, because the listing now carries names.
2. **Should a member's Edit Station offer the station's attached custom packs as options** (so they can remove them), now that names are known? Today PATCH drops a remove the caller can't read (`station.router.ts:256`). **Lean: no.** Naming is read, removing is write on the pack. Keep the "can't be changed here" line, now with names.
3. **The plan-excluded copy for custom packs.** It currently says "Your organization's tool packs" (`packages/core/src/content/station-attachments.util.ts:48`). **Lean: name them**, using the same sentence shape as built-ins, so #1055's notice reads the same for both.
4. **Does the create path (POST) need the plan check too,** or only PATCH? POST takes refs through `parseToolpackRefs` with no plan check. **Lean: both.** A new station is the easiest way in.

## Enterprise-scale considerations

- **Concurrency & correctness.** The plan check runs inside PATCH's existing transaction and station row lock, beside the built-in check. Lean: reuse it; no new lock.
- **Accuracy & auditability.** N/A because no billing record or ledger changes. The runtime already enforces the plan; this makes the UI and the write path agree with it.
- **Failure modes.** If `findNamesByIds` fails, the station read fails with it (same transaction semantics as today's toolpack read). Lean: fail with the read, not partially; a name is part of the payload's contract.
- **Scale & unbounded growth.** One extra query per response, batched over the page. Names are bounded by the station's pack count. Lean: no cap needed.
- **Multi-tenancy.** `findNamesByIds` is org-scoped and the refs come from the station's own rows, never from input. Lean: no cross-org path; a test pins it.
- **Contract stability.** An additive field. `kind` and an object item leave room for later fields without another contract change. Lean: additive only.
- **Data lifecycle.** N/A because nothing new is stored.

## What this doesn't decide

- Opening `GET /api/toolpacks` to members. #630's class gate stays.
- Whether a member's session should run a custom pack they can't read. The issue lists it as an impact, but the station's owner chose the pack, and the plan rule governs the runtime. A per-caller read on tools is a separate RBAC question.
- Removing `enabledToolpacks` in favour of `toolpacks`. That's a cleanup for later, not part of this bug.

## Next step

`docs/CUSTOM_TOOLPACK_STATION_NAMES.spec.md` pins the `toolpacks` field, the write refusal and the web helper. `docs/CUSTOM_TOOLPACK_STATION_NAMES.plan.md` slices it roughly as: (1) core contract plus API names on every station response, with swagger; (2) the API plan check for custom adds; (3) the web chip and list surfaces use the names; (4) the web plan helper, Edit Station's picker, count line and notice; (5) `station_list` names.
