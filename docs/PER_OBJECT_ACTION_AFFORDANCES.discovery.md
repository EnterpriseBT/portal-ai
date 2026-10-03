# Per-object action affordances — Discovery

**Issue:** [EnterpriseBT/portal-ai#684](https://github.com/EnterpriseBT/portal-ai/issues/684)

**Why this exists.** The web app decides whether to show an action from **class-level** permissions: `useCapabilities().canOnResource(type, verb)` answers "can you write *any* curated view?", not "can you write *this* one?". So a caller with read on one object and write on others sees Edit, Share and Delete on the one they can only read. Since #680, Edit there opens an empty form that ends in a 403. There's no written convention either, so each surface picks hide, disable or click-then-error ad hoc.

#685 (PR #686) has since made every mutation and SSE route authorize server-side, so the server half is done: every row below is now a UX defect, never a security one. This discovery sets the convention, decides how the client learns its per-object capabilities, decides (the PRD amendment) whether the convention should be applied by a **core set of composable permission gates on the common CTA components** rather than per surface, and records the app-wide audit. This is the client half of the authorization model that #685 finished on the server.

## The current shape

### How the client knows what it may do

| Piece | Location | Note |
|---|---|---|
| Class-level capabilities | `apps/web/src/utils/use-capabilities.util.ts:56-69` (`can`, `canViewPage`, `canOnResource`) | From `GET /api/organization/current` → `PermissionService.permissionMaps` (`permission.service.ts:246-275`). `canOnResource` is "any object of this type"; it has no `share`. Fail-closed |
| Per-object flags (2 resources) | station GET `station.router.ts:351-380` (`canShare/canWrite/canDelete`, contract `station.contract.ts:104-110`); pin GET `portal-results.router.ts:574-583` (no core contract; ad hoc `portal-results.api.ts:33-35`) | Computed by `set.can("resource.<verb>", {type,id,createdBy})`, the same call the mutation routes `check`. **No list endpoint carries per-row flags** |
| Engine | `PermissionSet.can` (`permission-set.ts:108-110`), in-memory after one `loadSet` (`permission.service.ts:84-138`); `objectCapability` adds `share` for shareable types (`permission.model.ts:287-296`) | Per-row evaluation is cheap once the set is loaded; it needs each row's `createdBy` |
| Page guards | `guardedComponent` (`use-require-page-view.util.ts:22-60`) on index routes | Render-time page-view only; never create/update/delete. Detail routes unguarded (a 404 from the API covers unreadable objects) |
| Entitlement | `entitlement.service.ts:158,164`; web `use-custom-rbac-entitled.util.ts:12-15` (fail closed), `Toolpacks.view.tsx:403-404` (fail **open**) | `UpgradeLink.component.tsx:32` is the upsell affordance, used in 2 places |
| 403 handling | `permission-denied.util.ts:10-27` (`PERMISSION_DENIED_CODES`), `FormAlert` standard copy | No global 403 handling, no shared invalidation; `ShareDialog.component.tsx:286-291` invalidates its own object (the one precedent) |

### The common CTA components (packages/core/src/ui)

| Component | Shape today | Gap |
|---|---|---|
| `ActionsMenu` (`ActionsMenu.tsx:10-21`) | `ActionMenuItem {label, icon?, onClick, disabled?, color?}`; trigger **always** renders | No hide, no reason, no `aria-disabled`; an all-disabled menu still shows its trigger |
| `ActionsSuite` (`ActionsSuite.tsx:6-19`) | `ActionSuiteItem {…, disabled?, variant?}`; returns `null` when empty | Same: no reason/tooltip |
| `PageHeader` / `PageSection` | `primaryAction: ReactNode` + `secondaryActions: ActionMenuItem[]` (rendered via `ActionsMenu`) | 21 `primaryAction` and 8 `secondaryActions` call sites in `apps/web`: the page-level actions mostly flow through here |
| `Button` / `IconButton` | thin MUI wrappers | ~219 raw `<Button>` and 40 `<IconButton>` call sites (most are dialog actions) |
| Disabled reasons today | hand-rolled `Tooltip`+`span`+`disabled`; `disableHoverListener` on the connector view leaves keyboard users out; `ColumnDefinitionDetail.view.tsx:212-224` uses a native `title` on a disabled MUI button (never shows) | **`aria-disabled` is used nowhere in the app** |

### The audit (summary; the full table is below)

Surveyed: 32 views (72 affordance rows), 151 components/modules, every workflow, and the server's per-route checks. How affordances are gated today:

| Gate today | Views | Components | Note |
|---|---|---|---|
| none | 27 | 10 | Actions rendered for every caller |
| transient state only (pending/lock/validation) | 15 | ~45 | Mostly dialog submits; reasons rarely reachable |
| class-level `canOnResource` | 8 | 7 | Wrong for per-object types (curated views, …) |
| connector `enabledCapabilityFlags.write` | 10 | — | A connector setting, not a grant |
| per-object | 7 | 2 (`canRead` only) | Station detail and pin detail are the conforming precedents (`StationDetail.view.tsx:211-238`, `PinnedResultDetail.view.tsx:135-191`) |
| entitlement | 2 | 4 | 1 with `UpgradeLink`; the rest disabled-with-text or hidden |
| role name | 0 | 0 | Good: nothing keys off role names |

## The design space

### Decision 1 — Where the convention is applied: core permission gates on the CTA components? (the PRD amendment)

**A. No gate layer.** Each surface computes hide/disabled/tooltip itself from per-object flags. Today's shape, with the convention as prose.

**B. A gate decision rendered by core, decided in web.** Core gains a tiny, context-free type and teaches the CTA components to render it:

```ts
// packages/core — pure UI; knows nothing about permissions, tiers or jobs
type ActionGate =
  | { kind: "allow" }
  | { kind: "hide" }                                  // a permission says no
  | { kind: "disable"; reason: string }               // temporary state says no
  | { kind: "upsell"; reason: string; onUpgrade: () => void }; // the plan says no
```

`ActionMenuItem` / `ActionSuiteItem` gain `gate?: ActionGate`. `ActionsMenu` drops `hide` items and **does not render its trigger when every item is hidden**. `disable` renders `aria-disabled` (focusable) with a tooltip naming the reason, and `upsell` renders the item with an upgrade affordance. Standalone CTAs get two new core components, `GatedButton` and `GatedIconButton`, which take a `gate` plus the usual button props, and `PageHeader`/`PageSection` honour gates on `secondaryActions`. Then **`apps/web` decides the gate in one hook**, `useActionGate`, from per-object capabilities (Decision 2), entitlement and state, in the convention's fixed precedence.

**C. Context-aware core gates.** Core components read a permission/tier context themselves (`<Can do="write" on={view}>`).

| | A — per surface | B — core renders, web decides | C — core reads context |
|---|---|---|---|
| Convention applied consistently | No: ~100 hand-rolled sites drift | Yes: one renderer per CTA type, one decider | Yes |
| Core stays context-agnostic (CLAUDE.md module/component rules) | Yes | Yes: core renders a value it is handed | **No**: core would know about permissions and tiers |
| `aria-disabled` + reachable reason | Per site (absent today) | Once, in the renderer | Once |
| Testable as pure UI (`*UI` + props) | Yes | Yes: a gate is a prop | Needs providers in every test and story |
| Precedence (permission > tier > state) | Re-decided per site | One function, unit-tested | Hidden inside core |

**Lean: B.** It is the composition the PRD amendment asks for. The CTA components apply the convention, and the decision stays in `apps/web`, where the capabilities, entitlement and lock state live. That keeps core pure (as the `FormAlert`/`Modal` split already does) and gives one function to test for precedence. A raw `<Button disabled>` can't render a reason accessibly, so `GatedButton` is where `aria-disabled` + tooltip finally gets implemented once.

### Decision 2 — How the client learns per-object capabilities

**A. A per-object `capabilities` field on GET and list payloads**, computed by the same `set.can` the mutation route `check`s. It generalizes the station/pin flags into one shared shape.

**B. A batch endpoint** (`POST /api/capabilities {objects:[{type,id}]}`) the client calls after a list loads.

**C. Ship the caller's policies to the client** and evaluate them there.

| | A — in payloads | B — batch endpoint | C — client-side evaluation |
|---|---|---|---|
| UI and server can't disagree | Yes: same engine call, same request | Yes, if it uses the same engine | **No**: a second evaluator to keep in sync |
| Extra round trips | 0 | 1 per list | 0 |
| Cost | One `loadSet` per request (already loaded) + O(rows × verbs) in-memory | Same, plus a request | Ships policy internals to the browser |
| Contract churn | A field on each touched payload | A new endpoint | A new contract for the policy model |

**Lean: A.** It matches the two existing precedents. It's exactly as consistent as the server, because it is the server's own decision, and it costs nothing measurable: `can` is in-memory over a set the route has already loaded. One server helper, `ObjectCapabilitiesService.for(set, type, row)`, returns `{read, write, delete, share?}` (`share` only for shareable types). Every payload uses it, and a per-resource integration test asserts it against the mutation routes for the same caller (the PRD's acceptance criterion). The station and pin `canShare/canWrite/canDelete` fields move onto it (renamed, since there's no compatibility alias; see the memory rule on clean cuts).

### Decision 3 — Which resources carry capabilities

**A. Only the shareable types** (station, pin, curated_view). **B. Every resource type with a per-object mutation route:** station, pin, curated_view, portal, connector_instance, connector_entity, entity_record, field_mapping, tag, entity_group, column_definition, toolpack.

**Lean: B.** The class-only types (tag, entity_group, column_definition, toolpack) are owner/admin-only today, but a custom policy (#622) can grant per-object on any type, and then class-level `canOnResource` is wrong in exactly the way #684 describes. One generic helper makes the uniform shape free. `entity_record` lists can be thousands of rows: the field is ~40 bytes/row and in-memory to compute, so it stays per row (see OQ2).

### Decision 4 — The convention's states and precedence

The PRD fixes the rules; the open part is precedence when several apply and how each renders:

1. **Permission says no → `hide`.** Exception: a page's **primary** action the caller could plausibly obtain (e.g. Create on an index page) renders `disable` with the reason and who can grant it.
2. **Tier says no → `upsell`** (visible, with `UpgradeLink`).
3. **Temporary state says no** (running job, pending save, invalid form) **→ `disable`** with `aria-disabled`, focusable, and a tooltip naming the cause. The job-lock rule in CLAUDE.md folds in.
4. **Precedence: permission > tier > state.** A caller who can't edit doesn't need to be told the plan is too small or a job is running.
5. **Read-only callers get read-only views**, never an editable form that ends in a 403 (`PolicyEditorDialog`/`RoleEditorDialog` system policies, `EditLayoutPlan`, connector capability checkboxes).

**Lean: as above.** Dialog submit buttons stay on `Modal`'s `submitDisabled` (#685): that is the *state* gate for forms, and it already keeps Enter and click in lockstep.

### Decision 5 — Stale permissions (403 after access changed)

**A. Per call site:** each mutation's `onError` toasts and invalidates. **B. Declared on the SDK endpoint:** `useAuthMutation({ …, onPermissionDenied: { queryKey } })` raises the standard toast ("You no longer have access to …") and invalidates that key for every caller of the endpoint.

**Lean: B.** It's the same pattern as the cache-invalidation rule (declared once, never per component), and it can't be forgotten on one of the ~40 mutation sites. Inside a dialog, the `FormAlert` keeps rendering the error (the #285 split), and the invalidation still runs.

### Decision 6 — Delivery: one PR or an epic

The audit's non-conforming set touches ~30 views, ~60 components, every workflow entry, 12 resource payloads and the core CTA components. That is more than one session can hold in context end to end.

**Lean: promote #684 to an epic** with:

1. **Foundation** — the capabilities contract + `ObjectCapabilitiesService` + payloads for all 12 types + the agreement tests; core `ActionGate` + gated `ActionsMenu`/`ActionsSuite`/`PageHeader`/`PageSection` + `GatedButton`/`GatedIconButton`; web `useActionGate` + the SDK `onPermissionDenied` handling; the CLAUDE.md convention + mirror; and the Views list/page fix as the reference adoption.
2. **Data & connectors** — connector instance/entity/records/field mappings/layout plan, entities, column definitions, connector workflows' entry points.
3. **Stations, portals, pins, views** — list/detail parity (lists ungated today), portal cards and rename/delete, pin/unpin.
4. **Organization & access** — members, billing, toolpacks, roles/policies/groups (read-only system views), settings.

Children 2–4 depend only on 1, so they can run in parallel.

## Tradeoff comparison

| | D1: core renders, web decides | D2: capabilities in payloads | D3: all 12 types | D4: permission > tier > state | D5: SDK-declared denial | D6: epic |
|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes (child map) |

## Recommendation

1. Add `ActionGate` (`allow | hide | disable{reason} | upsell{reason,onUpgrade}`) to `@portalai/core/ui`. Teach `ActionsMenu`, `ActionsSuite`, `PageHeader` and `PageSection` to render it; `ActionsMenu` hides its trigger when every item is hidden. Add `GatedButton` and `GatedIconButton`. Disabled gates render `aria-disabled`, focusable, with a tooltip.
2. Add `useActionGate` in `apps/web` as the single decider: per-object capabilities → `hide` (or `disable` for a plausible primary action), entitlement → `upsell`, transient state → `disable`, in that precedence.
3. Add `ObjectCapabilitiesSchema {read, write, delete, share?}` to `@portalai/core/contracts` and an `ObjectCapabilitiesService.for(set, type, row)` in the API. Every GET and list payload for the 12 per-object types carries `capabilities`. The station and pin `can*` fields move onto it.
4. Add one integration test per resource asserting payload capabilities equal the mutation routes' allow/deny for owner, member and other-member callers.
5. Add `onPermissionDenied` on `useAuthMutation` endpoints: standard toast + invalidate the object's key. Dialogs keep their `FormAlert`.
6. Read-only callers get read-only views: system policies/roles, layout plan, connector capability settings.
7. Write the CLAUDE.md "Action affordances & permissions (apps/web)" section and its mirror, including the gate precedence and "a raw `disabled` on a permission-gated action is a bug".
8. Promote #684 to an epic with the four children above; the foundation child lands first, with the Views list/page as its reference adoption.

## Open questions

1. **A guard test for adoption?** For example, fail CI when a `PageHeader`/`PageSection` action or `ActionMenuItem` in `apps/web` sets `disabled` without a `gate`. Lean: yes, scoped to those props (the #685 dialog guard is the precedent). A repo-wide `<Button disabled>` ban would be noise, since dialog submits are legitimately state-disabled via `submitDisabled`.
2. **Entity-record lists at scale.** Per-row capabilities on a 10,000-row page is ~400 KB extra. Lean: per row, as Decision 3. Records are paginated (keyset), so a page is at most a few hundred rows. Revisit only with a measurement.
3. **The plausible-primary-action exception: who decides "plausible"?** Lean: only Create on an index page, and only when the caller lacks the class create but holds read on the type. The reason names the grant ("Ask an owner or admin for create access to views").
4. **Toolpacks' entitlement fails open** (`Toolpacks.view.tsx:403-404`). Lean: fail closed to `upsell` like `use-custom-rbac-entitled`, fixed in the Organization & access child; the server enforces either way.
5. **Raw `fetchWithAuth` DELETEs found by the audit** (`Dashboard.view.tsx:159`, `StationDetail.view.tsx:156`) break the SDK-only rule. Lean: move them onto the SDK in the Stations/portals child, because they need `onPermissionDenied` anyway.

## Enterprise-scale considerations

- **Concurrency & correctness.** A permission can change between render and click. Lean: the server is the boundary (#685); the UI handles the race by D5 (toast + refetch), so a stale affordance can only cost a round trip, never an action.
- **Accuracy & auditability.** The UI must never claim an ability the server denies, or hide one it allows. Lean: one engine call shared with the mutation route (D2) plus a per-resource agreement test; no client-side evaluator.
- **Failure modes.** If capabilities are missing (old payload, error), fail **closed**: hide or disable, and never show a mutation the client can't vouch for. The server enforces regardless, so fail-closed only costs UX, never safety. Entitlement checks fail closed to `upsell` (OQ4).
- **Scale & unbounded growth.** One `loadSet` per request, already done by the route; O(rows × 3–4) in-memory `can` calls per list page; payload +~40 B/row. Pagination bounds it (OQ2).
- **Multi-tenancy.** Capabilities are computed from the caller's org-scoped set on org-scoped rows; nothing cross-tenant is exposed (an unreadable row isn't in the list at all).
- **Contract stability.** `capabilities` is a named, versioned shape in `@portalai/core/contracts`. New verbs (e.g. `run`, `export`) or new paid gates extend `ObjectCapabilities` / `ActionGate` without touching call sites, because surfaces consume a gate rather than raw booleans.
- **Data lifecycle.** N/A: no stored state; capabilities are computed per request.

## The full audit

Line numbers are from the survey, which predates PR #686; a few have shifted. "Server" is the route's check since #685. **Fix** is the convention's answer and which child owns it (F = foundation, D = data & connectors, S = stations/portals/pins/views, O = organization & access).

| # | Surface (file:line) | Action(s) | Gated today by | Server (since #685) | Fix | Child |
|---|---|---|---|---|---|---|
| 1 | `CuratedViews.view.tsx:71-111` | Edit / Share / Delete (list) | class `canOnResource("curated_view","write")` | per-object | hide per row | F (reference) |
| 2 | `CuratedViewDetail.view.tsx:131-145` | Edit / Share / Delete | class | per-object | hide per object; read-only callers get no editor | F (reference) |
| 3 | `CuratedViewEditorDialog` | edit form | class | per-object | reachable only with `write` | F |
| 4 | `StationList.component.tsx:88-102` | Delete / Set default | none | per-object / class write station (org PATCH) | hide per row; Set default only with class write | S |
| 5 | `StationDetail.view.tsx:211-238` | Share / Edit / Delete | per-object (conforming) | per-object | move onto `capabilities` + gates | S |
| 6 | `StationDetail.view.tsx:359-364` + `:156` | Portal card Delete (raw fetch) | none | per-user portal | gate + SDK (OQ5) | S |
| 7 | `Dashboard.view.tsx:76,88` + `:159` | Recent portal Delete (raw fetch), Unpin | none | per-user / per-object | gate + SDK | S |
| 8 | `PinnedResultsList.component.tsx:47` | Unpin | none | per-object | hide per row | S |
| 9 | `PinnedResultDetail.view.tsx:135-191` | Share / Edit / Delete | per-object (conforming) | per-object | move onto `capabilities`; auto-refresh skipped without `write` (smoke #685 saw a 403) | S |
| 10 | `Portal.view.tsx:356-372` | Rename / Delete | none | per-user | gate (only the creator or owner/admin reach it) | S |
| 11 | `PortalMessage.component.tsx:241` | Pin result | none | portal access + class create pin | gate | S |
| 12 | `PortalCard.component.tsx:26`, `RecentPortalsList.component.tsx:52` | Delete | none | per-user | gate | S |
| 13 | `ConnectorInstance.view.tsx:360-441` | Edit / Sync / Modify layout plan / Delete | lock only; menu items no reason | per-object (`ConnectorInstanceAccessService`) | permission → hide; lock → `disable` with reason | D |
| 14 | `ConnectorInstance.view.tsx:556-613` | capability checkboxes | none | per-object write | read-only display without write | D |
| 15 | `EditLayoutPlan.view.tsx:256-334` (+ unguarded route `connectors.$id.layout-plan.edit.tsx`) | edit + commit | server `editContext.editable` | per-object write | read-only view without write; entry link gated | D |
| 16 | `ConnectorInstance.component.tsx:91`, `ConnectorDefinition.component.tsx:68-75` → `Connector.view.tsx:126-130,313-323` | Connect (catalog) | none (and no `isActive`) | owned create | gate on create; hide inactive | D |
| 17 | `EntityDetail.view.tsx:402-417` | Tag assign / unassign | tag read only | entity write + tag read | gate on entity write | D |
| 18 | `EntityDetail.view.tsx:455-487` | Delete records / Re-validate | lock + connector write flag | per-object write / delete | permission → hide; flag/lock → `disable` | D |
| 19 | `Entities.view.tsx:171-177` | Create | none | owned create under readable instance | gate | D |
| 20 | `EditConnectorEntityDialog`, `CreateEntityRecordDialog`, `EditEntityRecordDialog`, `EditFieldMappingDialog`, `CreateFieldMappingDialog` | edit/create forms | connector write flag only | per-object | reachable only with `write`/create | D |
| 21 | `ColumnDefinitionList.view.tsx:96-102`, `ColumnDefinitionDetail.view.tsx:306-313` | Create | none | class create | gate (plausible-primary → `disable`, OQ3) | D |
| 22 | `ColumnDefinitionDetail.view.tsx:212-224`, `ColumnDefinition.component.tsx:63` | Edit / Delete | system flag; native `title` on disabled button | per-object | `disable` with a real tooltip for system rows; permission → hide | D |
| 23 | `EditColumnDefinitionDialog.component.tsx:395`, `EditFieldMappingDialog.component.tsx:380` | "Confirm & Save" | none (no pending disable) | per-object | `submitDisabled`-style pending gate | D |
| 24 | `Tags.view.tsx:84-142`, `TagCard.component.tsx:21-23`, `TagFormModal` | Create / Edit / Delete | none | class create; per-object | gate | D |
| 25 | `EntityGroups.view.tsx:80-204`, `EntityGroupDetail.view.tsx:319-408`, `EditEntityGroupDialog`, `AddMemberDialog`, `CreateGroupDialog` | Create / Edit / Delete / Add & remove member | none | class create; group write | gate | D |
| 26 | `RestApiConnectorWorkflow.component.tsx:187-195,594-710` | Commit (non-atomic: instance → endpoints → sync) | state | owned create; instance write | gate entry; note the partial-commit risk if create is allowed but endpoint write is denied (it can't be since #685: same owner) | D |
| 27 | Region editor `ReviewStep.component.tsx:519-537` | Commit | state (reason in an Alert) | instance write | conforming state gate; entry gated by D16 | D |
| 28 | `JobDetail.view.tsx:78-86` | Cancel job | state | job ownership/read | gate | D |
| 29 | `Toolpacks.view.tsx:214-258` | Edit / Delete / Refresh / Rotate secret | none | class write/delete (owner/admin) | hide for members (members can't open the page since #630; still gate) | O |
| 30 | `Toolpacks.view.tsx:330-353` | Register (tier-blocked) | disabled + tooltip, no `UpgradeLink`; entitlement fails **open** | entitlement + class write | `upsell`; fail closed (OQ4) | O |
| 31 | `MemberList.component.tsx:205`, `PendingInvitationList.component.tsx:69,81` | Remove member / revoke invite | none (tab gated on `member.invite`) | `member.remove` | gate on `member.remove` | O |
| 32 | `MembersTab.component.tsx:115-125`, `MemberList.component.tsx:223` | Invite (seat cap), Groups column | hidden / no upsell | entitlement | `upsell` | O |
| 33 | `TierCard.component.tsx:40,216`, `SubscriptionBilling.component.tsx:67,204` | Change plan / billing | disabled with a permission tooltip | `billing.manage` | permission → hide | O |
| 34 | `Settings.view.tsx:409-417` | Delete organization | disabled | `org.delete` | hide | O |
| 35 | `Settings.view.tsx:465-479` | Access tab (tier-locked) | plain text | entitlement | `upsell` | O |
| 36 | `CreateStationDialog.component.tsx:233,255`, `EditStationDialog.component.tsx:54-63` | tier-limited options | disabled, no upsell | entitlement | `upsell` | S |
| 37 | `PolicyEditorDialog.component.tsx:101-118`, `RoleEditorDialog.component.tsx:92-102` | system policy/role | disabled editable form | system rows immutable | read-only view | O |
| 38 | `AccessAuthoring.component.tsx:126,237` | Delete role/policy/group | no confirm, no pending | class write (custom RBAC) | confirm dialog + gate | O |
| 39 | `ChatWindow.component.tsx:312-320` (`PortalSession.component.tsx:250`) | Send while locked | state, reason not reachable | — | `disable` with reason | S |
| 40 | `ActionsMenu` / `ActionsSuite` items app-wide | any disabled item | `disabled` with no reason | — | `gate` (D1) | F |

## What this doesn't decide

- **Live push of permission changes** to open sessions (PRD out of scope): stale state is D5's toast + refetch.
- **Any server authorization change.** #685 settled it; this only exposes the existing decisions.
- **Route-level guards for create/edit pages** (`beforeLoad`). Detail routes already 404 from the API for unreadable objects; adding router guards is a separate concern, unless a child finds an editable route reachable without write (D15 is handled by the read-only view).
- **Visual redesign** beyond hide / disable / upsell.
- **#687** (5xx messages leak SQL text): a separate API bug, unrelated to affordances.

## Next step

On confirmation: promote #684 to an epic (`/epic`) with the four children of Decision 6. The **foundation** child gets its own spec and plan on this branch's successor. Roughly: core `ActionGate` + gated CTAs → `ObjectCapabilities` contract + service + payloads with agreement tests → `useActionGate` + `onPermissionDenied` → convention docs + guard → the Views list/page as reference adoption. Each area child then specs its rows from the audit table above.
