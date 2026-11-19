# Platform help as a tool pack — Spec

This spec pins the contract for turning `platform_help` into a built-in `help` pack and for `station_context` absorbing the always-needed station and organization context. It builds on [`PLATFORM_HELP_PACK.discovery.md`](./PLATFORM_HELP_PACK.discovery.md) for [#1050](https://github.com/EnterpriseBT/portal-ai/issues/1050).

## Key decisions (flag for review)

1. **`help` is an ordinary built-in pack**, built only when attached and effective. `platform_help` leaves `SYSTEM_TOOL_CAPABILITIES`, which keeps `current_time` and `station_context`.
2. **Every tier is entitled to it, whatever its stored row says.** `ALWAYS_ENTITLED_PACKS = ["help"]` (core) is unioned into `TierPolicy.entitlements.builtinToolpacks` by `TierService.tierPolicyFromRow`. Every reader therefore sees it: the split, "packs elsewhere", web entitlements and the attach guard.
   - The catalog lists `help` in every tier too, and a guard fails a tier without it.
   - Stored rows aren't backfilled. `site-config` reads rows verbatim, so the public pricing page lists Help once `tier apply` has run on catalog tiers.
3. **One diagnostics implementation.** `StationDiagnosticsService.forStation` (moved from `platform-help.tool.ts`) feeds both `platform_help`'s prose and `station_context`'s new always-returned `status`. It stays fail-soft.
4. **`station_context` grows two additive pieces:**
   - an always-present `organization` header;
   - an **opt-in** `stations` section. Unlike every other section it isn't included when `include` is omitted. It's capped at 25.
5. **`## Help` becomes `PACK_PROMPT_SECTIONS.help`**, so the #284 guard proves it renders iff the pack is effective. `PACK_ELSEWHERE.help` names it.
6. **Nothing existing changes:** no migration attaches the pack, and the station pickers are unchanged beyond the icon.

## Scope

### In scope
- **core:** the pack descriptor and capability, `ALWAYS_ENTITLED_PACKS`, the tier catalog, slug-keyed records, FAQ/glossary pack inventories.
- **api:**
  - the tier policy union and the session build;
  - `StationDiagnosticsService`, `station_context`, `platform_help`;
  - the prompt.
- **web:** the pack icon.
- **docs:** `CLAUDE.md`, stale comments, the e2e README note, and amending #1044.

### Out of scope
- **Owned by other tickets or decisions:**
  - help retrieval and content, and the rendered help block (#1049);
  - attachable `current_time` / `station_context` (decided against at filing);
  - provisioning the Help station (#1044).
- **Deferred:** pack descriptions in the pickers, and backfilling stored tier rows.

## Surface

### `packages/core/src/registries/builtin-toolpacks.ts`
- **Slug enum.** `BuiltinToolpackSlugSchema` (:33-44) gains `"help"`.
- **The pack.** A new `HELP_PACK`, registered last in the registry array (:2267-2280):

  ```ts
  { slug: "help", name: "Help", iconSlug: "help",
    description: "Answers questions about how Portals works — portals, stations, connectors, entities, tool packs and pinned results — with links into Help.",
    tools: [{ name: "platform_help",
      description: <PlatformHelpTool.description, as today>,
      parameterSchema: { type: "object", properties: { question: { type: "string", maxLength: 500, description: … } } } }] }
  ```
- **Capability.** The `CAPABILITIES` matrix (:1869+) gains `platform_help` with today's values (`pure: false`, `reads: ["entity_records"]`, `costHint: "free"`, `resultKind: "scalar"`, …) **without** `alwaysAvailable`.
- **Authorization.** No `TOOL_AUTHORIZATION` entry: that map (:2091-2103) holds data-plane **write** tools only, and `platform_help` writes nothing (its capability's `writes: []` keeps the coverage guard satisfied).

### `packages/core/src/registries/tool-capabilities.ts`
- `platform_help` is removed from `SYSTEM_TOOL_CAPABILITIES` (:56-74). `alwaysAvailableToolNames()` returns `["current_time", "station_context"]`.
- New:

  ```ts
  /** #1050: built-in packs every tier is entitled to, whatever its stored allowlist says. Free, never upsold. */
  export const ALWAYS_ENTITLED_PACKS: readonly BuiltinToolpackSlug[] = ["help"];
  ```

  It's exported from the registries barrel, and its comment at `registries/index.ts:16` is updated.

### `packages/core/src/registries/tier-catalog.ts`
`standard` (:131-137) and `plus` (:167-176) list `"help"` explicitly. `pro` and `enterprise` already spread every slug.

### `packages/core/src/registries/station-data-packs.ts`
`PACK_USES_STATION_DATA.help = false`. The comments at :11 and :43 no longer call help a system tool.

### `apps/api/src/services/tier.service.ts`
`tierPolicyFromRow` (:60-61):

```ts
builtinToolpacks: [...new Set([...row.builtinToolpacks, ...ALWAYS_ENTITLED_PACKS])],
```

`resolveTier`'s cache is unchanged, since it caches the derived policy.

### `apps/api/src/services/station-diagnostics.service.ts` (new)
```ts
export type StationSituation = "no_packs" | "attachments_missing" | "attachments_inaccessible"
  | "no_records" | "unentitled_packs" | "default" | "unknown";
export interface StationFindings { /* today's interface from platform-help.tool.ts:43-61, unchanged */ }
export class StationDiagnosticsService {
  /** Fail-soft: never throws; a failed read returns `{ available: false, … }`. */
  static async forStation(stationId: string, organizationId: string, userId: string): Promise<StationFindings>;
  /** First match, "nothing works" → "everything works"; `unknown` when `!findings.available`. */
  static situation(findings: StationFindings): StationSituation;
}
```

This is the code that moves out of `platform-help.tool.ts` (`gatherFindings` :128-211, `matchSituation` :214-232), with its behaviour unchanged. The tool keeps `SITUATION_PROSE`, `selectContent` and `composeAnswer`. Its class comment (:72-86) now says it is the `help` pack's tool.

### `apps/api/src/tools/station-context.tool.ts`
- **`include` enum** (:39-56) gains `"stations"`. The `include` description says `stations` is returned **only when named**. Every other section keeps "omit = all".
- **Response** (:59): two always-present additions, plus the opt-in section.

  ```ts
  organization: { name: string; plan: { slug: string; displayName: string } };
  status: {
    situation: StationSituation;
    packsEffective: string[];                 // built-in slugs live in this session
    attachments: { missing: string | null; inaccessible: string | null };
    hasRecords: boolean;
    planExcludedPacks: string | null;         // findings.excludedPacks
  };
  stations?: { items: Array<{ id: string; name: string; description: string | null; packs: string[] }>; totalCount: number };
  ```
- **Sources:**
  - `organization.name` comes from the org row it already reads (:199-202).
  - `plan` comes from `TierService.resolveTier` (`slug`, `displayName`).
  - `status` comes from `StationDiagnosticsService` (`unknown` when unavailable).
  - `stations` comes from `StationQueryService.listForCaller(ctx, { limit: 25, sortBy: "name", sortOrder: "asc" })` with `packs` = attached built-in slugs and custom pack names, and `totalCount = total`.
  - Records are never read beyond the existing bounded count.
- **Comment fix:** `:23` ("`station_context` toolpack") is corrected.

### `apps/api/src/services/tools.service.ts`
- The system-tool block (:598-617) no longer builds `platform_help`.
- A new pack block, `if (enabledPacks.has("help")) tools.platform_help = new PlatformHelpTool().build(stationId, organizationId, userId)`, joins the pack blocks (:622+).
- `BUILTIN_TOOL_NAMES` (:224) is unchanged, since it's derived from the descriptors.

### `apps/api/src/prompts/system.prompt.ts`
- **Base prompt:** the unconditional `## Help` lines (:896-901) are removed from the base `lines`.
- **`PACK_PROMPT_SECTIONS.help`:**
  - `capability: "answer questions about how Portals works"`;
  - `requestShapes: ["a product question"]`, `blocks: []`, `interpretiveTools: []`;
  - `markers: ["## Help", "platform_help"]`;
  - `render` returns today's `## Help` lines verbatim.
- **`PACK_ELSEWHERE.help`:** `"answering questions about how Portals works, with links into Help"`.
- **`## Station Scope`** (:1312-1365) gains two lines:
  - "If a query comes back empty, or something the user expects isn't here, read `station_context`'s `status` before answering, and explain what it reports."
  - "When suggesting a station, name one from `station_context` with `include: [\"stations\"]`."

### `apps/web/src/utils/tool-pack-icons.util.ts`
`ICONS_BY_SLUG.help = HelpOutlineIcon` (`@mui/icons-material`).

### Content and docs
- **Pack inventories:** the FAQ "What are tool packs?" (`faq.util.ts:256-258`) and the glossary "Tool Pack" (`glossary.util.ts:287-290`) list Help.
- **`CLAUDE.md`:** the documentation inventory's system tools become `current_time`, `station_context`. The tool-surfaces row notes that `platform_help` is in the `help` pack.
- **e2e:** `packages/e2e/README.md` notes that `--all-toolpacks` stations carry Help.
- **#1044:** amended to "attach the help pack".

## Migration

None. `station_toolpacks.builtin_slug` is free text, tiers aren't backfilled (Key decision 2), and no station is changed.

## Seed

None. `SeedService.seedTiers` only inserts `standard` when it's missing. Catalog tiers pick up `help` on the next `portalops tier apply`, and entitlement doesn't wait for it.

## TDD test plan

Run per package: `npm run test:unit` (`--testPathPattern` for focused runs) and `npm run test:integration`, then `npm run type-check` / `lint`.

### packages/core
- **`registries/builtin-toolpacks.test.ts`:**
  - eleven packs, with `help` in the pinned slug list;
  - `help` has exactly `platform_help`;
  - its `costHint` is `free`.
- **`registries/tool-capabilities.test.ts`:**
  - `alwaysAvailableToolNames()` is exactly `current_time`, `station_context`;
  - `platform_help` isn't a system tool, and its capability has no `alwaysAvailable`;
  - `ALWAYS_ENTITLED_PACKS` is `["help"]`, and every member is `free`.
- **`registries/tier-catalog.test.ts`:**
  - every catalog tier's `builtinToolpacks` includes every `ALWAYS_ENTITLED_PACKS` slug (the "a tier that omits it fails CI" guard);
  - the pinned lists are updated;
  - the ladder is still monotonic.
- **`content`:** `faq.util.test.ts` / `glossary.util.test.ts` pins still pass with Help named.

### apps/api — unit
- **`services/tier.service.test.ts`:**
  - a row whose `builtinToolpacks` lacks `help` resolves to a policy that includes it;
  - a row that lists it isn't duplicated.
- **`services/entitlement.service.test.ts`:**
  - with a custom tier row of `["data_query"]`, `help` lands in `effective` when attached and in `otherPlanPacks` when not;
  - it's never in `unentitled`.
- **`services/tools.service.test.ts`:**
  - a pack-less station builds exactly `[current_time, station_context]`;
  - a station with `help` adds `platform_help`;
  - a station with `help` attached, on a custom tier lacking it in the row, still builds `platform_help`;
  - the `SYSTEM_TOOLS` set and the "descriptor set plus system tools" test are updated.
- **`tools/builtin-toolpack-schema-parity.test.ts`:** the `help` mirror matches `{ question?: string }`.
- **`prompts/system.prompt.test.ts`:**
  - with no packs, there's no `## Help` and no `platform_help` (this inverts :1883-1890);
  - with `help` effective, `## Help` renders as today;
  - the #284 marker guard covers `help`;
  - Station Scope lists `- Help: answering questions about how Portals works…` when the plan has it and the station doesn't;
  - the two new Station Scope lines are present;
  - `PACK_ELSEWHERE` has no marker.
- **`services/station-diagnostics.service.test.ts` (moved and extended from the platform-help tests):**
  - every situation, in precedence order;
  - `unknown` when the read fails;
  - fail-soft (never throws).
- **`tools/platform-help.tool.test.ts`:** unchanged answers per situation, now through the service.
- **`tools/station-context.tool.test.ts`:**
  - `organization` and `status` are present for every `include` value;
  - `stations` is absent unless named;
  - with `stations`: capped at 25 by name, `totalCount` reported, packs listed.
- **Guards:**
  - `system-principal.guard.test.ts` and the "every tool wrapped by the cost gate" guard still pass;
  - `free` stays immune: an exhausted quota still admits `platform_help` (`cost-gate.service.test.ts`).

### apps/api — integration
- **`apps/api/src/__tests__/__integration__/tools/station-context.integration.test.ts` (new):** `stations` respects visibility, so a member doesn't see another member's private station, and `status.hasRecords` flips after an import.
- **Station pack attach** (`routes/station.router` suite): attaching `help` on a custom tier whose row lacks it succeeds, and is refused on a station the caller can't edit.

### apps/web
`tool-pack-icons.util` test, or the picker's: Help renders the help icon, and `withEntitlements` doesn't disable it for a plan whose entitlements include it.

**Totals ≈ 42 cases** (about 12 core, 24 api unit, 3 api integration, 3 web).

## Acceptance criteria

- [ ] A portal on a station without the Help pack has no `platform_help` tool and no `## Help` section. A product question there gets an answer that names the Help pack (and a readable station that has it, if any), with no claim that the product can't do it.
- [ ] A portal on a station with the Help pack answers product questions from help content with Help links, as today.
- [ ] Without the Help pack, `station_context` still reports:
  - no packs;
  - nothing attached;
  - attachments the caller can't read;
  - no records;
  - plan-excluded packs.

  The agent explains each one.
- [ ] The agent can state the organization's name and plan, and names a readable station when it suggests opening one.
- [ ] Help is entitled on every tier, including custom tiers whose stored list predates it. It never appears under "Not Included In This Plan", is never disabled in the picker, and a catalog tier without it fails CI.
- [ ] `platform_help` is never charged or rate-limited.
- [ ] A member can attach Help to a station they can edit, and is refused on one they can't.
- [ ] Help shows in the station pack pickers and on the Toolpacks page, and its mirror matches the tool.
- [ ] No existing station gains or loses a pack. Their sessions no longer carry `platform_help`.

## Risks & rollback

- **Session behaviour on existing stations changes.** Product questions there now get "open a station with the Help pack" until #1044 provisions one. Existing orgs get no Help station (#1044 decides that). Detected by the smoke walk. It's mitigated because any member can attach Help to a station they can edit.
- **Entitlement fails open for `help` only.** That's safe: it's free, and reads only the session's own station metadata.
- **The pricing page** lags until `tier apply` runs. That's cosmetic.
- **Rollback:** revert the PR. No data is written, and stations that attached `help` keep a harmless slug that the old build ignores.

## Files touched

- **core:**
  - `registries/{builtin-toolpacks,tool-capabilities,tier-catalog,station-data-packs,index}.ts`
  - `content/{faq,glossary}.util.ts`
  - tests under `src/__tests__/registries/`
- **api:**
  - `services/{tier,tools}.service.ts`
  - new `services/station-diagnostics.service.ts`
  - `tools/{platform-help,station-context}.tool.ts`
  - `prompts/system.prompt.ts`
  - tests (unit and integration as above)
- **web:** `utils/tool-pack-icons.util.ts` (and its test).
- **docs:**
  - `CLAUDE.md`
  - `packages/e2e/README.md`
  - stale comments: `station-attachments.util.ts:4` and the files above
  - the #1044 issue body

## Next step

`docs/PLATFORM_HELP_PACK.plan.md` sequences about five slices:
1. Core: pack, capability, `ALWAYS_ENTITLED_PACKS`, catalog and guards. `tools.service` still builds `platform_help` unconditionally, so the tree stays green.
2. The `tierPolicyFromRow` union, plus the entitlement tests.
3. Extract `StationDiagnosticsService` with no behaviour change, and grow `station_context`.
4. The switch: the session build builds `platform_help` only with the pack, the prompt section becomes a pack section, and Station Scope gains its lines.
5. The web icon, content, docs and the #1044 amendment.
