# Custom tool packs on a station: names and plan treatment — Spec

**Issue:** [EnterpriseBT/portal-ai#1063](https://github.com/EnterpriseBT/portal-ai/issues/1063) · **Discovery:** `docs/CUSTOM_TOOLPACK_STATION_NAMES.discovery.md`

This spec pins three things:
- the `toolpacks` field every station response gains;
- the server's refusal of a custom pack the plan excludes;
- the web helpers that name custom packs and give them the same plan treatment as built-ins.

## Key decisions (flag for review)

1. **Names come with the station read** (D1). Every station response (list, get, create, update) carries `toolpacks: { ref, kind, name }[]`, resolved from the station's own rows. `GET /api/toolpacks` stays owner/admin-only (#630).
2. **The field is additive** (D2). `enabledToolpacks` stays as it is.
3. **The web decides plan status** (D3). It already reads `customToolpacks` through `useBuiltinEntitlements`, so one predicate covers both kinds of pack.
4. **The server refuses a new custom pack the plan excludes** (D4), on both POST and PATCH (Q4). It answers with the existing 403 `STATION_TOOLPACK_NOT_ENTITLED`. Removing a pack always works, and re-adding an attached one is a no-op. Custom packs now count in `live`.
5. **Names, never more.** Only id and name are read, through `findNamesByIds`: org-scoped, no decryption (#1045). No endpoint, header or secret leaves.
6. **`station_list` returns names** (Q1). Members still can't remove a custom pack they can't read (Q2), and their count line names those packs. The plan sentence uses real names, and `STATION_PLAN_EXCLUDED_CUSTOM_PACKS` is deleted (Q3).

## Scope

### In scope
- Core: `AttachedToolpackSchema` and `toolpacks` on `StationWithToolpacksSchema`.
- API:
  - names on all four station responses;
  - the plan check for custom adds on POST and PATCH;
  - `EntitlementService.customPacksEntitlement`;
  - `station_list` output;
  - swagger.
- Web:
  - `isPackEntitled`;
  - chip names on the station page, station list, default-station card and portal header;
  - the Create and Edit Station pickers, Edit Station's count line and the upgrade note;
  - `stationDataSetupFor` names.
- Core content: `listPacks` / `planExcludedSentence` without the sentinel.

### Out of scope
- Opening `GET /api/toolpacks` to members.
- Per-caller read checks on a session's custom tools.
- Removing `enabledToolpacks`.
- Members removing a custom pack they can't read.

## Surface

### Core — `packages/core/src/contracts/station.contract.ts`

```ts
/** #1063: a pack attached to a station, named for anyone who can read it. */
export const AttachedToolpackSchema = z.object({
  ref: z.string(),                       // built-in slug or `org:<uuid>`
  kind: z.enum(["builtin", "custom"]),
  name: z.string(),
});
export type AttachedToolpack = z.infer<typeof AttachedToolpackSchema>;

export const StationWithToolpacksSchema = StationSchema.extend({
  enabledToolpacks: z.array(z.string()).optional(),
  /** #1063: the attached packs with their names, in `enabledToolpacks` order. */
  toolpacks: z.array(AttachedToolpackSchema).optional(),
});
```

List, get, create and update payloads inherit the field. It is optional on the schema, like `enabledToolpacks`, and every route always sets it.

**Item rules**, applied to the station's refs in order:
- A built-in slug gives `kind: "builtin"`, named from `BUILTIN_TOOLPACK_BY_SLUG[slug].name`.
- A retired or unknown slug gives `kind: "builtin"` with `name` set to the slug.
- An `org:<id>` whose pack is live in the station's org gives `kind: "custom"` with the pack's name.
- An `org:<id>` with no live pack in the org gives **no item**. The ref stays in `enabledToolpacks`, and the web falls back to the ref.

### API — `apps/api/src/services/station-toolpack-names.service.ts` (new)

```ts
export class StationToolpackNamesService {
  /** Names for many stations' refs with ONE findNamesByIds call. */
  static async forStations(
    organizationId: string,
    refsByStation: ReadonlyMap<string, readonly string[]>,
    client?: DbClient
  ): Promise<Map<string, AttachedToolpack[]>>;
  /** One station's refs. */
  static async forRefs(
    organizationId: string,
    refs: readonly string[],
    client?: DbClient
  ): Promise<AttachedToolpack[]>;
}
```

- Custom ids are deduped across the stations before the single `organizationToolpacks.findNamesByIds(ids, { organizationId })` call.
- Empty input makes no query, because `findNamesByIds` returns `[]` for an empty list.
- **Org scope:** refs come only from `station_toolpacks` rows, and the name lookup is scoped by `organizationId`. A row pointing at another org's pack therefore gets no item.

### API — station routes and listing

- `StationQueryService.listForCaller` (`apps/api/src/services/station-query.service.ts:44`): after building `toolpacksByStationId`, it calls `forStations` and sets `toolpacks` on each row. `StationListRow` gains `toolpacks: AttachedToolpack[]`.
- GET `/api/stations/:id` (`station.router.ts:426`), POST (`:595`) and PATCH (`:782`) each set `toolpacks: await StationToolpackNamesService.forRefs(organizationId, enabledToolpacks)` beside `enabledToolpacks`.
- `@openapi`: the hand-written `Station` schema (`apps/api/src/config/swagger.config.ts:1992`) gains `toolpacks` (an array of `$ref: '#/components/schemas/AttachedToolpack'`, not required). Register `AttachedToolpack: z.toJSONSchema(AttachedToolpackSchema)` in `stationSchemas` (`:607`). `StationGetResponsePayload` picks it up from Zod.

### API — plan check for custom packs

`EntitlementService` (`apps/api/src/services/entitlement.service.ts`) gains:

```ts
/** Whether the org's tier includes custom packs (#214), with the tier slug
 *  for the refusal log. Fail-closed like splitBuiltinPacks: an unresolvable
 *  policy throws. */
static async customPacksEntitlement(
  organizationId: string
): Promise<{ entitled: boolean; tier: string }>;
```

**POST** (`station.router.ts:600-620`):
- `parseToolpackRefs` also returns `customNames: string[]`, taken from the `findManyByIds` rows it already loads, in request order.
- After `denyUnentitledBuiltins` and before the insert, a new `denyUnentitledCustom(organizationId, customNames)` refuses with `toolpacksNotEntitled(organizationId, tier, customNames)` when the list isn't empty and the tier excludes custom packs.
- A refusal leaves no station row.

**PATCH**:
- `ToolPackChangePlan.unentitled` becomes `{ ref: string; label: string }[]`.
  - A built-in has `ref = label = slug`, the existing message.
  - A custom pack has `ref = "org:<id>"`, and its label is the pack's name from the `packs` rows `planToolPackChanges` already loads.
- `planToolPackChanges` (`:196`) calls `customPacksEntitlement` only when `add.organizationToolpackIds` isn't empty after the readability check. When the tier excludes custom packs, each added custom pack goes into `unentitled`.
- In the transaction (`:881`), `live` becomes the set of refs: `r.builtinSlug ?? "org:" + r.organizationToolpackId`. `denied` is the `unentitled` entries whose `ref` isn't live, and the error lists their `label`s. Removals are never checked.
- `toolpacksNotEntitled` keeps its signature and message ("Tool pack(s) not included in your plan: A, B"). Its log line becomes "Station write denied unentitled toolpacks".
- The `@openapi` 403 descriptions on POST and PATCH say custom packs are covered.

### API — `station_list` tool (`apps/api/src/tools/curated-views/station-list.tool.ts:82`)

```ts
toolpacks: s.toolpacks.map(({ ref, name }) => ({ ref, name })),
```

The description changes "its tool packs (check for data_query …)" to "its tool packs, each a ref and a name (check for the data_query ref …)". Check the hand-authored mirror in `packages/core/src/registries/builtin-toolpacks.ts`, and `system.prompt.ts` wherever it mentions `station_list`'s toolpacks.

### Web — entitlement predicate (`apps/web/src/utils/tool-packs.util.ts`)

```ts
/** #1063: one plan rule for both kinds. Built-in: in the entitled set.
 *  `org:` ref: the plan's customToolpacks. Anything else: entitled. */
export function isPackEntitled(
  pack: string,
  entitledSlugs: ReadonlySet<string>,
  customPacksEntitled: boolean
): boolean;

/** id → name, for ToolPackUtil.getLabel's customLabels. */
export function stationToolpackLabels(
  toolpacks: readonly AttachedToolpack[] | undefined
): CustomToolpackLabelMap;
```

- `isBuiltinPackEntitled` stays for the Toolpacks catalog (`Toolpacks.view.tsx`), which only ever asks about built-ins.
- `useBuiltinEntitlements().isEntitled` becomes `(pack) => isPackEntitled(pack, entitledSlugs, customPacksEntitled)`.
- `StationList` and `DefaultStationCard` switch from `isBuiltinPackEntitled` to `isPackEntitled`, and they take `customPacksEntitled` from the same hook.

`stationDataSetupFor` gains a fourth parameter, `labels: CustomToolpackLabelMap`:
- Excluded custom packs are named with `ToolPackUtil.getLabel(ref, labels)`, in the station's order, after the excluded built-ins.
- A custom ref with no label isn't named.
- With no names at all, the sentence falls back to "Some tool packs on this station" (`station-attachments.util.ts:96`).

`STATION_PLAN_EXCLUDED_CUSTOM_PACKS` and its special cases in `listPacks` and `planExcludedSentence` are deleted. A single name reads "isn't".

### Web — chips

- `ToolPackChipWithMetadata` gains a `name?: string` prop. The UI label is `toolpack?.name ?? name` for a custom ref, so a member gets the name without the 403-ing list. The chip is clickable only when the list resolved the pack, as today.
- The station detail view, `PortalHeaderMeta`, `StationList` and `DefaultStationCard` pass each item's name:
  - with `ToolPackChipWithMetadata`, through `name`;
  - with a plain `ToolPackChip`, through `label`;
  - in every case it's looked up with `stationToolpackLabels(station.toolpacks)`.
- `PortalHeaderMeta`'s station comes from the station GET, so it carries `toolpacks`.

### Web — Create and Edit Station

- `EditStationDialogProps` and `CreateStationDialogProps` gain `customPacksEntitled?: boolean`, defaulting to `true` (fail open, like `entitledBuiltinSlugs`). `station` gains `toolpacks?: AttachedToolpack[]`. The containers that render them pass the prop from `useBuiltinEntitlements`.
- Custom options are `disabled` with `UNENTITLED_PACK_REASON` when `!customPacksEntitled`. An attached pack stays selected and removable, the same as an unentitled built-in (#284).
- `ToolPackUpgradeNoteUI show` is `someBuiltinUnentitled(entitledBuiltinSlugs) || (!customPacksEntitled && (customOptions.length > 0 || form.toolPacks.some(isCustomRef)))`.
- Edit Station's count line names the packs it can't change, taking labels from `station.toolpacks` through `new Intl.ListFormat("en", { type: "conjunction" })`:
  - "Acme CRM can't be changed here."
  - "Acme CRM and Beta can't be changed here."
  - If any unshown pack has no name, it keeps the count wording ("2 tool packs on this station can't be changed here."). "Loading custom tool packs…" is unchanged.

## Migration / Seed

None. No schema or seed change.

## TDD test plan

Run tests through the npm scripts only: `npm run test:unit` / `npm run test:integration` in `apps/api`, and `npm run test:unit` in `apps/web` and `packages/core`, each with `-- --testPathPattern <file>`. Never invoke jest directly.

### Core
- `packages/core/src/__tests__/contracts/station.contract.test.ts`: `toolpacks` parses; an item with an unknown `kind` is refused. (2)
- `packages/core/src/__tests__/content/station-attachments.util.test.ts`:
  - real custom names are listed in order and cut at four;
  - a single name reads "isn't";
  - no names gives the generic subject;
  - drop the sentinel cases.

  (4)

### API
- `apps/api/src/__tests__/services/station-query.service.test.ts`:
  - rows carry `toolpacks` in ref order;
  - one `findNamesByIds` call for a page;
  - a missing custom pack gets no item.

  (3)
- `apps/api/src/__tests__/services/entitlement.service.test.ts`: `customPacksEntitlement` is true on pro and false on standard. It throws when the policy can't be resolved. (3)
- `apps/api/src/__tests__/__integration__/routes/station.router.integration.test.ts`, new `describe("custom tool pack names and plan (#1063)")`:
  1. A member with a station shared **Can view** reads its custom pack's name on GET by id. The item has exactly `ref`, `kind` and `name`.
  2. The list carries names for each station.
  3. A `station_toolpacks` row pointing at another org's pack is not named.
  4. The POST and PATCH responses carry `toolpacks`.
  5. On a tier without `customToolpacks`, POST with a custom pack answers 403 `STATION_TOOLPACK_NOT_ENTITLED`, the message names the pack, and no station row exists.
  6. On that tier, a PATCH adding a custom pack answers 403.
  7. On that tier, re-adding an attached custom pack answers 200 with nothing changed.
  8. On that tier, removing an attached custom pack answers 200.
  9. On a tier with custom packs, adding one answers 200 (a regression guard).

  (9)
- `apps/api/src/__tests__/tools/curated-views/curated-view-tools.test.ts`: `station_list` returns `toolpacks: [{ ref, name }]`. (1)
- `apps/api/src/__tests__/config/swagger.config.test.ts`: `Station` declares `toolpacks`, not required, and `AttachedToolpack` is registered. (2)
- Pinning tests (`builtin-toolpacks.test.ts`, `system.prompt.test.ts`) are updated if the description mirror moves.

### Web
- `apps/web/src/__tests__/ToolPackUtil.test.ts`:
  - `isPackEntitled` for a built-in, a custom ref (entitled and excluded) and an unknown ref;
  - `stationToolpackLabels`;
  - `stationDataSetupFor` names custom packs and omits an unnamed one.

  (6)
- `ToolPackChipWithMetadata.test.tsx`: with `name` and a refused list, the chip reads the name and isn't clickable; the list's name wins when both are present. (2)
- `StationList.test.tsx` and `DefaultStationCard.test.tsx`: each shows a custom pack's name and marks it not included when `customPacksEntitled` is false. (4)
- `EditStationDialog.test.tsx` (`describe("custom packs and the plan (#1063)")`):
  - a custom option is disabled with its reason when excluded;
  - an attached excluded custom pack stays selected and removable;
  - the upgrade note shows for an excluded custom pack;
  - the count line names one pack, then two;
  - the count wording returns when a name is missing;
  - axe passes with the note showing.

  (6)
- `CreateStationDialog.test.tsx`: a custom option is disabled when excluded. (1)
- `StationDetail.view.test.tsx` and `PortalHeaderMeta.component.test.tsx`: a member sees the name, and the excluded pack is muted. (3)

**Totals ≈ 46 cases.**

## Acceptance criteria

- [ ] A member who can read a station sees each custom pack by its name on the station page, the stations list, the default-station card and the portal header.
- [ ] In Edit Station, a member reads "<name> can't be changed here." instead of a bare count.
- [ ] Every station response carries `toolpacks` with only `ref`, `kind` and `name`. No other pack data and no other org's packs are exposed.
- [ ] On a plan without custom tool packs:
  - [ ] a station's custom packs render as not included (chip, picker, upgrade note);
  - [ ] the station notice names them;
  - [ ] adding one (create or edit) is refused with 403 `STATION_TOOLPACK_NOT_ENTITLED`;
  - [ ] removing one works;
  - [ ] re-adding an attached one is a no-op.
- [ ] On a plan with custom packs, nothing changes for owners and admins.
- [ ] `station_list` gives the agent each pack's name.

## Risks & rollback

- **The read gets a query heavier.** That's one org-scoped two-column read per response. A failure fails the station read, the same as today's toolpack read does.
- **A custom add that used to pass on an excluded plan now 403s.** That's intended. The rule is fail-closed (an unresolvable tier throws), matching `splitBuiltinPacks`. The web fails open, so a stale plan read shows a server error rather than blocking anything. Removal is never gated, so a downgrade can't lock a station.
- **Rollback:** revert the PR. The field is additive and no data changes.

## Files touched

- **Core:** `contracts/station.contract.ts`, `content/station-attachments.util.ts`, plus their tests.
- **API:**
  - new `services/station-toolpack-names.service.ts`;
  - `services/station-query.service.ts`, `services/entitlement.service.ts`;
  - `routes/station.router.ts`;
  - `tools/curated-views/station-list.tool.ts`;
  - `config/swagger.config.ts`;
  - possibly `registries/builtin-toolpacks.ts` and `prompts/system.prompt.ts`;
  - tests as above.
- **Web:**
  - `utils/tool-packs.util.ts`, `utils/use-builtin-entitlements.util.ts`;
  - `components/ToolPackChipWithMetadata.component.tsx`, `StationList.component.tsx`, `DefaultStationCard.component.tsx`, `PortalHeaderMeta.component.tsx`, `EditStationDialog.component.tsx`, `CreateStationDialog.component.tsx`;
  - `views/StationDetail.view.tsx`, `views/Stations.view.tsx` (passes props);
  - tests as above.

## Next step

`docs/CUSTOM_TOOLPACK_STATION_NAMES.plan.md` slices this into about five TDD commits on this branch:
1. the core contract and the names service, on all four station responses, with swagger;
2. the custom-pack plan check on POST and PATCH;
3. `station_list` names and the description surfaces;
4. web names on every chip surface;
5. web plan treatment: the predicate, both pickers, the upgrade note, the count line and the notice's names.
