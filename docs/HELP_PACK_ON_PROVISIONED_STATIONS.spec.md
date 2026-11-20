# Help pack on the provisioned stations — Spec

This spec pins:
- the provisioned stations' packs and descriptions;
- the empty portal conversation's new copy and its `helpAvailable` path;
- the content and doc wording;
- the tests that move.

Discovery: `docs/HELP_PACK_ON_PROVISIONED_STATIONS.discovery.md`. Issue: #1044.

## Key decisions (flag for review)

1. **Both provisioned stations get `help`.** No third station is added, and nothing else about either station changes. New and reset organizations only; there's no backfill.
2. **The Demo station needs no code change.** It already attaches every built-in (`demo-seed.service.ts:363`), so only stale wording around it is fixed.
3. **The empty state:**
   - The body is reworded for every station, keeping data first and adding organization questions tied to the station's packs.
   - A Help line appears only when the station has the pack.
   - The flag comes from the station query the portal already holds; there's no new request or contract change.
4. **No prompt change.** One new test ties `PROVISIONED_STATIONS` to the prompt: each provisioned station gets `## Help` and never the attach-Help sentence.

## Scope

### In scope
- `PROVISIONED_STATIONS`, its tests, and the Playground effective-packs integration assertion.
- `PortalSessionEmptyState` copy, the prop chain through `MessageList` and `PortalSessionUI`, and the `PortalSession` container.
- The glossary Station entry, the station FAQ, the Getting Started "Create a station" step, and their pins.
- Doc wording: the e2e README, the `seed-org.ts` docblock, `DemoSeedService.seedToolpacks`' docblock, and `docs/DEMO_ORG.runbook.md`.

