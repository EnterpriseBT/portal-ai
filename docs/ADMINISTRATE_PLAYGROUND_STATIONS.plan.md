# Administrate and Playground stations — Plan

**A TDD-sequenced implementation of the two provisioned stations: the constant with provisioning and reset, the reworded empty-station sentences, the agent and help-tool wording, and the help content and docs.**

Spec: `docs/ADMINISTRATE_PLAYGROUND_STATIONS.spec.md`. Discovery: `docs/ADMINISTRATE_PLAYGROUND_STATIONS.discovery.md`. Issue: #848. It builds on #1036 (attach views from a portal session), merged as PR #1037. #847 follows and adds `member_management` to Administrate.

The work is four slices. Each sits behind a green test suite and leaves the repo compilable. They land as **commits on `feat/848-administrate-playground-stations`**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package, and only the touched files locally (the full suite is CI's job):

```bash
cd apps/api && npm run test:unit -- --testPathPattern <file>
cd apps/api && npm run test:integration -- --testPathPattern <file>
cd packages/core && npm run test:unit -- --testPathPattern <file>
cd apps/web && npm run test:unit -- --testPathPattern <file>
```

Each slice follows the same loop:
1. Write the failing tests.
2. Make the smallest change that turns them green.
3. Run them on their own.
4. Run `npm run lint && npm run type-check` (and `npm run format:check`) at the boundary.
5. Move to the next slice.

A slice that touches `packages/core` runs the root `npm run build` before its commit, because the glossary and FAQ also feed the web and the marketing site.

**Sequencing rationale.**

| Slice | What lands | Why it sits here |
|---|---|---|
| 1 | The constant, provisioning, reset, test setup | The behaviour change. Everything else describes it |
| 2 | Reworded empty-station sentences (core, web, api pins) | Administrate now exists and shows the old "nothing attached" warning until this lands |
| 3 | `platform_help` text and the Station Scope prompt section | Agent wording; api only |
| 4 | Glossary, FAQ, Getting Started, docs | Copy that names the two stations, last so it describes what the earlier slices built |

There is no migration and no seed change.

---

## Slice 1 — Provision Administrate and Playground

New and reset orgs get the two stations. A missing Sandbox definition fails provisioning.

**Files**

- New: `apps/api/src/constants/provisioned-stations.constants.ts` — `ProvisionedStation`, `PROVISIONED_STATIONS`.
- New: `apps/api/src/__tests__/constants/provisioned-stations.constants.test.ts`.
- New: `apps/api/src/__tests__/__integration__/services/provisioned-stations.integration.test.ts`.
- Edit: `apps/api/src/services/application.service.ts` — `provisionOrganizationWorkspace` loops over the constant, throws on a missing Sandbox definition and returns `void`; `provisionOrganizationInTx` re-reads the org; JSDoc.
- Edit: `apps/api/src/services/reset.service.ts` (`:294-299`) — no result read.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `ORGANIZATION_PROVISIONING_FAILED`.
- Edit: `apps/api/src/__tests__/__integration__/utils/application.util.ts` — `provisionTestOrg` seeds the connector definitions first.
- Edit (tests): `application.provision.test.ts`, `application.service.integration.test.ts`, `reset.service.integration.test.ts`, `ensure-provisioned.integration.test.ts`, `system-principal.guard.test.ts` (reason string).

**Steps**

1. **Unit tests (spec: constants, `application.provision`).**
   - The constant's invariants and its two pinned entries.
   - Provisioning: one Sandbox instance; one station per entry with the entry's name and description, system-owned; `replaceForStation` once per station with its slugs; a `station_instances` link only for Playground; `defaultStationId` is Administrate's id; resolves to `undefined`.
   - A missing Sandbox definition throws `ORGANIZATION_PROVISIONING_FAILED` and creates nothing.
   - `provisionOrganizationInTx` returns the re-read org.

   Run; they fail.
2. **Integration tests.**
   - `application.service.integration`: the cases at `:208-296` become: exactly two stations matching the constant; the Sandbox link on Playground only; the default is Administrate; a missing definition fails and leaves no org (it replaces "should still succeed if sandbox definition does not exist"); a custom tier without `view_management` still provisions and `resolveStationPacks` reports the pack unentitled.
   - `reset.service.integration` (`:211-290`): the same two stations and default after a reset.
   - `provisioned-stations.integration` (new): a member on Administrate gets `TOOL_PERMISSION_DENIED` from an RBAC write; a member on Playground gets it from `connector_entity_create` and `curated_view_attach`; the owner on Playground creates an entity and records, builds a view, attaches it and gets the rows from `sql_query` in one request store.

   Run; they fail.
3. **Implement** the constant, the service changes and the code. Unit and the three suites above go green.
4. **Test setup.** `provisionTestOrg` calls `new SeedService().seedConnectorDefinitions(db)` before provisioning. Then run every suite that provisions an org and fix its setup the same way where it calls provisioning directly: `ensure-provisioned`, the three `organization.router*` suites, `user-role.repository`, `audit-emission`, and the unit `metadata.middleware.test.ts`. The `demo-seed.*` suites must pass unchanged.
5. Lint, type-check, format.

**Done when:** every suite listed passes, and `"My Station"` appears nowhere in `apps/api/src` outside test fixtures that create their own station.

**Risk:** the throw. `teardownOrg` wipes `connector_definitions`, and today most suites that provision run without a `sandbox` definition and get an org with no station, silently. Step 4 exists to find them all: grep `provisionOrganizationFor|ensureProvisioned|createOrganizationForEmail|seedOrganization|provisionTestOrg|ResetService` under `__tests__` and run each hit. A suite that asserted on the station-less org needs its assertion updated, not its setup weakened.

---

## Slice 2 — Reworded empty-station sentences

A station without views or connectors reads as valid, and each sentence says what attaching one adds.

**Files**

- Edit: `packages/core/src/content/station-attachments.util.ts` — the three `missing` sentences, `STATION_ATTACHMENT_MISSING_ACTION`, the module header.
- Edit: `apps/web/src/components/StationAttachmentAlerts.component.tsx` — `severity="info"`, JSDoc.
- Edit (tests): core `__tests__/content/station-attachments.util.test.ts`; web `__tests__/StationAttachmentAlerts.test.tsx`, `__tests__/PortalHeaderMeta.component.test.tsx`, `__tests__/StationDetail.view.test.tsx`; api `__tests__/prompts/system.prompt.test.ts` (`:94-147`), `__tests__/tools/platform-help.tool.test.ts` (`attachments_missing`).
- Edit: `apps/web/src/stories/StationAttachmentAlerts.component.stories.tsx` if it carries the old text.

**Steps**

1. **Tests (spec: core station-attachments; web alerts; api prompt and help pins).** The three sentences, the action constant, `null` when both are attached, `noAccess` unchanged; the alert is `info` with each sentence and passes axe; the prompt and `platform_help` render the new sentence. Run; they fail.
2. **Implement** the util and the alert severity. They go green.
3. Root `npm run build`, then lint and type-check in core, web and api.

**Done when:** the old sentences ("…are attached to this station yet.") and "Ask someone who can edit the station to attach them." appear nowhere in `apps/` or `packages/` source or tests.

**Risk:** other tests that match the old text loosely (a regex on "No views"). Grep for `attached to this station` before pushing.

---

## Slice 3 — Agent wording: `platform_help` and Station Scope

**Files**

- Edit: `apps/api/src/tools/platform-help.tool.ts` — `SITUATION_PROSE.no_packs`.
- Edit: `apps/api/src/prompts/system.prompt.ts` — the always-rendered `## Station Scope` section before `## Response Style`.
- Edit (tests): `__tests__/tools/platform-help.tool.test.ts`, `__tests__/prompts/system.prompt.test.ts`.

**Steps**

1. **Tests.** `no_packs` says "attach the packs for what you want to do here, such as the data-query pack"; the prompt contains `## Station Scope` and its paragraph for an empty pack set and for a full one, placed before `## Response Style`, and names neither Administrate nor Playground. Run; they fail.
2. **Implement.** They go green.
3. Lint, type-check, format.

**Done when:** both suites pass, and "attach at least the data-query pack" is gone.

**Risk:** prompt-length or section-order pins elsewhere in `system.prompt.test.ts`. Run the whole file, not just the new cases.

---

## Slice 4 — Help content and docs

The glossary, FAQ and Getting Started state the scoping practice with the two stations as examples. The docs stop naming My Station.

**Files**

- Edit: `packages/core/src/content/glossary.util.ts` — Station, Default Station, Tool Pack.
- Edit: `packages/core/src/content/faq.util.ts` — the station and tool-pack answers.
- Edit: `apps/web/src/utils/getting-started.util.ts` — "Create a station".
- Edit: `docs/A11Y_AUDIT.md` (`:84`, `:145`), `packages/admin-cli/COMMANDS.md` (`org create`), `CLAUDE.md` ("Ownership & provenance").
- Edit (tests): core `__tests__/content/glossary.util.test.ts`, `__tests__/content/faq.util.test.ts`; web `__tests__/getting-started.util.test.ts`.

**Steps**

1. **Tests (spec: core glossary and FAQ; web getting-started).**
   - Station's definition contains "one set of goals or tasks" and names both stations; no other entry repeats that phrase.
   - Tool Pack still matches `/only attach the packs/` and points at Station.
   - Default Station names Administrate.
   - The station FAQ answer names both stations; no question is added or renamed.
   - "Create a station" names both stations.

   Run; they fail.
2. **Implement** the copy and the three doc edits. They go green.
3. Root `npm run build`, then the web Help tests and the site's tests (`npm run test` in `apps/site`), since both render this content. Lint.

**Done when:** the content suites pass in core, web and site, and `grep -rn "My Station" docs packages/admin-cli CLAUDE.md` finds nothing.

**Risk:** the marketing site renders the glossary and FAQ, so this wording is public once deployed. It describes what slice 1 ships.

---

## Sequence summary

| # | Commit (scope) | Gating check |
|---|---|---|
| 1 | `feat(api): provision Administrate and Playground stations (#848)` | provisioning unit + integration, every suite that provisions |
| 2 | `feat(core,web,api): reword the empty-station notice (#848)` | core, web and api pins; root build |
| 3 | `feat(api): station scope guidance for the agent (#848)` | `platform-help` and `system.prompt` suites |
| 4 | `docs(core,web): station scoping in help content (#848)` | content suites in core, web and site |

## Cross-slice notes

- **#847 edits the constant.** It adds `member_management` to Administrate's `builtinSlugs` and membership to its description. Slice 1's constant test pins both, so #847 updates that test too.
- **The demo seed is untouched.** On an org provisioned after slice 1, `portalai demo seed` attaches to whichever station its lookup returns first, until #1035 replaces it. Don't seed a new demo org in between.
- **`seed-org --all-toolpacks`** (the e2e seed) puts every pack on both stations of the fixture org. That is a fixture concern, and no e2e spec depends on the default station.
- **Docs in sync:**
  - user-facing help (glossary, FAQ, Getting Started): slice 4;
  - agent contract (`system.prompt.ts`, `platform_help`): slices 2 and 3;
  - `CLAUDE.md`, `COMMANDS.md`, `A11Y_AUDIT.md`: slice 4;
  - `docs/ACCESSIBILITY_CONFORMANCE_REPORT.md`: N/A, because the alert keeps its role and only its colour and text change;
  - `docs/DEPLOYMENT_SECURITY_REVIEW.md`: N/A, because there is no egress change.
- **Core changes need the root build** before pushing (slices 2 and 4).
- **Existing local orgs keep My Station.** To see the two stations locally, create a new org (`portalai org create --env local`) or reset one.

## Next step

Implementation starts on this branch with slice 1, tests first and one commit per slice, once the spec and plan are confirmed.
