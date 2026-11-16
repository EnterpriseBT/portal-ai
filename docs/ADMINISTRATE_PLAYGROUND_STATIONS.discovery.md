# Administrate and Playground stations — Discovery

**Issue:** [EnterpriseBT/portal-ai#848](https://github.com/EnterpriseBT/portal-ai/issues/848)

**Why this exists.** Every new org is provisioned with one system-owned station, **My Station**: the Sandbox connector plus `data_query`, set as the org default. A single general-purpose station teaches the wrong habit: it makes a station look like a catch-all. Stations work best scoped to one set of goals. It also gives an admin nowhere already set up for administering the org through the agent.

New orgs and reset orgs should instead get two purpose-built stations that model the practice. Each one supports one workflow:

1. **Administrate**, the org default: managing access and org membership. It has `rbac_management`, no data, and gains `member_management` from #847's own PR (split out 2026-11-16).
2. **Playground**, which replaces My Station: managing and sharing entities and views, attaching views to this station or others, and querying the data in the same portal session. It has the Sandbox connector and `data_query` + `entity_management` + `view_management`. Attaching views from a session is #1036, which lands first.

The help content should state the principle and use these two stations as its worked examples.

This is the provisioning change that makes a new org's first two stations the example of how to build one.

## The current shape

### Provisioning

`ApplicationService.provisionOrganizationWorkspace` (`apps/api/src/services/application.service.ts:773-871`) runs on the caller's `tx` and never opens its own transaction.

| Step | Where | Note |
|---|---|---|
| System column definitions + RBAC system policies | `:780`, `:785` | Unaffected |
| Sandbox definition lookup | `:788-797` | **If it's missing, it returns `{stationId: null}` before any station exists** |
| Sandbox `connector_instances` row | `:801-819` | `createdBy` system |
| Station `"My Station"`, description `"Default organization sandbox station"` | `:822-831` | `createdBy` system (#641 provisioned default) |
| `stationToolpacks.replaceForStation(…, {builtinSlugs:["data_query"]})` | `:834-839` | Repo call, so it skips the route's entitlement check |
| `station_instances` link | `:842-852` | |
| `organizations.defaultStationId` | `:855-859` | Single org-wide column (`organizations.table.ts:26`) |

**Callers.**
- `provisionOrganizationInTx` (`:731`, which returns `defaultStationId` at `:754`). It is reached through:
  - `ensureProvisioned` (`:384`, first login, `metadata.middleware.ts:71`)
  - `provisionOrganizationFor` / `createOrganizationForEmail` (`db/create-org.ts:32`)
  - `seedOrganization` (`db/seed-org.ts:58`)
  - the admin CLI (`packages/admin-cli/src/commands/provision.ts:52,87`)
- **Reset** (`reset.service.ts:295`). It nulls `defaultStationId` first (`:208`), then cascades and re-provisions, so a reset org matches a fresh one (#295).

### Code that assumes there is one station

| Consumer | Where | Behaviour with two stations |
|---|---|---|
| Demo seed: `seedToolpacks` (every built-in pack) and `ensureStationLinks` (demo connectors) | `demo-seed.service.ts:350-357`, `:513-518` | Takes `stations.findByOrganizationId(orgId)[0]`. That query has no `ORDER BY` (`stations.repository.ts:28-38`), so the demo data could land on Administrate |
| `db:seed:org --all-toolpacks` (the e2e seed, devops `local`) | `seed-org.ts:36-49`, `packages/e2e/package.json:21`, `devops-cli/src/commands/local.ts:175` | Puts every pack on **every** station. Fixture-only |
| Reset integration test | `reset.service.integration.test.ts:218,219,240` | Expects exactly 1 station, "My Station", `["data_query"]` |
| Provisioning tests | `application.provision.test.ts:168-231` (and `:195`), `application.service.integration.test.ts:208-260` | Pin My Station and `data_query` |
| `system-principal.guard.test.ts:42` | Reason string | Names My Station |

The e2e specs don't depend on the default station: `core-loop.spec.ts:101-118` creates its own.

### Entitlement

- **Station routes check entitlement when packs are added.** `denyUnentitledBuiltins` (`station.router.ts:115-136`, on create and PATCH) refuses newly added packs the plan lacks.
- **Provisioning doesn't.** It goes through the repo, so it never hits that check.
- **Reads split the packs.** `EntitlementService.resolveStationPacks` (`entitlement.service.ts:111`) splits a station's packs into effective and unentitled. The web marks unentitled ones with `UNENTITLED_PACK_BADGE` / `UNENTITLED_PACK_REASON` (`apps/web/src/utils/tool-packs.util.ts:93`).
- **Catalog tiers include all four packs.** Standard (`tier-catalog.ts:131-136`) and plus (`:167-175`) list `data_query`, `entity_management`, `rbac_management` and `view_management`. Pro and enterprise include every pack. A custom DB tier can still lack one, which is the acceptance criterion's "Inactive on your plan" case.

### Members on system-owned stations

`MemberAccess` (`seed.service.ts:745-779`) grants members read on stations, portals, connector instances and curated views with `created_by_system`. A member can therefore open a portal on either station but can't edit or share it.

On Administrate, RBAC tools re-throw 403s (`rbac/rbac-tool.util.ts:34-53`), which `wrapWithPermissionGate` turns into `TOOL_PERMISSION_DENIED` (`permission-gate.service.ts:63-67`). Authoring also needs custom-RBAC entitlement (`tools.service.ts:840-846`).

On Playground:
- View tools return `TOOL_PERMISSION_DENIED` / `TOOL_TARGET_NOT_FOUND` (`tools.service.ts:893-897`).
- `entity_management` writes on the system-owned Sandbox connector need write on it, which members don't have (#829: no carve-out for system-owned objects). Members get typed refusals there too. Nothing is exempted: an admin grants write through RBAC, or promotes the member (decided 2026-11-16).

The "typed refusals, never a crash" criterion is existing behaviour that needs a test, not new code.

### Help and agent content

| Surface | Where | Today |
|---|---|---|
| Glossary "Station" | `glossary.util.ts:239` | A workspace of views, connectors and packs. Says nothing about scope |
| Glossary "Tool Pack" | `glossary.util.ts:287-293` | Holds the single-sourced "only attach the packs a station absolutely needs". `glossary.util.test.ts:342-353` pins it to this entry only |
| Glossary "Default Station" | `glossary.util.ts:521` | Opened by default on the dashboard |
| FAQ | `faq.util.ts:55` (station), `:105` (inactive pack), `:249` (tool packs), `:257` | `faq.util.test.ts:60-98` pins the question strings and a count of 32 |
| Getting started | `getting-started.util.ts:31-35` ("Create a station"), `:40` | `:40` repeats the pack wording |
| Empty-station sentences | `station-attachments.util.ts:46` | Rendered by `StationAttachmentAlerts.component.tsx`, `system.prompt.ts:804-810` and `platform-help.tool.ts:240`; pinned at `system.prompt.test.ts:94-147` |
| Pack guidance | `system.prompt.ts:584-625` (`rbac_management`), `:627+` (`view_management`) | Already relays `TOOL_PERMISSION_DENIED`. Nothing on how to split work across stations |

**Drift in the issue's references.** `docs/DB_RESET.md` doesn't exist. The only "My Station" in durable docs is `docs/A11Y_AUDIT.md:84,145`, which is a record of a walk already done.

## The design space

### Decision 1 — How provisioning creates the two stations

**A. Inline in `provisionOrganizationWorkspace`.** Keep today's style and write the two blocks one after the other.

**B. Data-driven.** A `PROVISIONED_STATIONS` constant (name, description, builtin slugs, `attachSandbox`, `isDefault`) and one loop that creates each station. #847's follow-up becomes a one-line slug edit, and the tests can assert against the same constant.

| | A | B |
|---|---|---|
| Diff size | Smallest | Small, plus one constant |
| #847's follow-up | Edits a code block | Edits one array |
| Tests | Restate literals | Pin the constant, then assert the DB matches it |
| Sandbox lookup | Inline | Once, before the loop, for the `attachSandbox` station |

**Lean: B.** It's the shape the next change (#847) wants, and it makes "fresh org = reset org" one constant both paths read. The constant lives in `apps/api` next to the service, because only provisioning uses it.

### Decision 2 — A missing Sandbox definition, and what provisioning returns

**The missing definition.** The `sandbox` connector definition is a global seed row (`seed.service.ts:446`). `db:upgrade` writes it on every deploy (#581), `npm run dev` writes it through `db:seed`, and the integration tests that provision seed it first (`utils/application.util.ts`). It can only be missing on a database that was migrated but never seeded, which is a broken install. The skip at `application.service.ts:791-797` has been there since the Sandbox connector was added, and it is the worst way to handle that case: signup succeeds and the org is silently created without its data station.

**Decided (2026-11-16): throw.** Provisioning throws when the definition is missing, so the caller's transaction rolls back and the broken install shows up immediately. Both stations are always created. The missing-definition unit test in `application.provision.test.ts` changes from "skips" to "throws".

**The return value.** `provisionOrganizationWorkspace` returns `{ stationId }` today, which has three uses:
- `provisionOrganizationInTx` patches it into the org object it returns (`:731`, `:754`);
- `create-org.ts:39` prints it in `org create --json`, reading `result.organization.defaultStationId`;
- `reset.service.ts:294-299` logs it.

None of them needs the return value. **Decided: it returns nothing.** `provisionOrganizationInTx` returns the org as it stands after provisioning, so `org create --json` keeps its `stationId` field. Nothing outside provisioning should need to identify a provisioned station (#1035 creates its own demo station rather than looking up Playground).

### Decision 3 — How a station with no views or connectors is described

A station works with no views or connectors attached. Administrate needs neither, because its tools read and change the control plane (access, roles, curated views), not entity data. But `describeStationAttachmentGaps` (`station-attachments.util.ts:46`) says "No views or connectors are attached to this station yet." and pairs it with `STATION_ATTACHMENT_MISSING_ACTION` ("Ask someone who can edit the station to attach them."). The web alert, the system prompt and `platform_help`'s `attachments_missing` situation all render it, and the last two read it as a problem to fix.

How data reaches a portal session (surveyed):
- **`sql_query` (`data_query`) reads only through curated views attached to the station.** `PortalSqlService.resolveGrantedViewColumns` (`portal-sql.service.ts:580+`) builds the session's view set from `stationViewsRepo.findByStationId` (`:616`), intersected with what the caller can read.
- **An attached connector is reached by `entity_management`'s write tools** (record create, update and delete, entity, field mapping and transform tools). That's what the module header at `station-attachments.util.ts:6-9` says.
- **The agent can't attach a view to a station.** `curated_view_create` "does not attach the view to any station", and the pack description says attaching happens when the station is created or edited.

**A. Suppress the gap for control-plane-only stations,** with a pack-derived predicate.

**B. Reword the sentences** (decided 2026-11-16) so a missing kind reads as optional and names what it would enable: views to query entity data, connectors to create and edit it. The station still works without them. The missing-gap "action" stops telling the user to get them attached and says when they'd want them instead.

**Decided: B.** One rewording in `station-attachments.util.ts` reaches all three surfaces through #674's single source, and no capability classification is needed. `platform_help`'s `attachments_missing` situation and the system prompt line follow the new wording; `system.prompt.test.ts:94-147` and the alert tests re-pin it. The `noAccess` sentences (#676) are unchanged, because those items *are* attached.

### Decision 4 — Where the station-scoping principle lives in help content

`glossary.util.test.ts:342-353` single-sources the pack advice on "Tool Pack".

**A. Extend "Tool Pack"** with the station-scoping sentence.

**B. A new single source on "Station":** "Scope a station to one set of goals or tasks, and attach only what that needs: unrelated connectors and toolpacks don't share a station." It uses Administrate and Playground as the example and gets a pin like Tool Pack's. Tool Pack keeps its context-budget reason and points to Station. The FAQ "What is a Station…" answer, the "Create a station" step and "Default Station" (now Administrate) then reword to match.

**Lean: B.** Scoping is a property of the station; pack budget is a property of the pack. Two pinned single sources, each about its own term, is clearer than one longer entry.

### Decision 5 — The demo seed (out of scope)

Decided 2026-11-16: this ticket changes provisioning only, and the demo seed is not edited. One consequence to record: `DemoSeedService` takes `stations.findByOrganizationId(orgId)[0]` (`demo-seed.service.ts:350-357`, `:513-518`), which has no `ORDER BY`. On a freshly provisioned or reset demo org it may attach the demo connectors and every pack to either Administrate or Playground. #1035 resolves it by replacing `demo seed --org` / `demo reset` with `demo create`, which provisions a fresh org per demo and creates its own demo station for the dataset, so it never has to identify a provisioned one. #848 doesn't depend on it.

## Tradeoff comparison

| | D1 B (constant) | D2 (throw, return nothing) | D3 B (reworded sentences) | D4 B (Station owns scoping) |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| Packages | api | api | core (+ api/web pins) | core, web, api (prompt) |
| Schema change | No | No | No | No |

## Recommendation

1. `provisionOrganizationWorkspace` reads a `PROVISIONED_STATIONS` constant:
   - **Administrate**: `rbac_management`, no connector, the default. #847 adds `member_management` to the constant.
   - **Playground**: Sandbox instance, `data_query` + `entity_management` + `view_management`.

   Both are created with `createdBy = SystemUtilities.id.system`, and each has a description stating its purpose.
2. Provisioning throws when the `sandbox` definition is missing, rolling back the caller's transaction, so both stations always exist. `provisionOrganizationWorkspace` returns nothing, and `provisionOrganizationInTx` returns the org as it stands after provisioning (`org create --json` keeps its `stationId`).
3. Packs attach through `replaceForStation` as they do today. Provisioning never checks entitlement, so a tier without a pack still provisions and shows the pack as inactive.
4. Reset re-provisions through the same function, so a reset org has the same two stations. Existing orgs are not touched.
5. `describeStationAttachmentGaps`' `missing` sentences and `STATION_ATTACHMENT_MISSING_ACTION` are reworded: a station works without views or connectors, and a missing kind names what it would enable (views to query entity data, connectors to create and edit it). The web alert, the system prompt and `platform_help` pick it up from that single source.
6. The glossary "Station" entry owns the scoping principle (pinned, with Administrate and Playground as examples). "Tool Pack" keeps the budget reason. "Default Station", the FAQ station and tool-pack answers, and the "Create a station" step are reworded to match.
7. `docs/A11Y_AUDIT.md`'s two My Station mentions (`:84`, `:145`) become Playground.
8. Tests:
   - Provisioning and reset pin the two stations against the constant.
   - A member's portal gets typed refusals from `rbac_management` on Administrate, and from `view_management` / `entity_management` writes on Playground.
   - A custom tier without `view_management` still provisions.

## Open questions

1. **Querying on Playground (resolved 2026-11-16).** `data_query`'s `sql_query` reads only curated views attached to the station (D3), and no agent tool could attach one, so data created on Playground couldn't be queried without leaving the portal. #1036 adds `curated_view_attach` / `curated_view_detach` / `station_list` to `view_management`. With them, an admin on Playground creates an entity, builds a view, attaches it to Playground (or to another station already shared with members) and queries it in the same turn. Members follow the same permissions and get typed refusals; there are no exceptions. #848 depends on #1036 and lands after it.
2. **Should the system prompt describe station scoping?** For example, when a request needs a pack or data this station doesn't have, the agent would suggest another station rather than telling the user to attach it here. **Lean: yes, one generic line, without naming stations.** Names are editable, and existing orgs still have My Station.
3. **`platform_help`'s `no_packs` text says "attach at least the data-query pack".** **Lean: reword it** to "the packs for what you want to do here, such as the data-query pack for questions about your data", to match the scoping principle.
4. **Descriptions.** **Lean:**
   - Administrate: "Manage access and membership through the assistant: policies, roles, groups and shares. No data is attached here."
   - Playground: "Build and share entities and views with the assistant, attach views to this or other stations, and query the data in the same session."

   The final copy belongs in the spec.
5. **`docs/DB_RESET.md`** is named in the issue but doesn't exist, so there's nothing to update. `A11Y_AUDIT.md` is cleaned up (Recommendation 7, decided 2026-11-16).

## Enterprise-scale considerations

- **Concurrency & correctness.** Lean: no new risk. Both stations are created in the caller's single transaction, and `ensureProvisioned` and reset already serialize provisioning. The default is set after both stations exist, in the same transaction.
- **Accuracy & auditability.** Lean: system-owned rows follow #641's provisioned-default category. Nothing new is audited.
- **Failure modes.** Lean: fail-open on entitlement (a missing pack is shown inactive, not refused), as provisioning does today. A missing Sandbox definition is a broken install (the global seed didn't run), so provisioning fails closed and rolls back rather than creating a half-built org.
- **Scale & unbounded growth.** N/A because it's one extra station row and two pack rows per org.
- **Multi-tenancy.** Lean: unchanged. Every row is org-scoped. Members read both stations through `created_by_system` and can't edit them.
- **Contract stability.** Lean: no API or model change. The reworded sentences apply to every station, including ones users build, and #847 only edits the constant.
- **Data lifecycle.** N/A because there's no retention or window. Existing orgs are deliberately left as they are.

## What this doesn't decide

- Attaching `member_management`. That's #847, which edits the constant.
- The view-attach tools. That's #1036, which lands first.
- Backfilling or renaming stations in existing orgs. The issue decided against it.
- Per-user default stations. The default stays org-wide.
- The demo seed's choice of station (D5, #1035).
- Whether `--all-toolpacks` should respect scoping. It's a fixture, and nothing here depends on it.

## Next step

`docs/ADMINISTRATE_PLAYGROUND_STATIONS.spec.md` fixes the constant, the station descriptions and the reworded empty-station copy. `.plan.md` then slices the work in this order:
1. Provisioning, reset and the demo seed (api) behind the constant, with the provisioning and reset tests.
2. The reworded empty-station sentences and their pins.
3. Help content and its pins.
4. Prompt and `platform_help` wording.

Each slice is one green commit.