### Out of scope
- Backfilling existing organizations, a third station, or changing the default station.
- `platform_help` retrieval (#1049).
- The other FAQ answers that send data questions to Playground (`faq.util.ts:70, 332`). They're about data, not packs, and stay accurate.
- `CHAT_INPUT_PLACEHOLDER`, the empty state's heading, and its existing Analytics link.

## Surface

### `apps/api/src/constants/provisioned-stations.constants.ts`

| Station | `builtinSlugs` | `description` |
|---|---|---|
| Administrate | `["rbac_management", "help"]` | `Manage access through the assistant: shares on any plan, and custom roles, policies and groups where your plan includes them. No data is attached here. You can also ask how Portals works.` |
| Playground | `["data_query", "entity_management", "view_management", "help"]` | `Build and share entities and views with the assistant, attach views to this or other stations, and query the data in the same session. You can also ask how Portals works.` |

`name`, `attachSandbox` and `isDefault` are unchanged.

The constant's docblock and `ApplicationService.provisionOrganizationWorkspace`'s docblock (`application.service.ts:878-880`) both list the stations' packs, so each gains "and the Help pack".

`help` is always entitled (`ALWAYS_ENTITLED_PACKS`), so on every tier it's in `resolveStationPacks(...).effective` for both stations.

### `apps/web/src/components/PortalSession.component.tsx`

**`PortalSessionEmptyState`** becomes `React.FC<{ helpAvailable: boolean }>`. Its rendered content, in order:

1. The icon and the heading "Ready when you are" (unchanged).
2. The body `Typography`, on every station: **"Ask questions, explore your data, chart it and change it through conversation. Depending on this station's tool packs, the assistant can also answer questions about your organization, from its stations and views to who has access."**
3. **Only when `helpAvailable`:**
   - a `Typography variant="body2"` with `data-testid="portal-session-empty-help"`: **"Not sure where to start? Ask how anything in Portals works."**;
   - then a router `Link` with `data-testid="portal-session-empty-getting-started-link"`, `to="/help"` and `search={{ tab: HelpTab.Faq, category: FAQCategory.GettingStarted }}`, with the text **"Getting started with Portals →"**.

   It uses the same `Link` + `MuiLink component="span"` pattern as the existing link, for the reasons in that comment.
4. The existing "Learn what portal sessions can do →" link (Analytics), unchanged.

**The prop chain:**
- `MessageListProps` and `PortalSessionUIProps` gain `helpAvailable?: boolean`, defaulting to `false`.
- `MessageList` renders `<PortalSessionEmptyState helpAvailable={helpAvailable} />`.
- `PortalSessionUI` passes it to `MessageList`.

**`PortalSession` (the container)** derives it from the station it already loads:

```ts
const { station } = usePortalStation(portalQuery.data?.portal.stationId);
// enabledToolpacks is optional on StationWithToolpacksSchema (station.contract.ts:47).
const helpAvailable = station?.enabledToolpacks?.includes("help") ?? false;
```

`usePortalStation` (`apps/web/src/utils/portal-station.util.ts:27-40`) shares `queryKeys.stations.get` with `usePortalStationLock` and the header, so this adds no request. When the station is loading, unreadable or failed, `station` is null and the flag is `false`: the body shows without the Help line.

### Content (`packages/core/src/content/`, `apps/web/src/utils/getting-started.util.ts`)

| Surface | Change |
|---|---|
| Glossary "Station" (`glossary.util.ts:242`) | After "…the packs to build, share and query entities and views." insert: **"Both also carry the Help pack, so you can ask how Portals works on either."** |
| FAQ "What is a Station and why do I need one?" (`faq.util.ts:57`) | After "…and Playground, for building and querying data." append: **"Both carry the Help pack, so you can ask either how Portals works."** |
| Getting Started "Create a station" (`getting-started.util.ts:33`) | After "…as examples." insert: **"Both carry the Help pack for questions about how Portals works."** |

### Docs and docblocks

- **`packages/e2e/README.md:64` and `apps/api/src/db/seed-org.ts:8-13`:**
  - before: "Administrate gets the access pack, Playground the data-query, entity and view packs";
  - after: "Administrate gets the access and Help packs, Playground the data-query, entity, view and Help packs".
- **`apps/api/src/services/demo-seed.service.ts:351`:** "Enable all eight built-in toolpacks" becomes "Enable every built-in toolpack (Help included, #1050)".
- **`docs/DEMO_ORG.runbook.md:142`:** the closing sentence becomes "Two more built-in packs are out of this walkthrough: `rbac_management` (#629), which performs RBAC admin actions rather than reading or writing the demo dataset and is covered by the #629 RBAC smoke, and `help` (#1050), which answers product questions; ask the Demo station 'How do I create a station?' to show it."
- **`packages/admin-cli/COMMANDS.md` and `README.md`** say "with their toolpacks", which stays accurate; unchanged.
- **`CLAUDE.md:504`** names the stations without packs; unchanged.

## Migration
## Seed

There is **no schema change and no migration.** The seed change is the `PROVISIONED_STATIONS` constant, which runs only at org provisioning and reset. It's deliberately not backfilled (the PRD, following #848), so `seed-backfill-coverage` doesn't apply: it covers `SYSTEM_COLUMN_DEFINITIONS` only.

## TDD test plan

The npm scripts, per package:
- `cd apps/api && npm run test:unit` / `npm run test:integration`
- `cd apps/web && npm run test:unit`
- `cd packages/core && npm run test:unit`

### apps/api
- **`src/__tests__/constants/provisioned-stations.constants.test.ts`:**
  - the exact list now carries `help` on both stations;
  - Administrate's exact description gains its last sentence, and a new case pins Playground's exact description.
  - Count: 2 edited, 1 new.
- **`src/__tests__/prompts/system.prompt.test.ts`:** new. For each `PROVISIONED_STATIONS` entry, `buildSystemPrompt` with `effectiveToolPacks: [...builtinSlugs]` and `otherPlanToolPacks: []` contains `## Help` and not "are the Help pack's". Count: 1 (it loops over both stations).
- **`src/__tests__/__integration__/services/provisioned-stations.integration.test.ts:189-200`:**
  - Playground's effective packs on the narrowed tier are `["data_query", "entity_management", "help"]`, because Help is entitled even there;
  - a new case shows both stations' effective packs include `help` on a tier whose stored list lacks it.
  - Count: 1 edited, 1 new.

### apps/web
- **`src/__tests__/PortalSession.test.tsx`:**
  - the empty state renders the new body on its own (`helpAvailable` false or unset);
  - with `helpAvailable`, it renders the Help line and the Getting Started link, with the href `/help?tab=faq&category=getting-started`;
  - without it, neither renders;
  - the Analytics link is unchanged;
  - axe passes on the empty state with `helpAvailable`.
  - Count: 5.
- **The container:** with the `stations.get` mock returning a station whose `enabledToolpacks` includes `help`, `PortalSession`'s empty state shows the Help line; a station without `help`, or a station error, shows none. Count: 2.

### packages/core
- **`glossary.util.test.ts:448-454`:** Station names the Help pack on both. Count: 1 edited.
- **`faq.util.test.ts:371`:** the exact station sentence. Count: 1 edited.

### apps/web, getting started
- **`getting-started.util.test.ts:55`:** the exact description. Count: 1 edited.

**Totals ≈ 17 cases:**
- api: 5;
- web: 8 (including Getting Started);
- core: 2;
- plus the constant-driven integration suites (application, reset, provisioned stations), which follow the constant with no edits.

## Acceptance criteria

- [ ] A new organization, and a reset one, has exactly Administrate and Playground. Each has its existing packs plus `help`, the new descriptions, and Administrate as the default.
- [ ] On every tier, `help` is active on both provisioned stations.
- [ ] On a portal on either station, "How do I create a station?" is answered from the help content (a `platform_help` call), with a Help link.
- [ ] Administrate still manages access, and Playground still builds and queries data.
- [ ] A new portal on any station shows the new body. On a station with the Help pack it also shows "Not sure where to start? Ask how anything in Portals works." with a working Getting Started link, and on a station without it neither appears.
- [ ] After an editor detaches Help from a provisioned station, that station's new portals drop the Help line.
- [ ] Existing organizations' stations are unchanged.
- [ ] A new demo's Demo station has `help`, as already happens today.
- [ ] The glossary, FAQ, Getting Started, e2e README, seed-org docblock and demo runbook say both provisioned stations carry the Help pack.

## Risks & rollback

- **A test somewhere pins the provisioned packs.** The constant-driven integration suites follow the constant, and the one exact assertion (`:199`) is updated here. CI catches any other.
- **The empty state shifts when the Help line appears after the station loads.** The station is usually cached from the Portal view's header query, so the shift is rare and harmless on a resting screen.
- **Rollback:** revert the PR. Organizations provisioned in the meantime keep `help` on their stations, which an editor can detach. It's always entitled, so nothing breaks.

## Files touched

- **apps/api:**
  - `src/constants/provisioned-stations.constants.ts`
  - `src/services/application.service.ts` (docblock)
  - `src/services/demo-seed.service.ts` (docblock)
  - `src/db/seed-org.ts` (docblock)
  - tests: `src/__tests__/constants/provisioned-stations.constants.test.ts`, `src/__tests__/prompts/system.prompt.test.ts`, `src/__tests__/__integration__/services/provisioned-stations.integration.test.ts`
- **apps/web:**
  - `src/components/PortalSession.component.tsx`
  - `src/utils/getting-started.util.ts`
  - tests: `src/__tests__/PortalSession.test.tsx`, `src/__tests__/getting-started.util.test.ts`
- **packages/core:**
  - `src/content/glossary.util.ts`, `src/content/faq.util.ts`
  - tests: `src/__tests__/content/glossary.util.test.ts`, `src/__tests__/content/faq.util.test.ts`
- **Docs:** `packages/e2e/README.md`, `docs/DEMO_ORG.runbook.md`

## Next step

`docs/HELP_PACK_ON_PROVISIONED_STATIONS.plan.md` lands this in three slices:
1. provisioning and the prompt pin (api);
2. the empty state (web);
3. content and docs (core, Getting Started, READMEs, runbook).
