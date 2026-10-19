# Object provenance: agent-generated vs system-created — Discovery

**Issue:** [EnterpriseBT/portal-ai#641](https://github.com/EnterpriseBT/portal-ai/issues/641)

**Why this exists.** Ownership in the RBAC model is `createdBy`, and "the platform provisioned this" is the `created_by_system` condition: `createdBy === SystemUtilities.id.system`, a sentinel principal. As curated views (#599) and always-live pins (#640) landed, that sentinel risked being asked to mean two things:
- a platform seed with no human owner, which is correct;
- an object the agent produced in a portal session.

Stamping the second kind as system-owned would strip it from the user who guided the agent. `visibilityPredicate` would resolve it as system-owned, so `created_by_caller` would never match and the user couldn't share it.

The PRD settles the target. A session-produced object is owned by the **prompting user**, carries a separate provenance marker that never affects ownership, and shows a "Created in a portal session" badge to anyone who can read it. `created_by_system` is reserved for platform seeds.

The survey changes the size of the problem. **No agent tool stamps the system id today.** Every object-creating tool already writes the caller's `userId`. What's missing is the provenance half, on types that have none, plus a guard so the system sentinel can't creep into session paths later. This is the provenance column, the audit and the guard that keep `created_by_system` meaning "platform seed".

## The current shape

### The system principal and who writes it

`SystemUtilities.id.system` is `environment.SYSTEM_ID` (`apps/api/src/utils/system.util.ts:39`, `environment.ts:78`): `"SYSTEM"` in local/staging, a UUID in prod (`docs/PROD_PROVISIONING.runbook.md:266`).

| Writer | Location | Classification |
|---|---|---|
| Tiers, connector definitions, system column definitions, RBAC system roles/policies | `seed.service.ts:405, 448–534, 586, 624` | Platform seed: **keep** |
| Demo org / fixture seed (`SEED_USER`) | `demo-seed.service.ts:60…597`, `seed-org.ts:46`, `application.service.ts:432–521` | Fixture seed: keep |
| Org provisioning on signup: the org, owner membership, default Sandbox instance, "My Station", its toolpack | `application.service.ts:590–730` (`provisionOrganizationWorkspace`) | Platform-provisioned defaults inside a user's org; members read them via `created_by_system`. **Keep, and name the category** |
| User rows, seat/role materialize, commercial events, tier-grant `updatedBy` | `application.service.ts:181`, `seat.service.ts:785–840`, `billing.service.ts:412`, `marketplace.service.ts:106`, `tier-grant.service.ts:221–341` | Identity/billing housekeeping, not RBAC-owned objects: keep |
| `wide_table_columns` add/retire, `map_dissolve_geometries` | `wide-table-reconciler.service.ts:617–687`, `dissolve-precompute.processor.ts:303` | Platform materializations of user data, internal tables not authorized by `createdBy`: keep |
| **Literal `"SYSTEM"` fallbacks** | `bulk-transform.processor.ts:62` (stamps `entity_records` audit columns), `bulk-geocode.processor.ts:247` (cost-gate actor) | **Fix.** In prod `"SYSTEM"` is neither a user nor the system id; in local it accidentally satisfies `created_by_system`. Back-compat for jobs enqueued before the tool forwarded `userId` |

### The condition

- `PERMISSION_CONDITIONS` is at `packages/core/src/models/permission.model.ts:116–120`, documented at `:103–106`. The DB CHECKs list it at `permission-grants.table.ts:65` and `permission-statements.table.ts:54`.
- `permission-set.ts` uses it in three places:
  - `can()`'s create probe uses the system id (`:240–247`);
  - `visibilityPredicate` ORs `createdBy = system` (`:307–310`);
  - `matches` (`:379–383`).
- `MemberAccess` grants read on every `DATA_RESOURCE_TYPES` type via `created_by_system` (`seed.service.ts:749–782`). That's how members see the provisioned Sandbox and station.
- `CREATE_RULES.none` means "system creates" (`permission.service.ts:119–136`).

### Agent session creation paths

`PortalService` calls `ToolService.buildAnalyticsTools(organizationId, stationId, userId, portalId)` (`portal.service.ts:742`, `tools.service.ts:455–468`). Tools get these as closure arguments. There is no shared tool-context type, and no session or message id. `portalId` reaches only `transform_entity_records` and `bulk_geocode_records`.

| Type an agent session produces | Tool | `createdBy` | Provenance today |
|---|---|---|---|
| Entity record | `entity-record-create.tool.ts:151` | caller | `origin = 'portal'` (`entity-records.table.ts:16–27`), no portal id |
| Connector entity | `connector-entity-create.tool.ts:144` | caller | none |
| Field mapping | `field-mapping-create.tool.ts:158` | caller | none |
| Role, policy, group | `tools/rbac/*.tool.ts:59–67` via services with `ctx` | caller | RBAC audit log `userAgent: "portal-agent"` (`rbac-tool.util.ts:18–21`) |
| Job (transform, geocode) | `transform-entity-records.tool.ts:729`, `bulk-geocode-records.tool.ts:217` | caller | `metadata.portalId` (redacted for non-creators, #692) |
| Pin | Not a tool: the user pins a block (`POST /api/portal-results`, `portal-results.router.ts:164–255`) | caller | `portal_results.portalId`, `messageId`, `blockIndex` (`portal-results.table.ts:42–44`) |

No tool creates curated views, tags, groups of entities, stations or column definitions.

### Schema and UI mechanics

- `baseColumns` comes from `CoreSchema` (`packages/core/src/models/base.model.ts:14–22`, guard at `apps/api/src/db/schema/base.columns.ts:95–103`), and **all 43 tables** spread it. A provenance field on `CoreSchema` would add a column to 43 tables, most of which no session can produce.
- Migrations are expand-only (`lint:migrations`); the latest is `0126`.
- No UI shows "Created by" today. The reusable patterns are `MetadataList` `variant: "chip"` items (`packages/core/src/ui/MetadataList.tsx`), the column-definition "Origin" chip (`ColumnDefinition.component.tsx:90–98`) and the record "Origin" chip (`EntityRecordMetadata.component.tsx:41`).

## The design space

### Decision 1 — Marker shape

- **A. Boolean** `generated_in_session`. Answers the PRD's question and nothing more. Can't tell which session, and can't be audited back to a conversation.
- **B. Nullable session reference** `source_portal_id`. Set when a portal session created the object; the API derives `sessionGenerated = sourcePortalId != null`. Auditable down to the portal, and it matches what pins, the usage ledger and job metadata already record.
- **C. Generalize records' `origin` enum** to every type. A third vocabulary, and still no session reference.

| | A boolean | B portal reference | C origin enum |
|---|---|---|---|
| Answers "was this agent-made" | yes | yes (derived) | yes |
| Audit back to the session | no | yes | no |
| Matches existing fields | no | pins, ledger, job metadata | records only |

**Lean: B.** The cost is the same as a boolean, and an auditor asking "which conversation made this role?" gets an answer. The message id isn't threaded through tools today; the portal is the session.

### Decision 2 — Which types carry it

- **A. Every table**, via `CoreSchema`. That's 43 columns, mostly on types no session can produce. Speculative.
- **B. Types a session produces today.**
  - New column on connector entities, field mappings, roles, policies and groups.
  - Entity records gain `source_portal_id` beside `origin`.
  - Pins **derive** it from their existing `portal_results.portalId`.
  - Jobs keep `metadata.portalId`.
- **C. B, plus curated views and stations** in anticipation of tools that don't exist.

**Lean: B.** Each column has a real writer. The future-tool case is covered by the developer guidance and the guard (Decision 4): a new session-creating tool must set the column, the same way it must set `createdBy`. Jobs stay as they are: their payloads are creator-only by design (#692), and nobody has asked for a job badge.

### Decision 3 — Threading the session into tools

- **A. Pass `portalId` as another closure argument** to each creating tool's `.build(...)`. It's a small, mechanical change, and the pattern already exists for transform and geocode.
- **B. Introduce a `ToolExecutionContext {organizationId, stationId, userId, portalId}`** and migrate every tool to it. Cleaner, but it touches roughly 40 tools for a field six of them use.

**Lean: A.** Keep the existing shape. A context refactor is a separate decision with its own value.

### Decision 4 — Keeping `created_by_system` honest

- **A. Docs only.**
- **B. Docs plus a guard test.** It fails CI on `SystemUtilities.id.system`, or a `"SYSTEM"` literal, written as `createdBy` outside an allowlist (the seed, provisioning and housekeeping files above), the same shape as the repo's other `*.guard.test.ts`. A second check fails a creating tool built without `portalId`.
- **C. A runtime assertion** in repositories that rejects the system id on session paths. That needs request context in the data layer, which this codebase doesn't carry.

**Lean: B.** It matches how this repo holds every other convention: a guard with an allowlist that only shrinks.

### Decision 5 — The literal `"SYSTEM"` fallbacks

- **A. Read the job row's `createdBy`** when `bullJob.data.userId` is absent. The job is the caller's own row, so this stamps the real user.
- **B. Throw `UnrecoverableError`** for a job without `userId`.

**Lean: A.** It's correct for any queued legacy job and never strands work. The jobs row always has `createdBy`.

## Tradeoff comparison

|  | D1: portal reference | D2: today's types | D3: closure argument | D4: guard | D5: job row actor |
|---|---|---|---|---|---|
| Migration | yes (nullable columns) | 6 tables | no | no | no |
| Contract change | additive API field | additive | none | none | none |
| Spread to spec | yes | yes | yes | yes | yes |

## Recommendation

1. Add a nullable `source_portal_id text` (no FK; portals soft-delete) to `connector_entities`, `field_mappings`, `entity_records`, `roles`, `permission_policies` and `groups`, in one expand-only migration with no backfill.
2. Each of those types' Zod models gains `sourcePortalId: string | null`. Its API payload carries `sourcePortalId` and a derived `sessionGenerated: boolean`. For records, `sessionGenerated` is also true when `origin = 'portal'`, so rows created before this ticket still badge correctly.
3. Pins expose the same two fields, derived from `portal_results.portalId`, with no column added.
4. `buildAnalyticsTools` passes `portalId` to every object-creating tool, which writes it alongside `createdBy = userId`. The RBAC services accept it through their existing `ctx`.
5. The bulk-transform and bulk-geocode processors fall back to the job row's `createdBy`, never to `"SYSTEM"`.
6. A guard test fails CI on the system id or a `"SYSTEM"` literal written as `createdBy` outside a named allowlist, and on a creating tool built without `portalId`.
7. The web app shows a "Created in a portal session" `MetadataList` chip on each type's detail page, and a compact chip on its list rows. It renders nothing when `sessionGenerated` is false.
8. CLAUDE.md gains an "Ownership & provenance" subsection naming the three categories, with the allowlist as the source of truth:
   - platform seed / provisioned default: `created_by_system`
   - session-generated: caller-owned, plus `sourcePortalId`
   - user-created

   `PROD_PROVISIONING.runbook.md`'s system-actor list is tightened to match.

## Open questions

1. **Does editing a session-generated object keep its marker?** Lean: yes. Provenance is a creation-time fact, like `createdBy`; `updatedBy` records the later edit.
2. **Should the badge link to the portal?** A portal may be unreadable to another reader, so the link would 404 for them. Lean: no link in this ticket, plain chip only; the id stays queryable for audit.
3. **Are org-provisioning defaults (Sandbox, My Station) "genuine platform seeds"?** The PRD's examples are global seeds, but these sit inside a user's org and members rely on `created_by_system` to read them. Lean: yes. Name them "provisioned defaults" in the guidance and keep them system-owned, because re-owning them to the signup user would change what every member can see.
4. **Is a pin "session-generated"?** The user pins it by hand, but its content is agent output. Lean: yes, derived from `portalId`, since that's what a reader of the badge wants to know.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A. A write-once column set in the creating transaction; no check-then-act.
- **Accuracy & auditability:** Lean: the portal reference is the durable link from an object to its conversation. The RBAC audit log keeps its own `portal-agent` user agent. Centralized audit export stays #179's.
- **Failure modes:** Lean: a missing `portalId` (a non-portal caller) writes `NULL`, so the object is simply not badged. Ownership is unaffected either way, which is the point.
- **Scale & unbounded growth:** Lean: nullable column adds are metadata-only in Postgres 11+, including on `entity_records`. No index, since nothing filters by it yet (a list filter wasn't requested).
- **Multi-tenancy:** N/A. The value is a portal id in the same org; no cross-tenant read is added.
- **Contract stability:** Lean: additive payload fields, and the guard makes the rule enforceable for future tools (curated-view drafting, station setup) without re-plumbing.
- **Data lifecycle:** Lean: the reference outlives a deleted portal (soft delete, no FK). The badge doesn't depend on the portal existing.

## What this doesn't decide

- Curated views, stations, tags, column definitions and entity groups get no column until a tool creates them; the guidance and the guard make adding one mechanical.
- A list filter or index on provenance. The PRD chose a badge only.
- A `ToolExecutionContext` refactor (Decision 3B), worth its own ticket if more tools need shared context.
- Message-level provenance (which message created it): messages aren't threaded into tools.
- Pin definer semantics (#640) and the curated-view ownership decision (#599), both out of scope by the PRD.

## Next step

`docs/OBJECT_PROVENANCE.spec.md` pins the column, model and payload fields, the guard's allowlist and the badge. `docs/OBJECT_PROVENANCE.plan.md` slices it into about five TDD commits:
1. the migration and models
2. tool threading and the processor fallback
3. payloads and pins
4. the guard
5. the web badge and docs
