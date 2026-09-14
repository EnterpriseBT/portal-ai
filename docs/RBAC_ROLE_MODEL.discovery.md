# Role model / RBAC beyond owner-member — Discovery

**Issue:** [EnterpriseBT/portal-ai#576](https://github.com/EnterpriseBT/portal-ai/issues/576) · part of the Security & Enterprise Readiness epic ([#578](https://github.com/EnterpriseBT/portal-ai/issues/578))

**Why this exists.** Authorization today is **owner-vs-member only**: `organization_users` has no role, owner checks are hand-written per route (`organization.ownerUserId === userId`), and the `requireScope`/`requirePermission` middleware is dormant scaffolding that reads Auth0 claims we don't populate. Everything in an org is visible to every member, and there is no way to say "this person may read but not write," "share my pinned result with a teammate," or "an admin can do everything except billing." Subscription customers expect team roles and least-privilege; SOC 2 expects it in writing. This is the ticket that gives Portals AI a **real per-user authorization model** — seeded roles plus a grant-based override layer — so what a member can view and modify is decided by policy, server-side, not by "you're in the org."

The design here covers the **full capability** (roles + composable object-level grants + sharing + a curated-view data-exposure model). Per the confirmed boundary, **#576 implements the role model + enforcement + FE gating**; the **grant/sharing layer** ships as the **`RBAC_OBJECT_GRANTS`** follow-on child, and the **data-exposure model** (curated views + always-live pins, Decision 6) as the larger **`CURATED_VIEWS`** child — both designed here, neither in #576. The plan slices accordingly.

## The current shape

### Authorization today — owner-vs-member, hand-written

The caller's internal identity is resolved by `getApplicationMetadata` (`apps/api/src/middleware/metadata.middleware.ts:23-56`), which maps the Auth0 `sub` → internal user, resolves the current org, and attaches `req.application.metadata = { userId, organizationId }` (`apps/api/src/types/express.d.ts:43-63`). **This is the single point where `(user → current org)` is bound** (`metadata.middleware.ts:41-55`) — the natural home to also resolve `role`.

There is no role. Owner is decided by comparing to `organizations.ownerUserId`, per route:

| Gate | Location | Code |
|---|---|---|
| Org delete | `apps/api/src/routes/organization.router.ts:294` | `ownerUserId !== userId` → 403 `ORGANIZATION_NOT_OWNER` |
| Audit-log read (#575) | `organization.router.ts:925` | same → 403 `AUDIT_LOG_NOT_AUTHORIZED`; comment at `:912-913,925` says "swaps to `role='admin'` when #576 lands, contract unchanged" |
| Billing | `billing.router.ts:6` + `BillingService` | 403 `BILLING_NOT_OWNER` |

### The dormant scaffolding

`apps/api/src/middleware/authorization.middleware.ts` — `requireScope` (`:16`) and `requirePermission` (`:47`) read `req.auth.payload.scope`/`.permissions` (Auth0 RBAC), take plain strings (not an enum), and emit ad-hoc `res.status(403).json({error})` **bypassing the `ApiError`/`ApiCode` envelope**. Unused because our roles do not live in Auth0 — identity/org is DB-side. **RBAC needs a new membership-sourced guard, not this file** (which should be removed or rewritten, not extended).

### Membership model — where `role` lands

`apps/api/src/db/schema/organization-users.table.ts:9-18` — `{ ...baseColumns, organizationId, userId, lastLogin }`, no role. Zod: `packages/core/src/models/organization-user.model.ts:13-17`. Dual-schema compile check: `apps/api/src/db/schema/type-checks.ts:235-257` (adding `role` to only one side fails CI). A `role` enum column lands in all three.

### Object graph + ownership

`baseColumns` (`apps/api/src/db/schema/base.columns.ts:44,65-89`, from `CoreSchema` `packages/core/src/models/base.model.ts:14-22`) puts **`createdBy` (notNull) on every row**. `organizationId` (notNull) is a per-table column present on 24/31 tables. Governable objects and their FK chains:

- **connector_instances** (`connector-instances.table.ts:23`, encrypted `credentials` column `:30`) → **connector_entities** (`:24`) → **entity_records** (`entity-records.table.ts:49`).
- **stations** (`stations.table.ts:13`) → **portals** (`portals.table.ts:15`) → **portal_results** / "pinned results" (`portal-results.table.ts:33,36`).
- **organization_toolpacks**, **column_definitions**, **entity_groups**(+members), **entity_tags**(+assignments) — each org-scoped with `createdBy`.
- **connector_definitions** (`connector-definitions.table.ts:21`) — global catalog, **no `organizationId`**; not per-org governable.

These FK chains are the substrate for the "does read on a connector imply read on its entities/records?" cascade question.

### Ownership attribution (audited for this ticket)

`createdBy` is written and preserved everywhere but **never used as a visibility filter today** — portal-results reads (`portal-results.repository.ts:51-66`) and stations list (`stations.repository.ts:28-34`) are org/station-scoped only. Who is recorded as creator:

- **Acting user (the norm):** every domain create route passes `userId` (`station.router.ts:457`, `connector-instance.router.ts:723`, `entity-record.router.ts:730`, `column-definition.router.ts:380`, etc.). **Portal-session objects are user-attributed:** portals `createdBy: userId` (`portal.service.ts:388`), messages `createdBy: portal.createdBy` (`:477/:574/:801`), pinned results `createdBy: userId` (`portal-results.router.ts:210`).
- **System id (narrow):** only org bootstrap — the initial user, org, and **default station** (`application.service.ts:201/286/381`) — and demo seed (`demo-seed.service.ts`, `SEED_USER`).

So a `createdBy`-scoped member default is viable; the one production wrinkle is the **default station** (system-owned), addressed in Decision 2.

### Tiers (per-org) vs roles (per-user)

Tiers gate **org capability** (which toolpacks/units the org bought): `tier-catalog.ts`, `TierPolicySchema` (`packages/core/src/models/tier.model.ts:81`), enforced in `entitlement.service.ts:70-91` and `tools.service.ts:440-447`. RBAC gates **per-user action**. They compose independently and must not be conflated: a tier exposes a toolpack; a role decides whether *this member* may configure/run it. `TierPolicy` has **no `maxSeats`** today (seat limits are #583/#584 greenfield).

### Frontend owner-gating today

`SubscriptionBilling.component.tsx`: `withOwnerGate(isOwner, …)` (`:67-77`) renders owner-only actions disabled + tooltip. `Settings.view.tsx:107-112` derives `isOwner` from `profileResult.userId` vs `organization.ownerUserId`; the #596 Activity tab uses it (`:146`), with a comment (`:103-106`) flagging this as the single predicate #576 widens to owner+admin. **Per-role gating should be fed by a `role` on the SDK profile/membership response, not recomputed per component.**

### Sibling boundary

`organization-users.repository.ts` has finders only — no add/remove/invite routes, no role. Members are provisioned in `application.service.ts:206/230/303`. **#576 owns the role model + enforcement; #584/#585 own invitations/assignment routes + Members UI.** `packages/admin-cli/src/commands/member.ts` is the out-of-band path.

## The design space

### Decision 1 — Core permission model **(DECIDED: grant-based)**

| | A — Grant-based ✓ | B — Coarse role→type | C — RBAC + shares |
|---|---|---|---|
| Object-level access | Yes (object id in grant) | No | Read-only positive |
| Share a single pinned result | Yes | No | Yes |
| Read-only override on a write-role user | Yes (deny row) | No | No (no deny) |
| Upfront design | Highest | Lowest | Medium |

**Decided: grant-based.** Roles supply *defaults*; a `permission_grants` row `(subject: role|user) × (object: type-wildcard | specific id) × action × effect(allow|deny)` overrides them. Resolution: **most-specific match wins; deny beats allow at equal specificity; else fall back to the role default.** This is the only model that expresses all three of the ticket's hard cases (class grant, single-object share, read-only override) with one mechanism. Chosen over B/C because both the read-only-override and general sharing are first-class requirements, and C cannot express deny.

### Decision 2 — Member default visibility **(DECIDED: createdBy-scoped + attribution rule)**

**Decided: `createdBy`-scoped.** A member's default is read/write on objects where `createdBy = them`; grants widen. Grounded attribution rule (from the audit above):
- Portal/session objects are already human-attributed — no change.
- **System-provisioned shared defaults** (the org's default station **and** default sandbox connector instance, both `createdBy = SYSTEM_USER_ID` at `application.service.ts:360-386`; demo-seed rows) → **org-visible read** for all members, writable only by owner/admin. Encoded as a general rule — `createdBy = SYSTEM_USER_ID ⇒ member read` — not per-object seeded grants scattered through repositories (see OQ1 for the write consequence on the sandbox).

### Decision 3 — Role set **(DECIDED: seeded fixed roles)**

**Decided: seeded `owner` / `admin` / `member`.** `owner` = allow \* on \* (org creator; retains billing + org delete). `admin` = owner minus billing (the confirmed policy). `member` = createdBy-scoped read/write. Schema is built **role-table-ready** (a `role` enum now; the grant `subject` already admits `role:*`) so org-defined custom roles + a role editor plug in later (a future child) without re-plumbing call sites.

### Decision 4 — Where the check runs

Two enforcement surfaces are needed, because actions and list-reads are different shapes:

| | A — Route/middleware guard only | B — Repository visibility filter only | C — Both, one resolver ✓ |
|---|---|---|---|
| Mutations (create/update/delete) | Yes | No | Guard |
| List/read visibility scoping | No (can't filter rows) | Yes | Repo predicate |
| Single resolver of truth | — | — | Yes |

**Lean: C.** A central `PermissionService.check(userId, orgId, action, object)` resolves grants+role once. Route guards call it for mutations (throw `INSUFFICIENT_ROLE` / `*_FORBIDDEN`, added to `api-codes.constants.ts`, via `ApiError` → `next()`); list repositories take a **visibility predicate** derived from the same resolver so a member's list only returns rows they may see. The check keys off `req.application.metadata.{userId, organizationId}` + resolved role. For **#576's coarse enforcement**, owner/admin pass everything (minus billing for admin) and the member predicate is `createdBy = me OR has-grant`; the full grant resolver lands with the follow-on but the *seam* (PermissionService + repo predicate) ships now.

### Decision 5 — Downstream permissions **(DECIDED: composable typed-scoped statements — no implicit cascade)**

The user's stance: policies explicit, with role bundles for ergonomics. But "share connector read-only" is useless unless it reaches the connector's entities/records.

An earlier draft answered this with a `cascade` flag on the grant — the resolver would walk the **known FK chains** (connectorInstance→entities→records; station→portals→portal_results) at read time. **Rejected.** A read-time graph-walk is an *implicit* cascade wearing an explicit label: it hard-codes the FK graph into the resolver, so the day a new child type is added (`station → dashboards`, `portal → annotations`, `station → shared_secrets`), **every existing `cascade` grant silently expands to cover it** — nobody edits a grant, but the grant's blast radius changes underneath them. That is fail-**open**-on-schema-growth, the opposite of this model's stated fail-closed posture (see Enterprise-scale → Failure modes), and it means a grant's blast radius can't be read without also knowing the current FK graph.

**Decided: composable, typed, scoped statements.** Each grant statement names the object *type* it covers; a subtree share is a **bundle of statements**, not one row with a magic bit. The statement shape:

```
{ subject, object: { type, id? | scope? }, action, effect }
```

where `scope` is a **typed predicate**, not a graph walk — e.g. `{ type: portal_results, scope: { stationId: 42 } }` = "all portal_results whose station is 42". Sharing a station read-only with its subtree materializes:

```
{ user:C, station:42,                              read, allow }
{ user:C, portals,        scope:{ stationId: 42 }, read, allow }
{ user:C, portal_results, scope:{ stationId: 42 }, read, allow }
```

The properties this buys over the `cascade` bit:

- **Future *instances* of a known type are covered** — `scope` is a predicate, so a pinned result created under station 42 tomorrow is included, same as `cascade` would have.
- **Future *types* are NOT covered until a statement names them** — a new child table stays closed by construction. This is the decisive difference and the whole point.
- **A grant's blast radius is readable from the statements alone** — no FK-graph knowledge needed, which is what an auditor actually wants.
- **The "cascade" convenience moves from read time to write time.** A "Share station" action expands into the statement bundle *at share time*, frozen as explicit statements — so later schema changes never retroactively widen a live grant. Ergonomics preserved; drift eliminated.

Default member ownership never expands. Sharing a bare object (`{ user:C, portal_result:99, read, allow }`) stays exactly that object. `connector_instance → entities → records` uses the same shape (`{ records, scope:{ instanceId } }`) — mandatory there, since an id-list grant over millions of `entity_records` would be unbounded and per-row probing is the #440 quadratic trap (resolve-once-into-list-predicate, OQ4).

**Policy container.** Because subtree shares and reusable bundles ("read-only analyst", "station collaborator") are both just *sets of statements*, statements compose into a named **policy** attachable to a user **or** a role. This is additive to Decision 1 — `subject` already admits `role:* | user:*`; a policy is the container those statements live in. It is also where org-defined custom roles (deferred to a later child, see "What this doesn't decide") land for free: a custom role is a policy attached as a role default. The schema provisioned in #576 is built policy-ready.

### Decision 6 — Data-exposure & sharing model **(DIRECTION: curated views + always-live pins; security over completeness)**

This decision governs what a *portal session* exposes, grounded in how portals actually read data: every data path funnels through **`resolveEntityCapabilities(stationId)`** (`resolve-capabilities.util.ts:175-203`), which builds one filtered Postgres session-view per readable entity (`portal-sql.service.ts:143-341`) and feeds the agent's `## Available Data` roster (`system.prompt.ts:564-589`), the `station_context` tool, and the `_meta_entities` view alike. There is **no per-user filter there today** — that single choke point is where per-user visibility lands (resolved once per session, OQ4), and narrowing it flows through query, enumeration, and system-prompt simultaneously.

**Principle — secured access over completeness.** During a session, enforcing the permission boundary outranks dataset completeness. The admin closes any gap by *configuration*, not by the app relaxing enforcement: a member's granted set is meant to *be* a complete, safe dataset. Consequence: **query/list filtering is silent** — no "N sources hidden" signal, which would itself leak the *existence* of forbidden data. This settles the disclosure question in favor of silence-by-design.

**Views — the curated, shareable data object.** Rather than granting raw entities with ad-hoc scope predicates (Decision 5), the member-facing governable data object is a **view**: a named slice of a connector's entities with configurable **row pre-filters** (a saved `WHERE`) and **column projection** (which columns are exposed). Stations attach **views, not connectors directly**; grants name views (`{ subject, view:X, action, effect }`); raw connector/entity grants become **admin-only**. This:

- **reifies Decision 5's `scope` predicate** — a view *is* that predicate, named once and reused, instead of every grant carrying its own;
- **resolves record-subsetting (OQ3, row-level) and field/column exposure (OQ6)** as view configuration on the well-understood DB-view pattern — not per-row grant probing;
- **makes "sharing = grant" safe** — the unit shared is a pre-curated slice, never a raw connector;
- **fits the existing engine** — `buildSessionViews` already constructs a filtered per-entity SQL view; a view adds a *stored* filter/projection to a code path that already exists.

Start with **static views** — the row filter and column projection are fixed at definition time, so a view resolves to the same rows for everyone granted it and different audiences get different named views (admin defines `us-customers` and grants it). **Dynamic views** (a.k.a. parameterized / row-level-security views — the filter references the current principal, e.g. `region = current_user.region`, so one view resolves to different rows per viewer) are a later increment: they require a per-user attribute model that #576's fixed-role design doesn't have, and they complicate the definer's-rights pin principal. The `views` schema leaves room for a `current_user.*`-referencing filter so the upgrade needs no re-plumbing, but `CURATED_VIEWS` ships **static only**.

**Multiple views per entity — locked.** One `connector_entity` backs any number of views; each view's `key` (unique per org) becomes the **session-view name**, so an `accounts` entity slices into `ne_accounts` (`region = 'NE'`) and `sw_accounts` (`region = 'SW'`) — two independent, independently-granted temp views over the *one* wide table `er__<accounts-id>`, no data duplication. This is the primary reason the view grain is **per-entity** and the reason the session view is keyed by `view.key`, not `entity.key` (the `viewMap` indirection at `portal-sql.service.ts:78-83` was built for exactly this). It supersedes today's rule that the entity key is the query name; `view.key` is the SQL identifier and the unit of grant, unique per org. Overlapping (non-partition) views are allowed — a user granted both `all_accounts` and `ne_accounts` sees NE rows through both — and a union is simply another view. Two mechanisms narrow independently and answer different questions: **station attachment** decides which views exist in a workspace at all; **grants** decide which of them a member may use — both must pass. Views are a **substantial reshape of the connector↔station model** (`station_instances` → station-attaches-views, with a passthrough-view migration for existing connectors — a clean cut given no production data yet). Their **architecture + UI are still to be worked**; they land as their own child (`CURATED_VIEWS`), not in #576.

**Pins — always-live, definer's-rights.** Today a pin embeds a self-contained `content.rows` snapshot capped at `PIN_SNAPSHOT_ROW_CAP` (`portal-result-pin.service.ts:190`), deriving the re-executable `pipeline` only as a refresh/tiling fallback for data that outran the cap. That couples a pin's **liveness and completeness to dataset size** — a small result is a frozen complete snapshot, a large one a truncated snapshot + a query — which is arbitrary, and post-RBAC a snapshot is a permission-gating leak. **Decided: every *data* pin stores only its re-executable `pipeline` and renders live, regardless of size**, executed under a **fixed principal (definer's rights — the creator/sharer), not the viewer**, so:

- a pin can never hold stale or permission-gated rows (nothing is embedded);
- **sharing a pin conveys the data** — it runs as the sharer, who could read it; the share is the deliberate, audited disclosure (OQ7);
- **revocation propagates for free** — if the sharer loses access, the pin's live execution simply returns nothing.

Constraints this imposes, recorded: **every pinnable data block must carry a re-executable query** (externally-supplied rows with no query are not pinnable as live data); **narrative (`text`) pins stay self-contained** (prose has no data source to gate, and may quote figures the pinner deliberately discloses); and the **frozen point-in-time snapshot is deliberately given up** as a normal pin — a conscious downgrade, re-addable later as a distinct "export/snapshot" artifact if a reporting/audit need appears. Live execution at every size is a performance cost the snapshot fast-path avoided; any caching added to recover it must be per-viewer-permission-scoped and short-TTL, and is a `CURATED_VIEWS`-child concern.

### Decision 7 — Curated-view surfaces: navigation, connector capabilities, agent tools, and custom roles **(DIRECTION)**

Grounded in the current app: navigation is a **static hard-coded sidebar** (`SidebarNav.component.tsx`) behind a **single `isAuthenticated` gate** — no role, owner, or per-route authorization exists anywhere in web *or* API, and every portal tool runs with the **organization's** authority (the caller's `userId` is used only to stamp `createdBy`, never to authorize — confirmed across the entity-management tools). RBAC + curated views change four surfaces:

**Navigation & routes.** The member-facing world is **Stations → Portals → the views they're granted**; the raw data-plumbing surfaces (Entities, Entity Groups, Connector catalog + instances, Column Definitions, Tags, Jobs) become **admin/owner-only**, joined by a new **Views** management page (CRUD: define row-filter + projection, attach to stations, grant). Enforcement is **two-layer, server-authoritative**: the sidebar hides what a role can't use and route `beforeLoad` redirects to a permitted default (fail-open to a working page), but the **SDK endpoints behind each route independently enforce** — a member who types `/entities` gets a forbidden/empty response, because client routing is bypassable (the standing "server enforcement, not UI" rule). Role reaches the FE via `sdk.organizations.current()` (OQ5), not recomputed per component. A member primarily *uses* a view inside a portal's data picker; the Views page is the admin *action* surface — keeping manage vs. use on separate surfaces.

**Connector-instance capabilities = data-plane ceiling; RBAC = the per-user layer on top.** The existing `{read, write, push}` resolution (definition ceiling ∧ instance `enabledCapabilityFlags`, `resolve-capabilities.util.ts:24-37`) stays as the **org-level data-plane** answer to "can this connector be written at all." RBAC composes above it: effective permission = data-plane cap ∧ the member's role/grant. Grounded fact that shrinks the write story: **write is confined to the two author-in-app connectors** (`sandbox`, `file-upload`); the sync connectors (`google-sheets`, `microsoft-excel`, `rest-api`) are read-only by definition and `push` is enabled nowhere. So the view (read) layer carries almost all member data access; member *write* is the narrow case of authoring in a sandbox/upload they created or were granted. The existing tool write-gate (a write tool is stripped unless the station has a write-capable connector) gains a second conjunct: `∧ caller-write-grant`.

**Agent-operable RBAC — a per-caller tool authorization gate.** For a portal user to create views or manage grants through the agent, tools must finally check the **calling member's** permissions, not just the org's — net-new, since today no tool authorizes per-user. RBAC adds a `PermissionService.check(callerUserId, action, object)` gate inside tool `execute` (a **typed refusal** on deny, never a throw — same shape as the cost gate), and it generalizes to **every write tool** (`entity_record_create`, etc.), closing the gap where a member could mutate via the agent what they can't in the UI. View/grant/role management ships as agent tools in a **governance toolpack**, tier-entitled like the rest — RBAC administration is agent-operable by the same server-enforced contract as everything else.

**Custom roles & scoped admin — fully flexible, staged in time.** Arbitrary per-user permission subsets are expressible the moment the grant layer lands: a "regional director" with read/write over a set of views/connectors is a **bundle of grant statements on that user** — no new role type needed. Reusable **named custom roles** (so the bundle isn't re-attached per person) are the **policy container attached as a role default** — the deferred custom-roles child, schema-ready today. Both compose with the seeded owner/admin/member baseline (a user is a `member` who *also* holds a "Regional Director" policy). And because the grant `action` axis covers **administrative** actions (create-view, grant, manage-connector), not only data read/write, the model expresses **scoped admin** — e.g. view-management over one region's connectors without full org-admin — which coarse role→type never could.

## Tradeoff comparison

| | Grant-based (D1) | createdBy default (D2) | Seeded roles (D3) | Both-surface check (D4) | Composable statements (D5) |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes (typed-scoped statement + policy) |
| Lands in #576 code | Role defaults + seam | Yes | Yes | Guard + member predicate | Schema shape designed; resolver follow-on |
| Follow-on child | Grant rows + sharing UI | — | Custom roles (= a policy) | Full grant resolver | Statement bundles + share-time expansion |

## Recommendation

1. Add a `role` enum (`owner|admin|member`) to `organization_users` (Drizzle + Zod + `type-checks.ts`), with a migration that **backfills every existing membership**: the org's `ownerUserId` → `owner`, all others → `member` (no lockout — Database Schema Workflow + per-org backfill rule).
2. Resolve `role` at `metadata.middleware.ts` alongside `userId`/`organizationId`; expose it on `sdk.organizations.current()`/`memberships()` and the profile response for FE gating.
3. Introduce `PermissionService.check(userId, orgId, action, object)` and a list **visibility predicate**; for #576, implement the coarse policy (owner=all, admin=all−billing, member=createdBy-scoped) behind it. Replace the hand-written owner checks (org delete, audit-log, billing) with `check(...)`.
4. Add error code `INSUFFICIENT_ROLE` (and reuse `*_NOT_AUTHORIZED` where apt); throw via `ApiError`/`next()`.
5. Add audit action `member.role.change` to `AUDIT_ACTIONS` (`audit-log.model.ts`); emit on role assignment (pattern: `organization.router.ts:544-551`).
6. Web: thread `role` from the SDK into an `useRole()`-style hook; replace `isOwner`-only gates with role-aware gating (owner-only billing/danger-zone; admin sees the audit tab per #596's widen-comment; disabled+tooltip for actions the role can't perform).
7. Design the grant layer as **composable statements + a policy container** (D5): a `permission_grants`/`policy_statements` table (subject, object `type` + `id`-or-`scope`-predicate-or-type-wildcard, action, effect — **no `cascade` column**) plus a `policies` container attachable to user or role. **#576 provisions none of this schema** — it builds only the grant-ready `PermissionService` seam (a single `resolveEffect` + the list predicate). The table, share-time bundle expansion, sharing UI, and the read-only-override all land with the **`RBAC_OBJECT_GRANTS` follow-on child**, which creates its own schema when it ships — an empty table in #576 would be speculative infra with no caller (per the standing "no infra without a concrete caller" rule).

## Open questions

1. **System-created attribution.** **SETTLED.** Org creation provisions **two** system-attributed objects (`createdBy = SYSTEM_USER_ID`, `application.service.ts:360-386`): the **default sandbox connector instance** ("Sandbox", write-capable) and the **default station** ("My Station"); demo-seed rows are the only other system-id case. A single rule covers them — `createdBy = SYSTEM_USER_ID ⇒ member-readable, owner/admin-writable` — rather than per-object seeded grants. **Accepted consequence:** the default sandbox is member-*readable* but authored (written) only by owner/admin or where a member is explicitly granted write — consistent with connector management being admin-only and member write being narrow (Decision 7). Revisit if new system-authored object types appear.
2. **Does admin include member management / role assignment?** **SETTLED — owner-only mints admins.** Admins manage **members** (assign/change the `member` role, remove members); **only the owner may mint or remove an `admin`**, and only the owner may grant/revoke `owner` (the owner is not demotable except by ownership transfer, out of scope here). So an admin cannot escalate a colleague to `admin` or demote a peer admin — "who can create privilege" stays narrow, which is the safer SOC 2 default. #576's minimal role-assignment surface enforces this; #584/#585 build the full Members UI on it.
3. **Record-subset ABAC (row-level on `entity_records`).** ~~The deepest ask ("subsets of entity records").~~ **RESOLVED (Decision 6):** a record subset is a **view** row pre-filter (a saved `WHERE`), not a per-row grant — the "saved filter as an object kind" this question anticipated is the view. Lands with the `CURATED_VIEWS` child.
4. **Grant-resolution performance on hot list paths.** A per-row permission probe would be quadratic (the #440 lesson). **CONFIRMED: resolve a member's grant set once per request and push it into the list query as a predicate (`createdBy = me OR id IN granted OR type-granted`), never per-row.**
5. **How `role` reaches the FE.** **CONFIRMED: on `sdk.organizations.current()` (single source), plus `memberships()` for the switcher; not recomputed from `ownerUserId` per component.**
6. **Field-level exposure — read-on-object ≠ read-on-every-field.** **RESOLVED for data columns (Decision 6):** column-level exposure is a **view projection** — a member queries only the columns a view selects, so a curated view never surfaces a column it shouldn't. The remaining case is the connector-management surface (the encrypted `credentials` column on `connector_instance`), which is **admin-only** and never in the portal query path; **Lean: keep credentials out of any read a member-facing grant confers, enforced at the repository projection.**
7. **Delegated re-sharing — who may create grants.** If C is granted read on station 42, may C grant D? Unbounded delegation is a breach path. **CONFIRMED: only owner/admin, or an object's `createdBy`, may create/revoke grants on it; a plain sharee cannot re-share.** Delegation is itself a grantable *action* — the scoped-admin escape hatch (Decision 7): to let a "regional director" re-share within their scope, grant them the `grant`/`share` action on that scope, rather than making re-share an implicit power every sharee inherits.

8. **Definer principal lifecycle for live pins.** A live definer's-rights pin (Decision 6) runs as its creator, giving free revocation (creator loses access ⇒ pin empties). But when the creator **leaves / is deprovisioned**, a team-shared pin would die. **DECIDED — ship (a), schema-ready for (b):** first cut **(a)** the pin empties/breaks when its creator's access is gone (simple, correct); the pin's **definer field holds a user *or* a role**, so **(b)** — rebinding a team-shared pin's definer to a role (or the sharing admin) to survive personnel churn — is a later config flip, not a migration. Lands with `CURATED_VIEWS` (#599).

9. **Governance toolpack entitlement — baseline or tiered.** The agent-operable view/grant/role tools. **DECIDED — baseline.** Entitled like any toolpack mechanically, but at the **lowest tier**: RBAC administration is a security feature, not a monetization axis (monetization is capability tiering on toolpacks/webhooks, not the core security or access-control loop). Lands with `CURATED_VIEWS` (#599).

## Enterprise-scale considerations

- **Concurrency & correctness** — role change + a concurrent action is a check-then-act race; the check reads role at request time, so a demotion applies to the *next* request (acceptable). Role writes are single-row; no cross-row atomicity needed. **Lean: fine.**
- **Accuracy & auditability** — role changes emit `member.role.change` to the #575 append-only log (actor, target, before/after in metadata). **Lean: required, cheap.**
- **Failure modes** — authz is **fail-closed** (unresolved role/grant → deny), the opposite of the tool-cost gate's fail-open, because the cost of over-denying is a support ticket while over-allowing is a breach. Role resolution is a DB read on a row already fetched for org-scoping; no new external dependency. **Lean: fail-closed, stated.**
- **Scale & unbounded growth** — grants are bounded per org; the hot path is list visibility (OQ4 — resolve-once predicate). `permission_grants` gets `(organizationId, subject)` and `(organizationId, objectType, objectId)` indexes (the #433 lesson). **Lean: engaged.**
- **Multi-tenancy** — every grant and role is org-scoped; the resolver keys off the request's current org, so a user with roles in two orgs is isolated. **Lean: engaged.**
- **Contract stability** — `role` as an enum + grant `subject` admitting `role:*` means custom roles and new object kinds (record predicates) extend the model without re-plumbing call sites. Tier (per-org) stays orthogonal. **Lean: this is the whole point of the grant-based choice.**
- **Data lifecycle** — grants are soft-deleted with their object; a `hardDelete` of an object should cascade-delete its grants (add to the delete path). **Lean: engaged.**

## What this doesn't decide

- **Grant statements, share-time bundle expansion, sharing UI, and read-only-override enforcement** — designed here (composable typed-scoped statements + policy container, D5); **schema and implementation both land in** the `RBAC_OBJECT_GRANTS` follow-on child. #576 builds only the grant-ready `PermissionService` seam, not the schema (keeps #576 reviewable and gives the object layer its own smoke).
- **Custom (org-defined) roles + role editor** — a later child; a custom role is a policy attached as a role default (D5), so the schema already admits it.
- **Field-level permissions** — not modeled (OQ6); the statement shape is left open to a future `object.field` without re-plumbing.
- **Delegated re-sharing** — grant creation is owner/admin/`createdBy`-only (OQ7); a "may share" statement effect is future work.
- **Record-subset / row-level & column-level exposure** — addressed by the **view** model (Decision 6), implemented in the `CURATED_VIEWS` child, not by per-row/field grants.
- **Curated views + always-live definer's-rights pins (Decision 6)** — the data-exposure model is decided in *direction*; its schema (the `views` object with per-org-unique `view.key`, `station_views` attachment, view row-filter/column-projection), the `buildSessionViews` rewrite (`resolveViewsForSession(stationId, userId)`), the pin `content.rows`→live-`pipeline` cutover, and the view **UI/architecture** ship as the **`CURATED_VIEWS` follow-on child** (still to be worked). #576 is unaffected.
- **Curated-view surfaces (Decision 7)** — the admin **Views** CRUD page + role-gated navigation, the **per-caller tool authorization gate** (`PermissionService.check` in tool `execute`, generalized to every write tool), and the **governance toolpack** (agent-operable view/grant/role management) land with the grant + view children, not #576. #576 ships only the role-aware FE gating seam (role threaded from `sdk.organizations.current()`).
- **Invitations, seat limits, Members/Team UI** — #583/#584/#585. #576 stops at the role model + enforcement + minimal role-assignment surface those tickets build on.
- **Auth0-side RBAC** — rejected; roles are DB-side (the dormant middleware's premise was wrong).

## Next step

`docs/RBAC_ROLE_MODEL.spec.md` (the role enum + `PermissionService` contract + the grant table schema as a *designed* artifact) and `docs/RBAC_ROLE_MODEL.plan.md` (slices). Provisional slicing: (1) `role` column + migration/backfill + dual-schema; (2) `PermissionService` + resolve role in middleware + `INSUFFICIENT_ROLE`; (3) replace hand-written owner checks (org delete, audit-log, billing) with `check(...)`, admin=all−billing; (4) member `createdBy`-scoped list predicate + system-default rule; (5) `member.role.change` audit + role assignment route; (6) web role plumbing + role-aware gating. The grant + view schemas are **not** provisioned in #576 — each follow-on child creates its own when it ships (no speculative empty tables). The final sequence lives in `docs/RBAC_ROLE_MODEL.spec.md` + `docs/RBAC_ROLE_MODEL.plan.md` (6 slices); the provisional list above is superseded by them (notably: `admin = all − billing − org.delete`, and no provisioning slice). Two follow-on children are now scoped off this discovery: **`RBAC_OBJECT_GRANTS`** (composable statements + policy container + share-time expansion, D5) and **`CURATED_VIEWS`** (the view object + station→view attachment + `buildSessionViews` view-filter/projection + always-live definer's-rights pins + view UI, D6). `CURATED_VIEWS` is the larger reshape and its architecture/UI are still to be worked; both are independent of #576's role model.
