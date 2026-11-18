# Custom tool packs on a station: names and plan treatment — Plan

**This plan implements #1063's contract in TDD order.** First the API names a station's packs on every station response and refuses a custom pack the plan excludes. Then the web uses those names and treats custom packs the way the plan says.

Spec: `docs/CUSTOM_TOOLPACK_STATION_NAMES.spec.md`. Discovery: `docs/CUSTOM_TOOLPACK_STATION_NAMES.discovery.md`. Issue: #1063. It builds on #1045 (`findNamesByIds`), #1052 (`toolPackChanges`) and #1055 (`stationDataSetupFor`).

The work is 5 slices. Each sits behind a green test suite and leaves the repo compilable. They land as **commits on `fix/1063-custom-toolpack-station-names`**: one feature, one PR (#1074).

Run tests from each package with a path filter. Never invoke jest directly.

```bash
cd packages/core && npm run test:unit -- --testPathPattern <file>
cd apps/api && npm run test:unit -- --testPathPattern <file>
cd apps/api && npm run test:integration -- --testPathPattern station.router
cd apps/web && npm run test:unit -- --testPathPattern <file>
```

Each slice:
1. Write the failing tests.
2. Make the smallest change that turns them green.
3. Run the focused tests.
4. Run `npm run lint && npm run type-check` in each touched package. After a core change, rebuild core (`npm run build` in `packages/core`) before running API or web tests, since they read core's `dist`.
5. Move to the next slice.

Sequencing rationale:
- **Slice 1** is the contract and the names. Everything else reads `toolpacks`.
- **Slice 2** is the server plan check. It's independent of the names, but goes second so the API half closes before the web begins.
- **Slice 3** is `station_list`. It needs slice 1's listing field and is small enough to land on its own with its description surfaces.
- **Slice 4** is the web names. It needs slice 1's field on the wire.
- **Slice 5** is the web plan treatment. It needs slice 4's label helper, and slice 2 makes its picker and the server agree.

---

## Slice 1 — `toolpacks` on every station response

Core gains `StationToolpackSchema` and the field. The new names service fills it on list, get, create and update, and swagger documents it.

**Files**

- Edit: `packages/core/src/contracts/station.contract.ts`. Adds `StationToolpackSchema`, `StationToolpack`, and `toolpacks` on `StationWithToolpacksSchema`.
- New: `apps/api/src/services/station-toolpack-names.service.ts`. Holds `forStations` and `forRefs`.
- Edit: `apps/api/src/services/station-query.service.ts`. `listForCaller` sets `toolpacks`, and `StationListRow` gains it.
- Edit: `apps/api/src/routes/station.router.ts`. GET by id, POST and PATCH set `toolpacks`.
- Edit: `apps/api/src/config/swagger.config.ts`. `Station.properties.toolpacks`, plus `StationToolpack` registered in `stationSchemas`.

**Steps**

1. **Tests:**
   - Core: `station.contract.test.ts`, 2 cases (`toolpacks` parses; an unknown `kind` is refused).
   - API unit: `station-query.service.test.ts`, 3 cases (ref order, one `findNamesByIds` call per page, a missing custom pack gets no item).
   - Swagger: `swagger.config.test.ts`, 2 cases.
   - Integration, in the new `describe("custom tool pack names and plan (#1063)")` in `station.router.integration.test.ts`: spec cases 1 to 4 (member GET by id with exactly `ref`/`kind`/`name`, list names, the other org's pack isn't named, POST and PATCH responses).

   Run them; they fail.
2. **Implement:**
   - Add the schema.
   - Add the service, with one deduped `findNamesByIds` call and the item rules from the spec.
   - Have `listForCaller` call `forStations`, and have the three routes call `forRefs`.
   - Add the swagger entries.

   Green.
3. Rebuild core, then lint and type-check core and API.

**Done when:** every station response carries `toolpacks`. A member's GET names a custom pack, and swagger documents the field. The web isn't touched yet, and the optional field changes nothing there.

**Risk:** the "other org's pack" case needs a `station_toolpacks` row inserted through the repository. No route can make one, and that's the point. Insert it directly in the test.

---

## Slice 2 — refuse a custom pack the plan excludes

On a plan without `customToolpacks`, POST and PATCH refuse a newly added custom pack with 403 `STATION_TOOLPACK_NOT_ENTITLED`, naming it. Removal and a re-add of an attached pack still work.

**Files**

- Edit: `apps/api/src/services/entitlement.service.ts`. Adds `customPacksEntitlement(organizationId)`.
- Edit: `apps/api/src/routes/station.router.ts`:
  - `parseToolpackRefs` returns `customNames`, and a new `denyUnentitledCustom` runs before the POST insert;
  - `ToolPackChangePlan.unentitled` becomes `{ ref, label }[]`, and `planToolPackChanges` adds excluded custom adds to it;
  - `live` in the PATCH transaction is a set of refs, which fixes the custom re-add case;
  - the log line becomes "Station write denied unentitled toolpacks";
  - the POST and PATCH 403 `@openapi` text covers custom packs.

**Steps**

1. **Tests:**
   - `entitlement.service.test.ts`: 3 cases (true on pro, false on standard, throws when the policy can't be resolved).
   - Integration spec cases 5 to 9: POST refused with the name and no station row; PATCH add refused; re-add of an attached pack answers 200 with no change; removal answers 200; a pro tier still adds.

   The existing #284 and #1052 entitlement tests must stay green: built-in messages are unchanged because a built-in's `label` is its slug.

   Run them; they fail.
2. **Implement** the method, the POST guard, the PATCH plan entries and the ref-based `live` set. Green.
3. Lint and type-check the API, then run `station-attachments.router.integration.test.ts` as well. Its #1052 member cases cover custom packs, and they must still pass.

**Done when:** spec cases 5 to 9 pass, and the old entitlement and #1052 suites are unchanged and green.

**Risk:**
- To attach an excluded custom pack for the re-add and remove cases, the fixture has to put it on the station while the tier allows it, then downgrade. Set up the station on pro and flip the org's tier afterwards.
- `planToolPackChanges` runs before the transaction (#698). The new tier read stays there, so no connection is held while waiting on it.

---

## Slice 3 — `station_list` names its packs

The agent's station listing returns `toolpacks: [{ ref, name }]`.

**Files**

- Edit: `apps/api/src/tools/curated-views/station-list.tool.ts`. Changes the output (`:82`) and the description ("its tool packs, each a ref and a name (check for the data_query ref …)").
- Edit: `packages/core/src/registries/builtin-toolpacks.ts:1654`. The hand-authored mirror of that description changes to match.

**Steps**

1. **Tests:** `curated-view-tools.test.ts`, 1 case (the output shape). Update any `builtin-toolpacks.test.ts` or `system.prompt.test.ts` pin that quotes the old description. Run; fail.
2. **Implement** the change. Green. `builtin-toolpack-schema-parity.test.ts` is unaffected, since parameters don't change.
3. Rebuild core, then lint and type-check core and API.

**Done when:** `station_list` returns names, and the tool and its mirror read the same.

**Risk:** none. `system.prompt.ts` names `station_list` only for finding a station's id (`:739`), not for its packs.

---

## Slice 4 — names on every web chip

Members see a custom pack's name wherever a station's packs render.

**Files**

- Edit: `apps/web/src/utils/tool-packs.util.ts`. Adds `stationToolpackLabels`.
- Edit: `apps/web/src/components/ToolPackChipWithMetadata.component.tsx`. Adds the `name` prop, and the label is `toolpack?.name ?? name`.
- Edit: `apps/web/src/views/StationDetail.view.tsx`, `components/PortalHeaderMeta.component.tsx`, `components/StationList.component.tsx`, `components/DefaultStationCard.component.tsx`. Each passes `name` (to `ToolPackChipWithMetadata`) or `label` (to a plain `ToolPackChip`), from `stationToolpackLabels(station.toolpacks)`.

**Steps**

1. **Tests:**
   - `ToolPackUtil.test.ts`: `stationToolpackLabels`, 1 case.
   - `ToolPackChipWithMetadata.test.tsx`: 2 cases (`name` is used when the list is refused; the list's name wins when both exist).
   - `StationList.test.tsx` and `DefaultStationCard.test.tsx`: one name case each.
   - `StationDetail.view.test.tsx` and `PortalHeaderMeta.component.test.tsx`: a member sees the name.

   Each keeps its axe assertion green. Run; fail.
2. **Implement** the change. Green.
3. Lint and type-check the web.

**Done when:** no station surface shows `org:<uuid>` for a pack that exists. Plan treatment for custom packs isn't there yet; it's slice 5's.

**Risk:** web tests mock `sdk` modules partially. Add `toolpacks` to their station fixtures rather than widening the mocks.

---

## Slice 5 — custom packs get the plan treatment in the web

One predicate covers both kinds of pack. The pickers disable excluded custom packs, the upgrade note covers them, Edit Station's count line names what it can't change, and the station notice names excluded custom packs.

**Files**

- Edit: `apps/web/src/utils/tool-packs.util.ts`:
  - adds `isPackEntitled`;
  - `stationDataSetupFor` takes `labels`, names excluded custom packs, and drops `STATION_PLAN_EXCLUDED_CUSTOM_PACKS`.
- Edit: `apps/web/src/utils/use-builtin-entitlements.util.ts`. `isEntitled` uses `isPackEntitled`.
- Edit: `packages/core/src/content/station-attachments.util.ts`. Deletes the constant and its special cases in `listPacks` and `planExcludedSentence`.
- Edit:
  - `components/StationList.component.tsx`, `components/DefaultStationCard.component.tsx`: use `isPackEntitled`;
  - `views/StationDetail.view.tsx`, `components/PortalHeaderMeta.component.tsx`: pass `labels` to `stationDataSetupFor`;
  - `views/Stations.view.tsx` and the dialogs' containers: pass `customPacksEntitled`.
- Edit: `components/EditStationDialog.component.tsx`, `components/CreateStationDialog.component.tsx`:
  - a `customPacksEntitled` prop;
  - custom options disabled with `UNENTITLED_PACK_REASON`;
  - the upgrade-note condition;
  - Edit's named count line through `Intl.ListFormat`.

**Steps**

1. **Tests:**
   - `station-attachments.util.test.ts` (core): 4 cases, and drop the sentinel cases.
   - `ToolPackUtil.test.ts`: `isPackEntitled`, 4 cases; `stationDataSetupFor` with a named and an unnamed custom pack.
   - `StationList.test.tsx` and `DefaultStationCard.test.tsx`: an excluded custom pack is muted.
   - `EditStationDialog.test.tsx`: the six spec cases, axe included.
   - `CreateStationDialog.test.tsx`: 1 case.
   - `StationDetail.view.test.tsx` and `PortalHeaderMeta.component.test.tsx`: the excluded pack is muted and named in the notice.

   Run; fail.
2. **Implement** the change. Green.
3. Rebuild core, then lint and type-check core and web. Grep `STATION_PLAN_EXCLUDED_CUSTOM_PACKS` to confirm nothing still uses it.

**Done when:** on a plan without custom packs, every surface marks them not included and names them. Adding one from the UI is blocked, and removing one still works.

**Risk:** existing `EditStationDialog` and `StationDialogCollisions` tests render with custom options and no `customPacksEntitled`. The prop defaults to `true`, so they stay as they are.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | `toolpacks` on station responses, names service, swagger | core + API unit, station router integration 1–4 |
| 2 | Custom-pack plan check on POST/PATCH | entitlement unit, integration 5–9, #284/#1052 suites green |
| 3 | `station_list` names + description mirror | curated-view tools test, pinning tests |
| 4 | Names on every web chip | chip, list, card, detail, header tests |
| 5 | Web plan treatment: predicate, pickers, note, count line, notice | util, dialog, view tests, axe |

## Cross-slice notes

- **The core rebuild is easy to forget.** Slices 1, 3 and 5 change core. API and web tests read core's `dist`, and the API dev server doesn't pick up a core rebuild without a restart.
- **The full root build runs at the end** (`npm run build`, then `npm run type-check` at the root). A new core field reaches web and site fixtures that type-check alone misses.
- **Doc sync:**
  - The tool description and its mirror change in slice 3.
  - The plan-excluded sentence changes in slice 5.
  - No glossary or FAQ entry describes a station's pack names. I'll check `faq.util.ts` for any wording about custom packs on a station when slice 5 lands.
  - `docs/CUSTOM_TOOLPACK_INTEGRATION.md` doesn't cover stations, so it isn't touched.
- **The ACR.** Slice 5 adds a disabled reason and an announced count line using existing patterns: `aria-disabled` options with a reason, and helper text. That's no new interactive pattern, so `docs/ACCESSIBILITY_CONFORMANCE_REPORT.md` is unchanged.

## Next step

Implementation starts on this branch with slice 1, tests first, one commit per slice, once this plan is confirmed.
