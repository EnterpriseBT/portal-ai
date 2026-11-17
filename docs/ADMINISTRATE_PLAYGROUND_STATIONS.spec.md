# Administrate and Playground stations — Spec

**Issue:** [EnterpriseBT/portal-ai#848](https://github.com/EnterpriseBT/portal-ai/issues/848) · **Discovery:** `docs/ADMINISTRATE_PLAYGROUND_STATIONS.discovery.md`

This spec fixes the contract for provisioning two system-owned stations in every new or reset org, in place of My Station. It also covers the reworded empty-station sentences, the help and agent copy that states the station-scoping practice, and the tests that hold all of it. It builds on #1036 (attach views from a portal session), merged on 2026-11-17.

## Key decisions (flag for review)

1. **Provisioning reads a constant (D1).** `PROVISIONED_STATIONS` lists the stations; provisioning loops over it. #847 will add `member_management` and the membership wording by editing that constant.
2. **Two stations.**

   | Station | Default | Packs | Connector |
   |---|---|---|---|
   | Administrate | yes | `rbac_management` | none |
   | Playground | no | `data_query`, `entity_management`, `view_management` | Sandbox |

3. **A missing Sandbox definition throws (D2).** Provisioning fails and its transaction rolls back. `provisionOrganizationWorkspace` returns nothing. `provisionOrganizationInTx` returns the org as stored after provisioning.
4. **Entitlement is not checked at provisioning (existing behaviour).** A tier without one of the packs still provisions, and the pack shows as inactive.
5. **Empty-station sentences are reworded, not suppressed (D3).** A station works without views or connectors, and each sentence says what attaching one would add.
6. **Inferred, please confirm: the web alert for those sentences changes from `warning` to `info`.** The state is now described as valid, so a warning colour would contradict the text. The user decision covered the wording only.
7. **The glossary's "Station" entry owns the scoping principle (D4)**, pinned like Tool Pack's practice. Copy says "new organizations start with…", because existing orgs keep My Station.
8. **One generic scoping line in the agent's instructions**, naming no station (open question 2).
9. **The demo seed is not changed (D5).** Until #1035 replaces it, `demo seed` on an org provisioned after this ticket attaches its packs and connectors to whichever station its unordered lookup returns first.
10. **No backfill.** Existing orgs keep My Station. There is no migration.

## Scope

### In scope

- The `PROVISIONED_STATIONS` constant, provisioning and reset.
- The reworded empty-station sentences and their three consumers (web alert, system prompt, `platform_help`).
- `platform_help`'s `no_packs` text and the generic scoping line in the system prompt.
- Help content: glossary (Station, Default Station, Tool Pack), FAQ (station and tool-pack entries), Getting Started ("Create a station").
- "My Station" references that describe the provisioned station: tests, `docs/A11Y_AUDIT.md`, `packages/admin-cli/COMMANDS.md`.

### Out of scope

- `member_management` on Administrate (#847).
- The demo seed and `seed-org --all-toolpacks` (#1035).
- Backfilling or renaming stations in existing orgs.
- Per-user default stations.
- Test fixtures that only happen to use the label "My Station" for a station they create themselves (`CreateStationDialog.test.tsx`, `ShareDialog.test.tsx`, `dialog-single-flight.integration.test.tsx`, `station.router.integration.test.ts`, `rbac-authoring.contract.test.ts`). They don't describe the provisioned station.

## Surface

### `apps/api/src/constants/provisioned-stations.constants.ts` (new)

```ts
import type { BuiltinToolpackSlug } from "@portalai/core/registries";

/** A station every new or reset org is provisioned with (#848). */
export interface ProvisionedStation {
  name: string;
  /** States the station's purpose; shown on the station and in the picker. */
  description: string;
  builtinSlugs: readonly BuiltinToolpackSlug[];
  /** Attach the org's Sandbox connector instance. */
  attachSandbox: boolean;
  /** The org's `defaultStationId`. Exactly one entry sets it. */
  isDefault: boolean;
}

export const PROVISIONED_STATIONS: readonly ProvisionedStation[] = [
  {
    name: "Administrate",
    description:
      "Manage access through the assistant: shares on any plan, and custom roles, policies and groups where your plan includes them. No data is attached here.",
    builtinSlugs: ["rbac_management"],
    attachSandbox: false,
    isDefault: true,
  },
  {
    name: "Playground",
    description:
      "Build and share entities and views with the assistant, attach views to this or other stations, and query the data in the same session.",
    builtinSlugs: ["data_query", "entity_management", "view_management"],
    attachSandbox: true,
    isDefault: false,
  },
];
```

### `ApplicationService` (`apps/api/src/services/application.service.ts`)

```ts
static async provisionOrganizationWorkspace(
  organizationId: string,
  tx: Parameters<Parameters<typeof DbService.transaction>[0]>[0]
): Promise<void>;
```

In order, all on `tx`:

1. `seedSystemColumnDefinitions` and `seedRbacSystemPolicies`, unchanged.
2. Look up the `sandbox` connector definition. If it is missing, throw `new ApiError(500, ApiCode.ORGANIZATION_PROVISIONING_FAILED, "Sandbox connector definition not found. Run the global seed (db:seed or db:upgrade) before provisioning an organization.")`. Nothing is created.
3. Create the Sandbox connector instance exactly as today (name `Sandbox`, `status: "active"`, capability flags copied from the definition, `createdBy` system).
4. For each `PROVISIONED_STATIONS` entry, in order:
   - create the station with `name`, `description`, `organizationId`, `createdBy = SystemUtilities.id.system`;
   - `stationToolpacks.replaceForStation(station.id, { builtinSlugs }, { userId: systemId }, tx)`;
   - when `attachSandbox`, create the `station_instances` link to the Sandbox instance.
5. `organizations.update(organizationId, { defaultStationId: <the isDefault station's id> }, tx)`.
6. Log `{ organizationId, connectorInstanceId, stationIds, defaultStationId }`.

The JSDoc is rewritten to describe two stations and the throw.

`provisionOrganizationInTx` no longer patches `defaultStationId` into its copy of the org. After `provisionOrganizationWorkspace` it re-reads the org on `tx` and returns that row as `organization`. `db/create-org.ts` keeps printing `stationId: result.organization.defaultStationId` (now Administrate's id).

`ApiCode.ORGANIZATION_PROVISIONING_FAILED` is added to `apps/api/src/constants/api-codes.constants.ts`.

### `ResetService` (`apps/api/src/services/reset.service.ts:294-299`)

Calls `provisionOrganizationWorkspace(organizationId, tx)` without reading a result, and logs "Re-provisioned organization workspace" with no station id.

### Empty-station sentences (`packages/core/src/content/station-attachments.util.ts`)

`describeStationAttachmentGaps(...).missing` returns:

| Attached | Sentence |
|---|---|
| No views, no connectors | "No views or connectors are attached to this station. It works without them. Attach a view to query entity data here, or a connector to create and edit entities." |
| No views | "No views are attached to this station. Attach a view to query entity data here." |
| No connectors | "No connectors are attached to this station. Attach a connector to create and edit entities here." |
| Both attached | `null` |

`STATION_ATTACHMENT_MISSING_ACTION` becomes "Anyone who can edit the station can attach them." The `noAccess` sentences and `STATION_ATTACHMENT_NO_ACCESS_ACTION` are unchanged. The module header is updated to say a missing kind is optional and names what it adds.

Consumers pick the wording up from this one source:

- **Web:** `StationAttachmentAlertsUI` (`apps/web/src/components/StationAttachmentAlerts.component.tsx`) renders the sentence in an `Alert` with `severity="info"` (was `"warning"`). Its JSDoc changes from "warning" to "notice".
- **System prompt:** `system.prompt.ts` renders `_${gaps.missing}_` as today.
- **`platform_help`:** the `attachments_missing` situation still renders `${missing} ${STATION_ATTACHMENT_MISSING_ACTION}`.

### `platform_help` (`apps/api/src/tools/platform-help.tool.ts`)

`SITUATION_PROSE.no_packs` ends "…Open the station and attach the packs for what you want to do here, such as the data-query pack for questions about your data, then ask again." (was "attach at least the data-query pack").

### System prompt (`apps/api/src/prompts/system.prompt.ts`)

A new always-rendered section, placed immediately before `## Response Style`:

```
## Station Scope

This station is set up for one kind of work: the tool packs and data described above. When a request needs a tool pack or data that isn't on this station, say what is missing and suggest the user open a station set up for that work, or have someone who can edit this station add it. Don't present it as something the product can't do. Two cases have their own guidance above, which takes precedence: data that is attached but not shared with the user (they ask for access; nothing needs attaching), and a tool pack the plan doesn't include (a plan limit; it can't be added to a station).
```

When a `missing` sentence renders in Available Data, the prompt follows it with "That line describes the station; it isn't a request. Don't attach anything to the station unless the user asks."

### Help content

**Glossary, `packages/core/src/content/glossary.util.ts`**

- **Station** (definition): "A workspace that groups views, connector instances and tool packs so you can work with them in a portal. Scope a station to one set of goals or tasks and attach only what that work needs: unrelated connectors and tool packs don't share a station. New organizations start with two examples: Administrate, the default, with the access tools and no data, and Playground, with the Sandbox connector and the packs to build, share and query entities and views. Views and connectors are attached independently; anyone who can edit the station can attach any view or connector they can read. Views can be attached when creating or editing the station, or by the assistant with the Curated Views tool pack."
- **Default Station** (definition): "The station opened by default on your dashboard and used when you launch a portal without picking a station explicitly. New organizations start with Administrate as the default; set a different one from the Stations page."
- **Tool Pack**: the definition's last sentence becomes "…keep packs small and focused on a single domain, and only attach the packs a station absolutely needs (see Station for scoping a station to one kind of work)." The pack list is unchanged.

**FAQ, `packages/core/src/content/faq.util.ts`**

- **"What is a Station and why do I need one?"**: the answer gains "Keep each station to one kind of work. A new organization starts with two: Administrate, for managing access, and Playground, for building and querying data."
- **"What are tool packs?"**: the answer gains "Turn on only the packs a station's work needs."

No question is added or renamed, so the audited question list the suite pins (32 names) is unchanged.

**Getting Started, `apps/web/src/utils/getting-started.util.ts`**

- **"Create a station"** description: "Bundle the connector instances, views and tool packs one kind of work needs — for example data query and statistics for analysis. Keep unrelated work in separate stations: a new organization starts with Administrate (access) and Playground (the Sandbox data) as examples. A station is the workspace a portal runs against."

### Docs and reason strings

- `docs/A11Y_AUDIT.md:84,145`: "My Station" → "Playground".
- `packages/admin-cli/COMMANDS.md` (`org create`): "…Sandbox connector + the Administrate and Playground stations + `defaultStationId`"; `stationId` in `--json` is the default station (Administrate).
- `apps/api/src/__tests__/system-principal.guard.test.ts:42`: reason string "…the provisioned defaults (Sandbox, Administrate, Playground)".
- `CLAUDE.md` ("Ownership & provenance"): "…the defaults provisioned into a new org (the Sandbox connector, the Administrate and Playground stations)".

## Migration

None. No schema change, and existing orgs are not touched.

## Seed

None. `PROVISIONED_STATIONS` is read at provisioning and reset only. It is not a per-org seeded row that needs a backfill: the issue excludes existing orgs.

## TDD test plan

API: `npm run test:unit -- --testPathPattern <file>` and `npm run test:integration -- --testPathPattern <file>` from `apps/api`. Core and web: `npm run test:unit -- --testPathPattern <file>` from the package.

### `apps/api` — unit

- **`__tests__/constants/provisioned-stations.constants.test.ts`** (new)
  - exactly one entry has `isDefault`;
  - names are unique, non-empty and at most 120 characters; descriptions are non-empty;
  - every slug is a built-in toolpack slug, with no duplicates within a station;
  - the default station doesn't attach the Sandbox;
  - pins the two stations' names and slug lists.
- **`__tests__/services/application.provision.test.ts`**
  - creates one Sandbox instance and one station per constant entry, each `createdBy` system, with the constant's name and description;
  - calls `replaceForStation` once per station with that station's slugs;
  - creates a `station_instances` link only for the `attachSandbox` station;
  - sets `defaultStationId` to the `isDefault` station's id;
  - resolves to `undefined`;
  - a missing Sandbox definition throws `ORGANIZATION_PROVISIONING_FAILED` and creates no instance, station or link (replaces the "skips" case);
  - `provisionOrganizationInTx` returns the org row re-read after provisioning.
- **`__tests__/tools/platform-help.tool.test.ts`**: the `no_packs` prose, and `attachments_missing` composed from the new sentence and action.
- **`__tests__/prompts/system.prompt.test.ts`**: the empty-station lines (`:94-147`) re-pinned to the new sentences; the `## Station Scope` section is present for any pack set and names no station.
- **`__tests__/system-principal.guard.test.ts`**: still passes with the new reason string.

### `apps/api` — integration

- **`__tests__/__integration__/services/application.service.integration.test.ts`**
  - a new org has exactly two stations matching the constant (name, description, system-owned, packs, Sandbox link only on Playground), and `defaultStationId` is Administrate;
  - an org on a custom tier without `view_management` still provisions, and `EntitlementService.resolveStationPacks` reports that pack as unentitled on Playground.
- **`__tests__/__integration__/services/reset.service.integration.test.ts`**: after a reset the org has exactly the same two stations and default (replaces the one-station assertions at `:218-240`).
- **`__tests__/__integration__/services/ensure-provisioned.integration.test.ts`**: still passes; any default-station assertion follows the constant.
- **`__tests__/__integration__/services/provisioned-stations.integration.test.ts`** (new), on a freshly provisioned org with an owner and a default member, tools built with `ToolService.buildAnalyticsTools`:
  - a member on Administrate: an `rbac_management` write returns `TOOL_PERMISSION_DENIED`;
  - a member on Playground: `connector_entity_create` on the Sandbox and `curated_view_attach` both return `TOOL_PERMISSION_DENIED`;
  - the owner on Playground, in one request store: create an entity on the Sandbox, add records, create a view, attach it to Playground, and `sql_query` returns the records.
- The `demo-seed.*.integration.test.ts` suites still pass unchanged (they take the first station the same way the seed does).
- **Test setup.** `teardownOrg` wipes `connector_definitions`, and today most suites that provision an org run without a `sandbox` definition and rely on the silent skip. With the throw they would fail. `provisionTestOrg` (`__integration__/utils/application.util.ts`) therefore seeds the connector definitions first (`new SeedService().seedConnectorDefinitions(db)`, as `demo-seed.util.ts` does), and the suites that call provisioning directly do the same: `ensure-provisioned`, `organization.router` (three files), `user-role.repository` and `audit-emission`.

### `packages/core`

- **`__tests__/content/station-attachments.util.test.ts`**: the three sentences, the action constant, and `null` when both are attached; `noAccess` unchanged.
- **`__tests__/content/glossary.util.test.ts`**
  - Station's definition contains "one set of goals or tasks" and names Administrate and Playground;
  - no other entry repeats "one set of goals or tasks" (single source);
  - Tool Pack still matches `/only attach the packs/` and points at Station;
  - Default Station names Administrate.
- **`__tests__/content/faq.util.test.ts`**: the station answer names both stations; no question is added or renamed.

### `apps/web`

- **`__tests__/StationAttachmentAlerts.test.tsx`**: the three sentences, the `info` alert, nothing when both are attached, axe.
- **`__tests__/PortalHeaderMeta.component.test.tsx`** and **`__tests__/StationDetail.view.test.tsx`**: re-pinned sentences.
- **`__tests__/getting-started.util.test.ts`**: the "Create a station" description names both stations.

**Totals ≈ 45 cases** (api unit ≈ 18, api integration ≈ 9, core ≈ 10, web ≈ 8).

## Acceptance criteria

- [ ] A newly provisioned org has exactly two stations: **Administrate** (the org default; `rbac_management`; no connector or views) and **Playground** (Sandbox connector; `data_query`, `entity_management`, `view_management`). Both are system-owned and carry the descriptions above.
- [ ] Resetting an org yields the same two stations and the same default.
- [ ] Existing orgs are unchanged: My Station keeps its name, attachments and default status.
- [ ] A member who opens a portal on Administrate or Playground gets typed permission refusals from tools they lack permission for, never a crash.
- [ ] On a tier that doesn't include one of a station's packs, provisioning still succeeds and that pack shows as inactive.
- [ ] An admin on Playground can create an entity and records, build a view, attach it to Playground and query it in one portal session.
- [ ] Administrate shows the reworded notice ("No views or connectors are attached to this station. It works without them…") as an info alert, and the agent and `platform_help` use the same sentence.
- [ ] The glossary, FAQ and Getting Started text state the station-scoping practice and name Administrate and Playground as the examples new orgs start with. The pinning tests pass.
- [ ] `portalai org create --json` still returns `stationId`, now the Administrate station's id.
- [ ] Provisioning against a database with no `sandbox` connector definition fails and creates nothing.

## Risks & rollback

- **Fail-closed on an unseeded database.** Provisioning used to skip silently; it now throws. In every real environment the definition exists (`db:upgrade` and `db:seed` write it), so the only effect is that a broken install fails loudly at first login instead of producing an org with no stations. The 500's message is logged, not sent to the client.
- **Fail-open on entitlement**, as today: a tier lacking a pack still provisions.
- **The default station has no data.** Members land on Administrate by default and its tools refuse most of what they ask. That is the requested behaviour (org-wide default); the reworded notice and the station's description say what it is for.
- **Demo seed between #848 and #1035.** On an org provisioned after this ticket, `portalai demo seed` attaches to whichever of the two stations its lookup returns first. Existing demo orgs are unaffected. Mitigation: land #1035 before seeding a new demo org.
- **Public copy.** The glossary and FAQ are also rendered on the marketing site, so the new wording is a public statement. It says what ships.
- **Rollback:** revert the PR. Orgs provisioned in the meantime keep their two stations, which are ordinary stations and remain valid.

## Files touched

**New**
- `apps/api/src/constants/provisioned-stations.constants.ts`
- `apps/api/src/__tests__/constants/provisioned-stations.constants.test.ts`
- `apps/api/src/__tests__/__integration__/services/provisioned-stations.integration.test.ts`

**Edit (api)**
- `apps/api/src/services/application.service.ts`
- `apps/api/src/services/reset.service.ts`
- `apps/api/src/constants/api-codes.constants.ts`
- `apps/api/src/tools/platform-help.tool.ts`
- `apps/api/src/prompts/system.prompt.ts`

**Edit (core)**
- `packages/core/src/content/station-attachments.util.ts`
- `packages/core/src/content/glossary.util.ts`
- `packages/core/src/content/faq.util.ts`

**Edit (web)**
- `apps/web/src/components/StationAttachmentAlerts.component.tsx`
- `apps/web/src/utils/getting-started.util.ts`

**Edit (docs)**
- `docs/A11Y_AUDIT.md`
- `packages/admin-cli/COMMANDS.md`
- `CLAUDE.md`

**Edit (test setup)**
- `apps/api/src/__tests__/__integration__/utils/application.util.ts`

**Tests:** the files named in the TDD plan.

## Next step

`docs/ADMINISTRATE_PLAYGROUND_STATIONS.plan.md` slices this into about five TDD commits on this branch:
1. The constant, provisioning and reset, with their unit and integration tests.
2. The provisioned-stations integration test (member refusals and the Playground loop).
3. The reworded empty-station sentences and their three consumers.
4. The `platform_help` text and the Station Scope prompt section.
5. Help content, Getting Started and the docs.
