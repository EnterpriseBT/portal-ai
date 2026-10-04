# Action gates foundation — Discovery

**Issue:** [EnterpriseBT/portal-ai#688](https://github.com/EnterpriseBT/portal-ai/issues/688) · child 1 of epic [#684](https://github.com/EnterpriseBT/portal-ai/issues/684)

**Why this exists.** The epic's discovery (`docs/PER_OBJECT_ACTION_AFFORDANCES.discovery.md`) settled the architecture:
- a context-free `ActionGate` that core CTA components render, decided in `apps/web` (D1);
- per-object `capabilities` in GET and list payloads, computed by the same engine call the mutation routes enforce (D2), for all 12 per-object types (D3);
- the precedence permission > tier > state (D4);
- 403s after access changes handled once, at the endpoint (D5).

This child builds that foundation and adopts it on the Views list and page. This doc covers only what the epic doc left open: the exact payload and contract shapes, the gaps the payload survey found, the component mechanics, and how the convention gets enforced. It's the plumbing every area child (#689–#691) then just uses.

## The current shape

### Payloads for the 12 types

| Type | List / GET-one | Permission set in scope? | Core response contract | Notes |
|---|---|---|---|---|
| station | `station.router.ts:178` / `:320` | list: inline `visibilityPredicate` :195; get: **set** :344 | `StationList…` :32 / `StationGet…` :95 | GET already returns `canShare/canWrite/canDelete` (:351-353, contract :104-110) |
| pin | `portal-results.router.ts:442` / `:540` | list inline :465; get **set** :563 | **none** (untyped `HttpService.success`; web types it by hand, `portal-results.api.ts:33-35`) | GET returns `can*` :574-582 |
| curated_view | `curated-view.router.ts:146` / `:267` | list **set** :187; get **set** :285 | `CuratedViewList…` :63 / `Get…` :74 | List rows already carry reader flags (`filtered`/`projected`) |
| portal | `portal.router.ts:218` / `:335` | list inline :234; get via `PortalAccessService.load` :348 (set not returned) | `PortalList…` :33 / `PortalGet…` :83 | |
| connector_instance | `connector-instance.router.ts:138` / `:331` | list inline :204; get **set** :368 | `…ListResponsePayload` :90 (+WithDefinition :99) / `…GetResponseSchema` :108 | |
| connector_entity | `connector-entity.router.ts:117` / `:289` | inline :181 / :321 | List :56 (+3 include variants) / Get :85 | Permission type is `entity` |
| entity_record | `entity-record.router.ts:194` / `:580` | inline :287 / :608 | `EntityRecordList…` :60 / Get :115 | Keyset or offset; **limit capped at 100** (`pagination.contract.ts:8-14`) |
| field_mapping | `field-mapping.router.ts:102` / `:232` | list `visibilityPredicate`; GET-one `loadReadableMapping` (org + read) — **fixed by #692** (PR #693, merged; it had no read check and crossed orgs by id) | List :40 (+2 variants) / Get :69 | #692 also fixed cross-org reads on connector entities, entity tags and group members, and redacts job payloads for non-creators |
| tag | `entity-tag.router.ts:89` / `:210` | inline :111 / :243 | :20 / :41 | |
| entity_group | `entity-group.router.ts:113` / `:261` | inline :154 / :294 | :50 / :61 | |
| column_definition | `column-definition.router.ts:109` / `:246` | inline :149 / :282 | :25 / :36 | |
| toolpack | `toolpacks.router.ts:146` / `:231` | **class-level** `requirePermission` only | `ToolpackList…` :100 (not paginated) / :110 | **Builtins** (`builtin:<slug>`, in-memory, no row, no `createdBy`) share the list with custom rows; `CustomToolpackRecordSchema` omits `createdBy` |

Every row type has `createdBy`, so `can()` can evaluate `created_by_caller` (toolpack only server-side).

- **Verbs:** `objectCapability` (`permission.model.ts:287-296`) gives `share` only to the shareable types (station, pin, curated_view). For the other types `share` isn't a verb at all, not a "false".
- **Swagger:** response components are registered two ways (`swagger.config.ts`). Some are **Zod-derived** (`z.toJSONSchema`, e.g. `stationSchemas` :497, round-trip tested). The rest are **hand-written** (column definition :1165, connector entity :1251, field mapping :1302, tag :1383, group :1400, curated view :1416-1504, portal :1738, pin :1826-1864), and **no test checks the hand-written ones against Zod**.

### The CTA components and the web side

- `ActionsMenu` (`ActionsMenu.tsx:10-21,64-75`) passes `disabled` straight to MUI `MenuItem`, which gets `pointer-events: none`, so no tooltip can attach.
- `ActionsSuite` (`:6-18,:51`) is the same with raw `disabled`. It's rendered by `DetailCard` (`DetailCard.tsx:20,107,131`), which is how the Views list renders row actions.
- `PageHeader`/`PageSection` render `primaryAction` (a ReactNode) plus `secondaryActions` through `ActionsMenu` (`PageHeader.tsx:23-25,95-104`; `PageSection.tsx:17-19,97-98`).
- Core has no Tooltip wrapper; MUI `Tooltip` is used directly (`StatusMessage`, `WidgetFreshnessBar`, `ColorPicker`).
- `useAuthMutation` (`api.util.ts:188-219`) spreads the caller's `mutationOptions` and has no hooks of its own. There's no central invalidation.
- `isPermissionDenied` (`permission-denied.util.ts:10-27`) is used only by `FormAlert`.
- `useToast()` is safe in hooks (no-ops without a provider).
- `UpgradeLink` (`UpgradeLink.component.tsx:9-44`) is a router `Link` to Settings → Billing with no callback.
- Entitlement reads disagree on failure: `useCustomRbacEntitled` fails closed, while `Toolpacks.view.tsx:402-404` and `use-builtin-entitlements` fail open.
- Views:
  - `CuratedViews.view.tsx:99-113,171` uses `DetailCard actions`, gated by `canManage = canOnResource("curated_view","write")`.
  - `CuratedViewDetail.view.tsx:128-147,195` puts Edit/Delete in `primaryAction` on the same gate.
  - Tests: `CuratedViewsView.test.tsx:54,88,95`, `CuratedViewDetailView.test.tsx:219,225`.
- Existing per-object flag consumers to migrate:
  - `StationDetail.view.tsx:206-238`
  - `PinnedResultDetail.view.tsx:76-92,133-182,388-390`
  - `portal-results.api.ts:33-35`
  - the `ShareDialog.component.tsx:291` comment
  - two test files
- Raw permission-disabled buttons today: `Settings.view.tsx:116,413`, `TierCard.component.tsx:219`, `SubscriptionBilling.component.tsx:207`, `MembersTab.component.tsx:120`. They belong to #691, but the guard must see them.

## The design space

### Decision 1 — Where capabilities sit in a payload

**A. On each row:** `{ …station, capabilities }`, with lists returning rows that carry their own. **B. A sidecar map:** `{ stations: […], capabilities: { [id]: … } }`.

| | A — on the row | B — sidecar map |
|---|---|---|
| Consumption | `row.capabilities.write`, survives `.map`/sorting/react-query selects | Every consumer joins by id |
| Contract | One generic wrapper `withCapabilities(RowSchema, type)` | A second field on every list payload |
| Nested/included rows (instance under entity, …) | Only top-level rows get it; includes stay plain | Same |

**Lean: A.** It's how the station attachments already carry `canRead`, and the payload shape can't drift from the row. Only the top-level object of a payload gets `capabilities`. An included relation (an entity's instance, a view's entity) does not; the area child that needs one reads it from that object's own GET.

### Decision 2 — The capabilities shape

`ObjectCapabilitiesSchema = z.object({ read: z.boolean(), write: z.boolean(), delete: z.boolean(), share: z.boolean().optional() })`. `share` is **present exactly for the shareable types** and omitted elsewhere, because it isn't a verb there. The station and pin `canShare/canWrite/canDelete` fields **move** onto it: a clean cut, no aliases (memory rule), with their 6 web consumers and 2 test files migrated in this child.

**Lean: as stated.** `read` is always `true` on a returned row (an unreadable row isn't returned). It's kept so the shape is total and future instance-read nuances (e.g. read-only shares) need no contract change.

### Decision 3 — The gaps the survey found

1. **field_mapping reads (#692) — resolved.** #692 landed on `main` first (PR #693) and the epic branch has merged `main`, so every list returns only readable rows and the agreement test holds by construction. Its GET-route guard now classifies every read, so a new read route without a check fails CI — this child's payload changes inherit that.
2. **Pins have no core contract.** **Lean: add `PortalResult{List,Get}ResponsePayloadSchema` to core** in this child and type the router's responses. The web's hand-typed `PortalResultPayload` goes away.
3. **Portal GET-one has no set.** **Lean: `PortalAccessService.load` returns `{ portal, set }`**, as `ConnectorInstanceAccessService` already does.
4. **Toolpacks.** Reads are class-level, builtins have no row, and `createdBy` isn't in the record schema. **Lean:**
   - **builtins** are `{ read: true, write: false, delete: false }` (they're platform-defined; nothing in the org can edit them);
   - **custom rows** compute from the DB row's `createdBy` server-side, *without* adding `createdBy` to the response.
5. **Hand-written Swagger components drift silently.** Every touched response gains a field. **Lean: convert the touched response components to Zod-derived registration** (the `stationSchemas` pattern), so the existing round-trip test covers them. It's mechanical, and it removes the drift class rather than hand-editing 9 components.

### Decision 4 — How the CTA components render a gate

`ActionGate = { kind:"allow" } | { kind:"hide" } | { kind:"disable"; reason } | { kind:"upsell"; reason; onUpgrade }`.

- **`hide`:** not rendered. `ActionsMenu` renders **no trigger** if every item is hidden. `ActionsSuite`/`DetailCard` render nothing for an all-hidden set, and `PageHeader`/`PageSection` drop the menu.
- **`disable`:** rendered with **`aria-disabled="true"` instead of `disabled`** so it stays focusable and hoverable. `onClick` is swallowed, and a MUI `Tooltip` shows `reason`. A menu item uses the same pattern (`MenuItem` with `aria-disabled` + a guarded click), so keyboard users get the reason too. The visual matches the disabled style.
- **`upsell`:** rendered **enabled** with a lock/upgrade adornment and the `reason` as a tooltip. Activating it calls `onUpgrade` (the web passes a navigate to Settings → Billing, the same destination `UpgradeLink` uses).
- **New components:** `GatedButton` and `GatedIconButton` (button props + `gate`) for standalone CTAs, `primaryAction` included.

**Remove `disabled` from `ActionMenuItem`/`ActionSuiteItem`; `gate` replaces it.** The type system then enforces the convention on every menu and suite item, and every state-disabled item has to give a reason, which is the convention's point. Today's state-disabled items (connector lock, …) migrate to `gate: { kind: "disable", reason }` in this child: it's mechanical, and without it they wouldn't compile.

**Lean: as stated.** `disabled` with no reason is exactly the defect the audit found everywhere. Making it unrepresentable on the shared items is worth the one-time migration, and it's a clean cut, consistent with the no-aliases rule.

### Decision 5 — The web decider

Gates are computed per row, so the decider can't be a hook called in a loop. **Lean:**
- a **pure `decideActionGate(input)`** (unit-tested precedence: permission → `hide`, or `disable` for a plausible primary; tier → `upsell`; state → `disable`; else `allow`);
- a **`useActionGate()`** hook that closes over the per-session parts (the entitlement reads, failing **closed**, and the billing navigate) and returns a bound `gate(input)`.

The input is `{ allowed, primary?: { plausible, grantHint }, entitled?: boolean, blocked?: string }`, where `allowed` is `capabilities.<verb>` or a class-level `can()`.

### Decision 6 — `onPermissionDenied`

The epic leaned "toast + invalidate, declared on the endpoint". The survey sharpens it: the **toast/FormAlert split** (CLAUDE.md Toast Pattern) is decided by the *caller* (a dialog vs elsewhere), which the mutation hook can't see. A toast raised from the hook would double up with a dialog's `FormAlert`.

**Lean:** the SDK endpoint declares `onPermissionDenied: { invalidate: (vars) => QueryKey[] }`. `useAuthMutation` wraps `onError`, and when `isPermissionDenied(error)` it **invalidates** those keys, so affordances re-render from fresh capabilities. **Feedback stays the caller's:** dialogs keep `FormAlert` (which already shows the standard permission copy), and non-dialog callers keep their `toast.error`, using the standard `PERMISSION_DENIED_MESSAGE` via `isPermissionDenied`. The epic's acceptance ("toast, then the affordance is gone") holds for non-dialog actions; dialogs show the alert instead, per the Toast Pattern.

### Decision 7 — Enforcing the convention

1. **Types:** `disabled` removed from menu and suite items (D4).
2. **A guard test** over `apps/web` source (the `dialog-enter-submit.guard` pattern): it fails a raw `<Button|IconButton disabled={…}>` whose expression references a permission or entitlement read (`can(`, `canOnResource`, `capabilities.`, `…Entitled`). An explicit allowlist covers the non-permission `can*` names the survey found (RestApi `canTest`/`canAdvance`, `AdvancedFilterBuilder`, RegionEditor `canRemove`/`canAddSegment`), plus a non-vacuity count.
3. **The known violations** (Settings, TierCard, SubscriptionBilling, MembersTab) belong to #691, so they start on a **named, dated allowlist that #691 empties**. The guard passes now and can't grow.

**Lean: all three.**

## Tradeoff comparison

| | D1 on-row | D2 shape | D3 gaps | D4 render + drop `disabled` | D5 pure + hook | D6 invalidate only | D7 types + guard |
|---|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes (#692 ordering) | Yes | Yes | Yes | Yes |

## Recommendation

1. `ObjectCapabilitiesSchema {read, write, delete, share?}` (share only for station/pin/curated_view) and a `withCapabilities(RowSchema)` contract helper in `@portalai/core/contracts`.
2. `ObjectCapabilitiesService.for(set, type, row)` + `.forMany` in the API. Every list and GET-one route of the 12 types holds one `set` and attaches `capabilities` to top-level rows. Toolpacks: builtins are read-only; custom rows are computed from the row's `createdBy` without exposing it.
3. Station/pin `can*` fields move to `capabilities` (clean cut) and all web consumers are migrated.
4. A pin response contract in core; `PortalAccessService.load` returns `{portal, set}`; the touched Swagger response components become Zod-derived.
5. #692 has landed (PR #693) and is merged into the epic: reads are authorized, so `capabilities.read` is true on every returned row.
6. Core: `ActionGate`; `ActionsMenu`/`ActionsSuite`/`DetailCard`/`PageHeader`/`PageSection` render gates (all-hidden → nothing); `disabled` is removed from the item types in favour of `gate`; new `GatedButton`/`GatedIconButton`; `aria-disabled` + focusable + `Tooltip`; upsell is enabled and calls `onUpgrade`.
7. Web: pure `decideActionGate` + `useActionGate()` (entitlements fail closed, billing navigate); `onPermissionDenied: { invalidate }` on SDK endpoints, with feedback staying with the caller.
8. Enforcement: the type change + a source guard for permission-disabled raw buttons, with #691's known violations on a shrink-only allowlist.
9. Reference adoption: the Views list and page. Edit/Share/Delete come from `capabilities`, and read-only callers get no editor.
10. CLAUDE.md "Action affordances & permissions (apps/web)" + the copilot mirror.
11. One agreement integration test per type: payload `capabilities` == the mutation routes' allow/deny for owner, member and other-member.

## Open questions

1. **Should `capabilities.read` exist if it's always true on returned rows?** Lean: yes. The shape stays total, and read-only shares or "visible but not openable" rows can use it later without a contract change (D2).
2. **Should upsell items show a lock icon or text?** Lean: a lock icon plus a tooltip with the reason. The copy names the plan feature, as `UpgradeLink` does. A visual detail for the spec; not a contract question.
3. **Is the epic's plausible-primary rule (Create on index pages, caller reads the type) implemented in the decider here or per child?** Lean: in the decider (`primary` input), so children only pass the flag.
4. **Should area children's `disabled` items that this child migrates mechanically get real reasons now?** Lean: yes. The migration writes the state reason that's already on screen nearby (e.g. the lock alert's copy); a child can refine it.

## Enterprise-scale considerations

- **Concurrency & correctness:** capabilities are a snapshot. Staleness is handled by D6 (invalidate on denial); the server stays the boundary (#685).
- **Accuracy & auditability:** UI and server agree by construction, since they use the same `PermissionSet.can` on the same object in the same request. The per-type agreement test is the record.
- **Failure modes:** missing capabilities fail **closed** (hide/disable). Entitlement reads fail closed in the decider, which fixes the fail-open reads for gate purposes. The server enforces either way, so failing closed costs only UX.
- **Scale:** one `loadSet` per request (most routes already load it); ≤100 rows × ≤4 in-memory `can` calls per page (the records limit cap); payload +~40 B/row.
- **Multi-tenancy:** computed from the caller's org-scoped set over org-scoped rows. Field mappings' and the other read leaks were fixed by #692 (merged first).
- **Contract stability:** new verbs extend `ObjectCapabilities`; new gate kinds extend `ActionGate`; call sites consume gates, not booleans.
- **Data lifecycle:** N/A (computed per request, nothing stored).

## What this doesn't decide

- Adoption beyond the Views pages: #689–#691 own their audit rows.
- The #692 fix itself (done, PR #693).
- Route-level guards (out of scope per the epic doc).

## Next step

`docs/ACTION_GATES_FOUNDATION.spec.md` pins the contract (schemas, service API, component props, decider signature, guard rules), then the plan slices it. Roughly:
1. Core `ActionGate` + gated components, with `disabled` → `gate` migration.
2. The capabilities contract + service + payloads, type by type, with agreement tests and Zod-derived Swagger.
3. Station/pin migration.
4. The decider + `onPermissionDenied`.
5. The guard + docs.
6. The Views adoption.

Each is a commit on `feat/688-action-gates-foundation`, PR'd into `epic/per-object-action-affordances`.
