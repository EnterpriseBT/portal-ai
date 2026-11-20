# Help pack on the provisioned stations — Discovery

**Issue:** [EnterpriseBT/portal-ai#1044](https://github.com/EnterpriseBT/portal-ai/issues/1044)

**Why this exists.** #848 gives every new organization two stations: Administrate (access) and Playground (data). Since #1050, product help is the built-in `help` pack (`platform_help`), which every tier gets for free. But a station only answers product questions when the pack is attached, and neither provisioned station has it. A new user's first portal therefore can't answer "how does this work?" on either station they start with. The empty conversation doesn't suggest product questions are an option either.

This is the provisioning change that puts Help where new users start, plus the empty-state line that tells them so.

## The current shape

### Provisioning

| Piece | Location | Note |
|---|---|---|
| `PROVISIONED_STATIONS` | `apps/api/src/constants/provisioned-stations.constants.ts:24-41` | `name`, `description`, `builtinSlugs`, `attachSandbox`, `isDefault`. Administrate `["rbac_management"]` (`:30`); Playground the three data packs (`:38`). Provisioning doesn't check the tier (`:11-12`) |
| The only consumer | `ApplicationService.provisionOrganizationWorkspace`, `apps/api/src/services/application.service.ts:896-1009` | Its loop calls `stationToolpacks.replaceForStation(id, { builtinSlugs })` (`:960`). Used by org create, org reset (docblock `:882-886`), and `portalai org create` / `seed org` |
| Entitlement | `packages/core/src/registries/tool-capabilities.ts:68` (`ALWAYS_ENTITLED_PACKS`), `apps/api/src/services/tier.service.ts:66` | `help` is effective on every tier, so it shows as active on both stations without a tier change |
| Data-pack flag | `packages/core/src/registries/station-data-packs.ts:30` (`help: false`) | Adding Help doesn't make Administrate a "data" station, so `station_context`'s status is unchanged |

### The Demo station (#1035): already done

`DemoSeedService.seedToolpacks` attaches `BUILTIN_TOOLPACKS.map(p => p.slug)` (`apps/api/src/services/demo-seed.service.ts:363`). That registry has held `HELP_PACK` since #1090, so a new demo's Demo station already carries `help`. `demo-seed.toolpacks.integration.test.ts:52-55` checks against the registry.

What's left is stale wording:
- its docblock (`:351`, "all eight built-in toolpacks");
- `DEMO_STATION_DESCRIPTION` (`apps/api/src/demo/dataset-manifest.ts:80-82`, "every tool pack", which is still accurate);
- `docs/DEMO_ORG.runbook.md:142` ("All eight … the ninth, `rbac_management`").

### The empty portal conversation

- **`PortalSessionEmptyState`** (`apps/web/src/components/PortalSession.component.tsx:159-209`): no props, heading "Ready when you are", a data-centric body (`:187-189`), and an FAQ link (`:200-208`).
- **Who renders it:** `MessageList` (`:96-98`) inside `PortalSessionUI` (`:213-300`), under the container `PortalSession` (`:306-559`).
- **Where the station comes from:**
  - The portal payload carries only `stationId` (`portal.contract.ts:92`). But the container already loads the station through `usePortalStationLock` → `usePortalStation` (`apps/web/src/utils/portal-station.util.ts:27-40`): `sdk.stations.get` under `queryKeys.stations.get`, the same query `PortalHeaderMeta` reads `station.enabledToolpacks` from (`PortalHeaderMeta.component.tsx:121, 241`).
  - `GET /api/stations/:id` always returns `enabledToolpacks` (`station.router.ts:548-567`).
- **Tests:** `apps/web/src/__tests__/PortalSession.test.tsx:244-282` (empty state) and `:450-452` (axe). Its sdk mock's `stations.get` returns no data (`:42-48`). There are no stories.

### Prompt

`apps/api/src/prompts/system.prompt.ts` Station Scope (`:1330-1405`) names no station, and a test holds that (`system.prompt.test.ts:1089-1097`). Its "attach the Help tool pack" sentence (`:1355-1367`) fires only when the plan has Help and this station doesn't. On the provisioned stations it simply stops firing. `PACK_PROMPT_SECTIONS.help` (`:761-790`) is unchanged.

### Content and docs that list the stations' packs

| Surface | Location | Pinned by |
|---|---|---|
| Glossary, Station entry | `packages/core/src/content/glossary.util.ts:242` | `glossary.util.test.ts:448-454, 472-477` |
| FAQ, station answers | `packages/core/src/content/faq.util.ts:57, 70, 332` | `faq.util.test.ts:371, 382, 391` |
| Getting Started | `apps/web/src/utils/getting-started.util.ts:33` | `getting-started.util.test.ts:55` |
| Admin CLI | `packages/admin-cli/COMMANDS.md:48-49, 90`; `README.md:63` | — |
| e2e README | `packages/e2e/README.md:64` | — |
| Seed-org docblock | `apps/api/src/db/seed-org.ts:8-13` | — |
| Demo runbook | `docs/DEMO_ORG.runbook.md:17, 45, 142` | — |

### Tests that move

- `provisioned-stations.constants.test.ts:54-77` pins the exact slugs, and `:43-52` Administrate's exact description.
- `provisioned-stations.integration.test.ts:189-200` expects Playground's effective packs to be exactly `["data_query","entity_management"]` (`:199`). With `help` attached and always entitled, `help` joins that list.
- The constant-driven integration tests (`application.service`, `reset.service`, `provisioned-stations` `:157-185`) follow the constant without edits.
- e2e asserts no provisioned-station packs, and its fixture seeds every pack with `--all-toolpacks`.

## The design space

### Decision 1 — How the empty state learns the station has Help

- **A. A prop from the container.** `PortalSession` reads `usePortalStation(stationId).station?.enabledToolpacks.includes("help")` and passes `helpAvailable` through `PortalSessionUI` → `MessageList` → `PortalSessionEmptyState`. It reuses the query the header already holds, so there's no new request.
- **B. A new `hasHelp` field on the portal payload.** That's a contract change and duplicates the station's own field.
- **C. Always mention help.** That breaks the acceptance criterion for a station without the pack.

| | A | B | C |
|---|---|---|---|
| New request / contract | none | portal contract | none |
| Honest per station | yes | yes | no |
| Component File Policy | UI stays pure (prop) | same | same |

**Lean: A.** The data is already on the client under a shared key, and the pure UI component just gets a boolean.

### Decision 2 — What the empty state says, and while loading

Today's body (`PortalSession.component.tsx:187-189`) is all data: "explore your data through conversation — ask questions, generate charts, and create or modify records, entities, and field mappings". That's wrong on Administrate, which has no data, and it says nothing about organization questions or product help.

**Decided with the user:**
- **Body, every station:** *"Ask questions, explore your data, chart it and change it through conversation. Depending on this station's tool packs, the assistant can also answer questions about your organization, from its stations and views to who has access."* It keeps the data theme first, names organization questions, and ties both to the station's packs, so it holds on Administrate and on Playground.
- **One added line, only when the station has the Help pack:** *"Not sure where to start? Ask how anything in Portals works."*, linked to the FAQ's Getting Started category (open question 1).
- **Unchanged:** the heading ("Ready when you are"), the existing "Learn what portal sessions can do →" link (FAQ Analytics) and `CHAT_INPUT_PLACEHOLDER`.
- **Loading:** while the station loads, `helpAvailable` is false, so the Help line appears once the (usually cached) station resolves. The empty state is a resting screen, so appearing late is acceptable there (unlike a status overlay).

### Decision 3 — Station descriptions

Both descriptions say what the station is for. Each gains one clause saying the assistant also answers questions about how Portals works. Administrate: "…No data is attached here. You can also ask how Portals works." Playground: the same closing sentence.

**Lean: append one sentence to each.** The exact wording goes in the spec, and Administrate's exact-description pin moves with it.

### Decision 4 — The prompt

- **A. No change.** Station Scope names no station, and its attach-Help line is conditional on the station lacking Help. The provisioned stations now have it, so the line just doesn't render there. Add a test that a station whose packs match the provisioned Playground list renders `## Help` and not the attach sentence.
- **B. Mention the provisioned stations by name.** That violates the "names no station" rule (#848) and its test.

**Lean: A**, plus the pinning test.

## Tradeoff comparison

| | D1 prop | D2 generic body + Help line | D3 one clause | D4 no prompt change |
|---|---|---|---|---|
| Spread to spec | Yes | Yes (copy) | Yes (copy) | Yes (test) |

## Recommendation

1. **Provisioning:** `PROVISIONED_STATIONS` gains `"help"` in both `builtinSlugs`. Nothing else about either station changes, and no third station is added.
2. **Descriptions:** both station descriptions end with one sentence saying the assistant also answers questions about how Portals works.
3. **The empty state:**
   - The body becomes the generic copy in Decision 2 on every station.
   - `PortalSessionEmptyState` takes a `helpAvailable` prop. When true, it adds "Not sure where to start? Ask how anything in Portals works.", linked to the FAQ's Getting Started category.
   - `PortalSession` derives the prop from the station `usePortalStation` already loads (`enabledToolpacks.includes("help")`), with no new query.
   - A station without the pack shows the body without the Help line. The heading, the Analytics link and `CHAT_INPUT_PLACEHOLDER` are unchanged.
4. **Demo:** the Demo station needs no code change, since it already attaches every built-in. Only stale wording is corrected: the `seedToolpacks` docblock and the demo runbook's pack count.
5. **Prompt:** unchanged. A new test pins that a station with the provisioned packs gets the Help section and no attach-Help sentence.
6. **Content and docs:** the glossary Station entry, the FAQ station answers, Getting Started, the admin-cli `COMMANDS.md` and `README.md`, the e2e README, the `seed-org.ts` docblock and the demo runbook all say both stations carry the Help pack too.
7. **Tests:** the pinned slug lists and Administrate's description move, and the Playground effective-packs assertion gains `help`.

## Open questions

1. **Where does the empty state's new Help link point?** (Confirmed.)
   - There's no stations category in `FAQCategory` (`faq.util.ts:11-17`). The station FAQ ("What is a Station and why do I need one?", `:55-58`) sits in Getting Started.
   - Lean: link to the FAQ's Getting Started category, the newcomer's material. The existing link stays on Analytics.
2. **Should existing app-dev/prod orgs get Help on their provisioned stations by hand?** Lean: no. The PRD rules out backfill, and someone who can edit a station can attach it in seconds. New and reset orgs get it.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A because provisioning already runs in one transaction per org, and this adds a slug to an existing list.
- **Accuracy & auditability:** N/A, as attachments are ordinary `station_toolpacks` rows with the system principal as creator, as today.
- **Failure modes:** the empty state fails soft. If the station query errors or is still loading, `helpAvailable` is false and the generic body shows without the Help line. Lean: fail toward the body alone.
- **Scale & unbounded growth:** N/A, at one row per station.
- **Multi-tenancy:** N/A. It's per-org provisioning, and Help is always entitled, so no tier leaks.
- **Contract stability:** no API contract change. The empty state reads an existing station field. Lean: keep it client-side.
- **Data lifecycle:** existing orgs are untouched (no backfill), and a detach is a normal station edit.

## What this doesn't decide

- **A backfill to existing organizations:** ruled out by the PRD, following #848.
- **Retrieval quality of `platform_help` answers:** that's #1049.
- **Changing the default station:** it stays Administrate.

## Next step

`docs/HELP_PACK_ON_PROVISIONED_STATIONS.spec.md` pins the two descriptions, the empty-state copy and link, the `helpAvailable` prop path, and the test moves. The plan then lands it in about three slices:
1. provisioning, descriptions and their tests (api);
2. the empty state (web);
3. content and docs (core, CLI and e2e docs, runbook).
