# Action gates foundation — Spec

**Issue:** [EnterpriseBT/portal-ai#688](https://github.com/EnterpriseBT/portal-ai/issues/688) · **Epic:** #684 · **Discovery:** `docs/ACTION_GATES_FOUNDATION.discovery.md` (epic design: `docs/PER_OBJECT_ACTION_AFFORDANCES.discovery.md`)

This spec pins the contracts the three area children (#689–#691) build on:
- the per-object `capabilities` payload field and its server helper;
- the core `ActionGate` and the gated CTA components;
- the web decider (`decideActionGate` / `useActionGate`);
- `onPermissionDenied` on `useAuthMutation`;
- the enforcement guard;
- the convention in CLAUDE.md.

The Views list and view page are the reference adoption. #692 (read authorization) is merged into the epic, so every returned row is readable.

## Key decisions (flag for review)

1. **`capabilities` lives on the row** (discovery D1). It goes on each top-level row of GET and list payloads, not in a sidecar map. Included relations don't carry it.
2. **The shape is `{ read, write, delete }`, plus `share` only on shareable types** (station, pin, curated_view) (D2). The station and pin `canShare/canWrite/canDelete` fields move onto it, with no aliases.
3. **One server helper** (D2/D3): `ObjectCapabilitiesService` computes capabilities with the same `PermissionSet.can` the mutation routes `check`. Toolpacks:
   - **builtins** are `{read:true, write:false, delete:false}`;
   - **custom rows** are computed from the DB row's `createdBy`, which is never exposed.
4. **Gates are decided in web and rendered by core** (D4/D5). `ActionGate = allow | hide | disable{reason} | upsell{reason, onUpgrade}`.
   - **Precedence:** permission → tier → state.
   - **`disable` stays focusable:** it renders `aria-disabled` with a tooltip, never a native `disabled`.
   - **`upsell` is enabled** and calls `onUpgrade`.
5. **`disabled` is removed from `ActionMenuItem` and `ActionSuiteItem`** (D4). `gate` replaces it, and every current `disabled` item migrates to `gate: {kind:"disable", reason}` in this child.
6. **`onPermissionDenied` only invalidates** (D6). Feedback stays with the caller: `FormAlert` in a dialog, a toast elsewhere, using the standard permission copy.
7. **Enforcement** (D7) has three parts:
   - the item-type change;
   - a source guard against permission-based raw `disabled` buttons;
   - #691's four known violations on a shrink-only allowlist.
8. **Fail closed.** Missing capabilities or an unknown entitlement hide or disable; they never show a mutation.

## Scope

### In scope
- **Core:** the capabilities contract and the pin response contract; `ActionGate`; the gated `ActionsMenu`, `ActionsSuite`, `DetailCard`, `PageHeader` and `PageSection`; `GatedButton` and `GatedIconButton`.
- **API:** `ObjectCapabilitiesService`; `capabilities` on the list and GET of all 12 types; `PortalAccessService.load` returns `{ portal, set }`; Swagger components for the touched responses become Zod-derived.
- **Web:**
  - `decideActionGate` and `useActionGate`;
  - `onPermissionDenied`;
  - the station and pin consumers migrated to `capabilities`;
  - every `disabled` menu or suite item migrated to `gate`;
  - the guard;
  - Views list and page adoption.
- **Docs:** the CLAUDE.md "Action affordances & permissions (apps/web)" section and its copilot mirror.

### Out of scope
- Adopting gates on surfaces other than the Views pages (#689–#691). The guard's allowlist names #691's four known violations.
- Any authorization change (#685/#692 settled it); route-level guards; visual redesign.

## Surface

### Core contract — `packages/core/src/contracts/capabilities.contract.ts` (new; exported from `contracts/index.ts`)

```ts
export const ObjectCapabilitiesSchema = z.object({
  read: z.boolean(),
  write: z.boolean(),
  delete: z.boolean(),
});
export const ShareableObjectCapabilitiesSchema = ObjectCapabilitiesSchema.extend({
  share: z.boolean(),
});
export type ObjectCapabilities = z.infer<typeof ObjectCapabilitiesSchema>;
export type ShareableObjectCapabilities = z.infer<typeof ShareableObjectCapabilitiesSchema>;

/** Row schema + `capabilities` (non-shareable types). */
export const withCapabilities = <T extends z.ZodObject>(row: T) =>
  row.extend({ capabilities: ObjectCapabilitiesSchema });
/** Row schema + `capabilities` with `share` (station, pin, curated_view). */
export const withShareableCapabilities = <T extends z.ZodObject>(row: T) =>
  row.extend({ capabilities: ShareableObjectCapabilitiesSchema });
```

### Response contracts that change

The top-level row of each payload gains `capabilities` through the helpers. Each schema is named exactly as in its contract file today.

| Type | Contract file | Schemas (list rows + GET row) | Helper |
|---|---|---|---|
| station | `station.contract.ts` | `StationListResponsePayloadSchema`, `StationGetResponsePayloadSchema` (`station`; **`canShare/canWrite/canDelete` removed**) | shareable |
| pin | `portal.contract.ts` (**new** `PortalResultListResponsePayloadSchema {portalResults[], total, limit, offset}`, `PortalResultGetResponsePayloadSchema {portalResult}`; **`can*` removed**) | both | shareable |
| curated_view | `curated-view.contract.ts` | `CuratedViewListResponsePayloadSchema` (`CuratedViewListItemSchema` rows), `CuratedViewGetResponsePayloadSchema` | shareable |
| portal | `portal.contract.ts` | `PortalListResponsePayloadSchema`, `PortalGetResponsePayloadSchema` (`portal`) | plain |
| connector_instance | `connector-instance.contract.ts` | `ConnectorInstanceListResponsePayloadSchema`, `…ListWithDefinitionResponsePayloadSchema`, `ConnectorInstanceGetResponseSchema` | plain |
| entity | `connector-entity.contract.ts`, `entity-tag-assignment.contract.ts` | `ConnectorEntityListResponsePayloadSchema` (+ `WithMappings`, `WithInstance`, `ListWithTags`), `ConnectorEntityGetResponsePayloadSchema` | plain |
| entity_record | `entity-record.contract.ts` | `EntityRecordListResponsePayloadSchema`, `EntityRecordGetResponsePayloadSchema` | plain |
| field_mapping | `field-mapping.contract.ts` | `FieldMappingListResponsePayloadSchema` (+ `WithConnectorEntity`, `WithColumnDefinition`), `FieldMappingGetResponsePayloadSchema` | plain |
| tag | `entity-tag.contract.ts` | `EntityTagListResponsePayloadSchema`, `EntityTagGetResponsePayloadSchema` | plain |
| entity_group | `entity-group.contract.ts` | `EntityGroupListResponsePayloadSchema`, `EntityGroupGetResponsePayloadSchema` | plain |
| column_definition | `column-definition.contract.ts` | `ColumnDefinitionListResponsePayloadSchema`, `ColumnDefinitionGetResponsePayloadSchema` | plain |
| toolpack | `toolpack.contract.ts` | `ToolpackListResponsePayloadSchema`, `ToolpackGetResponsePayloadSchema` (both `ToolpackSchema` variants) | plain |

### API — `apps/api/src/services/object-capabilities.service.ts` (new)

```ts
export class ObjectCapabilitiesService {
  /** The caller's capabilities on one readable row: the same `set.can` the
   *  mutation routes `check`. `share` is present iff the type is shareable. */
  static for(
    set: PermissionSet,
    type: PermissionResourceType,
    row: { id: string; createdBy: string }
  ): ObjectCapabilities | ShareableObjectCapabilities;
  /** `rows` with `capabilities` attached (one `loadSet` per request, in-memory). */
  static attach<T extends { id: string; createdBy: string }>(
    set: PermissionSet, type: PermissionResourceType, rows: T[]
  ): Array<T & { capabilities: ObjectCapabilities | ShareableObjectCapabilities }>;
  /** Toolpacks: builtins are read-only; custom rows use the DB row's createdBy
   *  (taken from the repository row and never added to the response). */
  static forToolpack(
    set: PermissionSet,
    pack: { id: string; kind: "builtin" } | { id: string; kind: "custom"; createdBy: string }
  ): ObjectCapabilities;
}
```

- `read` is `set.can("resource.read", obj)`. Returned rows are already readable, so it's true, but it's computed rather than assumed.
- Every list and GET route of the 12 types holds **one** `set` per request (most already do) and returns rows through `attach`/`for`.
- **`PortalAccessService.load`** now returns `Promise<{ portal: PortalSelect; set: PermissionSet }>`. Its callers destructure.
- **Swagger:** the touched response components become `z.toJSONSchema(<ResponseSchema>, JSON_SCHEMA_OPTS)` registrations, following the `stationSchemas` pattern in `swagger.config.ts` and keeping the existing component names. That covers ColumnDefinition, ConnectorEntity, FieldMapping, EntityTag, EntityGroup, CuratedView, Portal and PortalResult (list + get). The existing round-trip test then covers them.

### Core UI — `packages/core/src/ui/ActionGate.ts` (new; exported from `ui/index.ts`)

```ts
export type ActionGate =
  | { kind: "allow" }
  | { kind: "hide" }
  | { kind: "disable"; reason: string }
  | { kind: "upsell"; reason: string; onUpgrade: () => void };
export const ALLOW: ActionGate = { kind: "allow" };
```

### Core UI — gated components

- **`ActionMenuItem` / `ActionSuiteItem`:** `disabled` is **removed**. They gain `gate?: ActionGate` (omitted means `allow`).
- **`ActionsMenu`:**
  - drops `hide` items, and returns `null` when none remain (no trigger);
  - `disable` renders a `MenuItem` with `aria-disabled="true"`, the disabled visual and a guarded click (no `onClick`, the menu stays open), wrapped in a MUI `Tooltip` titled `reason`;
  - `upsell` renders an enabled item with a lock adornment and a `Tooltip` titled `reason`, and clicking it calls `onUpgrade`.
- **`ActionsSuite`:** drops `hide` items and returns `null` when none remain. Each item renders through `GatedButton`.
- **`DetailCard`** (`actions`) and **`PageHeader` / `PageSection`** (`secondaryActions`): no prop change. They render through the above, and omit the menu or suite when it's all-hidden.
- **`GatedButton`** (`GatedButton.tsx`) takes `ButtonProps & { gate?: ActionGate }`:
  - `hide` returns `null`;
  - `disable` renders `aria-disabled="true"` with the `Mui-disabled` visual, swallows `onClick`/submit, stays in the tab order, and shows a `Tooltip` titled `reason`;
  - `upsell` is enabled with a lock `startIcon`, and `onClick` calls `onUpgrade`;
  - `allow` passes through.
- **`GatedIconButton`** (`GatedIconButton.tsx`) takes `IconButtonProps & { gate?: ActionGate }` with the same rules. The `aria-label` remains required by convention.

### Web — `apps/web/src/utils/action-gate.util.ts` (new)

```ts
export interface ActionGateInput {
  /** The permission: `capabilities.<verb>` or a class-level `can(...)`. */
  allowed: boolean;
  /** A page's primary action the caller could plausibly get (Create on an
   *  index page when they read the type): shown disabled, not hidden. */
  primary?: { plausible: boolean; grantHint: string };
  /** `false` when the org's tier excludes it (omit when not tier-gated). */
  entitled?: boolean;
  upgradeReason?: string;
  onUpgrade?: () => void;
  /** Transient state that blocks it (running job, pending save); null = none. */
  blocked?: string | null;
}
/** Pure. Precedence: permission → tier → state. */
export function decideActionGate(input: ActionGateInput): ActionGate;
```

- `!allowed` returns `primary?.plausible ? {disable, reason: grantHint} : {hide}`.
- `entitled === false` returns `{upsell, reason: upgradeReason, onUpgrade}`.
- A `blocked` value returns `{disable, reason: blocked}`.
- Otherwise it returns `{allow}`.

**`apps/web/src/utils/use-action-gate.util.ts` (new):** `useActionGate()` returns `{ gate(input: Omit<ActionGateInput, "onUpgrade">): ActionGate; entitled(key: "customToolpacks" | "customRbac" | …): boolean }`.
- `entitled` reads `sdk.organizations.usage()` and **fails closed** (`?? false`).
- `onUpgrade` navigates to Settings → Billing, the same target as `UpgradeLink`.

### Web — `onPermissionDenied` on `useAuthMutation` (`utils/api.util.ts`)

```ts
interface AuthMutationConfig<TData, TVariables> {
  // …existing
  /** On a permission-denied error (`isPermissionDenied`), invalidate these
   *  keys so affordances re-render from fresh capabilities. Feedback stays
   *  with the caller (FormAlert in a dialog, a toast elsewhere). */
  onPermissionDenied?: { invalidate: (variables: TVariables) => QueryKey[] };
}
```

The hook wraps `mutationOptions.onError`: it invalidates first, then calls the caller's `onError`. In this child it's declared on the curated-view mutations (update, delete, share). The area children declare it on theirs.

### Web — migrations
- **Stations and pins:**
  - `StationDetail.view.tsx` and `PinnedResultDetail.view.tsx` read `capabilities.{share,write,delete}`;
  - `api/portal-results.api.ts` drops its hand-typed `PortalResultPayload` in favour of the core contract;
  - the `ShareDialog.component.tsx` comment updates;
  - `StationDetail.view.test.tsx` and `PinnedResultDetail.test.tsx` update.
- **Menu and suite items:** every `ActionMenuItem`/`ActionSuiteItem` in `apps/web` that sets `disabled` becomes `gate: { kind: "disable", reason }`, with the reason taken from the state shown nearby (e.g. the lock alert's copy). The type change forces completeness.

### Web — reference adoption (Views)
- **`CuratedViews.view.tsx`:**
  - each row's Share is gated by `capabilities.share` and its Delete by `capabilities.delete`, using `hide` when not allowed;
  - Create (the `PageHeader` primary) uses `GatedButton`. It is allowed by class `canOnResource("curated_view","write")`, else `disable` with "Ask an owner or admin for access to create views" when the caller reads the type, else `hide`.
- **`CuratedViewDetail.view.tsx`:**
  - Edit is gated by `capabilities.write` and Delete by `capabilities.delete`, both rendered with `GatedButton`;
  - `CuratedViewEditorDialog` opens only with `write`;
  - the curated-view mutations declare `onPermissionDenied` (invalidating `curatedViews.root`).

### Web — guard `apps/web/src/__tests__/action-gate.guard.test.ts` (new)

The guard scans every `.tsx` file under `apps/web/src`, skipping `__tests__` and `stories`, using the `dialog-enter-submit.guard` pattern. It fails a `<Button|IconButton …disabled={EXPR}>` where `EXPR` references `can(`, `canOnResource`, `capabilities.`, `can[A-Z]\w*` or `\w*Entitled`.

It has these exceptions:
- **Non-permission names**, allowlisted by name: `canTest`, `canAdvance`, `canRemove`, `canAddSegment`, and `AdvancedFilterBuilder`'s `can*`.
- **#691's known violations** in `KNOWN_VIOLATIONS`, each with an issue tag. #691 empties the list, and it can only shrink:
  - `views/Settings.view.tsx`
  - `components/TierCard.component.tsx`
  - `components/SubscriptionBilling.component.tsx`
  - `components/MembersTab.component.tsx`

It also checks:
- **Non-vacuity:** at least 200 files scanned.
- **Shrink-only:** every allowlisted file still contains a violation, so a fixed file must leave the list.

### Docs
- **CLAUDE.md "Action affordances & permissions (apps/web)"** (new section) covers:
  - the server is the boundary;
  - decide per object from `capabilities`;
  - the precedence: permission → `hide` (or `disable` for a plausible primary action), tier → `upsell`, state → `disable` with a reason;
  - read-only callers get read-only views;
  - render through `ActionGate`, `GatedButton` and the gated core components;
  - a raw `disabled` on a permission-gated action is a bug (the guard);
  - `onPermissionDenied` on mutation endpoints.
- **Copilot mirror:** the same section in `.github/copilot-instructions.md`.
- **Job-lock rule:** the CLAUDE.md job-lock bullet ("disabled with a tooltip") becomes "`disable` gate with the job named".

## Migration / Seed

None. No schema change, and no seeded rows change.

## TDD test plan

Run with `npm run test:unit` / `npm run test:integration` from `packages/core`, `apps/api` and `apps/web`. Never invoke jest directly.

### Core — `packages/core/src/__tests__/`
- **`ui/ActionGate` rendering** (`ActionsMenu.test.tsx`, `ActionsSuite.test.tsx`, `PageHeader.test.tsx`, `PageSection.test.tsx`, `DetailCard.test.tsx`):
  - `hide` items aren't rendered, and all-hidden renders no trigger, suite or menu;
  - `disable` is `aria-disabled`, focusable, its tooltip shows `reason` on hover and on focus, and clicking does nothing;
  - `upsell` is enabled and clicking calls `onUpgrade`;
  - omitted `gate` behaves as allow.
  About 14 cases.
- **`ui/GatedButton.test.tsx`, `ui/GatedIconButton.test.tsx`:** the four kinds; a disabled gate still in the tab order; `onClick` swallowed; tooltip on focus. About 10.
- **`contracts/capabilities.contract.test.ts`:**
  - `withCapabilities` accepts `{read,write,delete}` and rejects a missing field;
  - `withShareableCapabilities` requires `share`;
  - the station and pin payload schemas no longer accept `canShare`.
  About 5.

### API — `apps/api/src/__tests__/`
- **`services/object-capabilities.service.test.ts`** (unit):
  - the owner gets all true;
  - a member gets all true on their own row, and `{read:true, write:false, delete:false}` on a system row;
  - `share` is present only for the shareable types;
  - toolpacks: a builtin is read-only, a custom row is computed from `createdBy`.
  About 8.
- **`__integration__/routes/object-capabilities.agreement.integration.test.ts`** (new). Per type, using owner and member callers, `seedTenancyFixture`, and owner-, member- and system-created rows:
  - the list and the GET carry `capabilities` matching the matrix;
  - **agreement:** when `capabilities.delete` is false, the member's DELETE on that row returns 403 or 404 and the row survives;
  - when it's true, the owner's DELETE on a throwaway row returns 2xx.
  12 types × about 3 assertions, about 36 cases (table-driven).
- **Existing suites:**
  - station and portal-results GET tests move to `capabilities.*`;
  - `PortalAccessService` callers compile against the new return;
  - `swagger.config.test.ts` round-trip covers the newly Zod-derived components.
  About 8 updated.

### Web — `apps/web/src/__tests__/`
- **`utils/action-gate.util.test.ts`:** each precedence branch (permission → hide or primary-disable; tier → upsell; state → disable; allow), plus permission beating tier and tier beating state. About 8.
- **`utils/use-action-gate.util.test.ts`:** `entitled` fails closed when usage is undefined; `onUpgrade` navigates to billing. About 3.
- **`api.util` `onPermissionDenied`:** invalidates the declared keys on `INSUFFICIENT_ROLE`, not on other errors, and still calls the caller's `onError`. About 3.
- **`CuratedViewsView.test.tsx`, `CuratedViewDetailView.test.tsx`:**
  - a row or view with read only shows no Share, Edit or Delete;
  - write without share shows Edit but not Share;
  - Create is disabled with the hint for a caller without create;
  - the editor is unreachable without write.
  About 8.
- **`StationDetail.view.test.tsx`, `PinnedResultDetail.test.tsx`:** migrated to `capabilities`, with the same assertions. About 6 updated.
- **`action-gate.guard.test.ts`:** non-vacuity; no unlisted violation; the allowlist is shrink-only; a probe file with `disabled={!canX}` is reported. About 4.

**Totals: about 133 cases** (about 85 new, the rest updated).

## Acceptance criteria

- [ ] On the Views list and page, a member with read on a view and write on their own sees no Share, Edit or Delete on the former, sees them on the latter, and never reaches the editor without write.
- [ ] Every list and GET payload of the 12 types carries `capabilities`, equal to what the mutation routes allow for that caller (agreement test). `share` appears only on station, pin and curated view.
- [ ] A disabled action is reachable by keyboard and announces its reason. A menu whose items are all hidden renders no trigger. An upsell action leads to billing.
- [ ] `ActionMenuItem` and `ActionSuiteItem` have no `disabled`. Every former use is a `disable` gate with a reason.
- [ ] A permission refusal on a curated-view mutation invalidates that view's queries, and the affordance re-renders from fresh capabilities.
- [ ] Missing capabilities or entitlements fail closed.
- [ ] The guard fails CI on a new permission-based raw `disabled`. #691's four known violations are the only allowlisted ones.
- [ ] CLAUDE.md and its mirror carry the convention.

## Risks & rollback

- **Contract break for station and pin consumers** (the `can*` fields are removed). Detection: type-check across web plus the migrated tests. Rollback: revert the slice. There are no external API consumers (#685 audit).
- **Hand-written Swagger components drifting during the conversion.** Detection: the round-trip test plus the OpenAPI conformance test (#447).
- **Over-hiding** (a capability computed wrong hides a legitimate action). This fails closed: UX cost only, never a security cost. Detection: the agreement test.
- **Payload size:** about 40 B per row, at most 100 rows per page (records cap). Negligible.
- **Multi-tenant:** capabilities come from the caller's org-scoped set on org-scoped, read-checked rows (#692), so nothing crosses tenants.

## Files touched

- **New:**
  - `packages/core/src/contracts/capabilities.contract.ts`
  - `packages/core/src/ui/{ActionGate.ts, GatedButton.tsx, GatedIconButton.tsx}` (+ tests and stories)
  - `apps/api/src/services/object-capabilities.service.ts`
  - `apps/web/src/utils/{action-gate.util.ts, use-action-gate.util.ts}`
  - `apps/web/src/__tests__/action-gate.guard.test.ts`
  - `apps/api/src/__tests__/__integration__/routes/object-capabilities.agreement.integration.test.ts`
- **Edit, core:**
  - `ui/{ActionsMenu, ActionsSuite, DetailCard, PageHeader, PageSection}.tsx`
  - `ui/index.ts`
  - `contracts/{index, station, portal, curated-view, connector-instance, connector-entity, entity-tag-assignment, entity-record, field-mapping, entity-tag, entity-group, column-definition, toolpack}.contract.ts`
- **Edit, API:**
  - routes: `station`, `portal-results`, `curated-view`, `portal`, `connector-instance`, `connector-entity`, `entity-tag-assignment`, `entity-record`, `field-mapping`, `entity-tag`, `entity-group`, `column-definition`, `toolpacks`
  - services: `portal-access.service.ts` and its callers
  - `config/swagger.config.ts`
- **Edit, web:**
  - `utils/api.util.ts`
  - `api/{portal-results, curated-views}.api.ts`
  - `views/{StationDetail, PinnedResultDetail, CuratedViews, CuratedViewDetail}.view.tsx`
  - `components/ShareDialog.component.tsx`
  - every file with a `disabled` menu or suite item
  - the matching tests
- **Docs:** `CLAUDE.md`, `.github/copilot-instructions.md`.

## Next step

`docs/ACTION_GATES_FOUNDATION.plan.md` sequences this into about 7 TDD slices, each a commit on `feat/688-action-gates-foundation`:
1. Core `ActionGate` and the gated components, with the `disabled` → `gate` migration.
2. The capabilities contract and service.
3. Payloads type by type, with the agreement test and Zod-derived Swagger.
4. The station and pin migration.
5. The decider and `onPermissionDenied`.
6. The guard and docs.
7. The Views adoption.

The PR targets `epic/per-object-action-affordances`.
