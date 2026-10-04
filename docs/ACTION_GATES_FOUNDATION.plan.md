# Action gates foundation — Plan

**This is the TDD-sequenced build of the foundation every area child adopts:**
- the core `ActionGate` and the gated CTA components;
- per-object `capabilities` on all 12 payloads, with agreement tests;
- the web decider and `onPermissionDenied`;
- the Views reference adoption;
- the guard and the convention.

Spec: `docs/ACTION_GATES_FOUNDATION.spec.md`. Discovery: `docs/ACTION_GATES_FOUNDATION.discovery.md` (epic design: `docs/PER_OBJECT_ACTION_AFFORDANCES.discovery.md`). Issue: #688, epic #684. Builds on **#692**: read authorization, merged into the epic, so every returned row is readable.

**Eight slices.** Each one sits behind a green test suite and leaves the repo compilable. They land as **commits on `feat/688-action-gates-foundation`**, with one PR into `epic/per-object-action-affordances` (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package. Never invoke jest directly.

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice:
1. Write failing tests.
2. Make the smallest change that greens them.
3. Run the focused tests.
4. At the boundary, run `npm run lint && npm run type-check` in every touched package. Rebuild core (`npm run build --workspace=packages/core`) before web or api type-check, because they read its `dist`.
5. Move to the next slice.

**Sequencing rationale.** Pure leaf UI comes first. Contract changes that break consumers land in the same slice as those consumers' migration. Wiring, adoption and enforcement come last.
- **Slice 1:** `ActionGate` + `GatedButton`/`GatedIconButton`. Additive core UI; nothing uses it yet.
- **Slice 2:** menu and suite items take `gate` and lose `disabled`. The type change breaks web call sites, so they migrate in the same slice to keep the tree compiling.
- **Slice 3:** the capabilities contract + `ObjectCapabilitiesService`. Additive; no route uses it yet.
- **Slice 4:** the three shareable types (station, pin, curated_view). Their `can*` fields go, so the web station and pin consumers migrate here. The pin response contract is new. This slice brings the agreement test.
- **Slice 5:** the other nine types, plus `PortalAccessService.load → {portal, set}`, plus Zod-derived Swagger for every touched response. It extends the agreement test.
- **Slice 6:** the web decider + `useActionGate` + `onPermissionDenied`. Pure plus the hook; no surface uses them yet.
- **Slice 7:** the Views reference adoption. The first consumer of slices 1–6. **The area children (#689–#691) unblock once this PR merges into the epic.**
- **Slice 8:** the guard + CLAUDE.md and copilot docs. The guard runs last, so it scans the final tree, Views included.

No migration and no seed.

---

## Slice 1 — `ActionGate`, `GatedButton`, `GatedIconButton`

This slice adds the context-free gate value and the two standalone gated CTAs. It's additive, and nothing uses them yet.

**Files**
- New:
  - `packages/core/src/ui/ActionGate.ts` (`ActionGate`, `ALLOW`)
  - `packages/core/src/ui/GatedButton.tsx`, `GatedIconButton.tsx`
  - their tests in `src/__tests__/ui/`
  - stories in `src/stories/`
- Edit: `packages/core/src/ui/index.ts` (exports).

**Steps**
1. **Tests** (spec → Core: `GatedButton.test.tsx`, `GatedIconButton.test.tsx`, about 10 cases). Cover the four kinds:
   - `hide` renders nothing;
   - `disable` is `aria-disabled`, stays in the tab order, swallows `onClick`, and shows its tooltip on hover and focus;
   - `upsell` is enabled with a lock and calls `onUpgrade`;
   - `allow` passes through, and an omitted gate behaves as allow.
   Run; they fail.
2. **Implement** the type and both components with MUI `Tooltip`, using the `Mui-disabled` visual without native `disabled`. Green.
3. Lint and type-check core.

**Done when:** the 10 cases pass and the exports exist; no other file references them yet.

**Risk:** MUI `Tooltip` needs a focusable child. An `aria-disabled` button stays focusable, so no `span` wrapper is needed, unlike today's hand-rolled pattern.

---

## Slice 2 — Gated menus and suites; `disabled` → `gate`

`ActionsMenu`, `ActionsSuite`, `DetailCard`, `PageHeader` and `PageSection` render gates. `disabled` is removed from `ActionMenuItem` and `ActionSuiteItem`, and every web item that sets it migrates to `gate: { kind: "disable", reason }`.

**Files**
- Edit, core: `ui/{ActionsMenu, ActionsSuite, DetailCard, PageHeader, PageSection}.tsx`, plus `ActionsMenu.test.tsx`, `ActionsSuite.test.tsx`, `PageHeader.test.tsx`, `PageSection.test.tsx` and `DetailCard.test.tsx`.
- Edit, web: every file whose `ActionMenuItem` or `ActionSuiteItem` sets `disabled`. The type error lists them; a source grep beforehand gives the count for the commit message. Their reasons come from the state shown nearby (e.g. the connector lock alert's copy). Update the affected web tests' expectations to match.

**Steps**
1. **Tests** (spec → Core gated-rendering cases, about 14):
   - `hide` is dropped, and all-hidden renders no menu trigger or suite;
   - `disable` is `aria-disabled`, focusable, shows its tooltip, and clicking does nothing (the menu stays open);
   - `upsell` calls `onUpgrade`;
   - an omitted gate is allow;
   - `PageHeader`/`PageSection` omit the menu when every secondary action is hidden.
   Run; they fail.
2. **Implement** the rendering, `ActionsSuite` items via `GatedButton`, and the type change. Rebuild core, then fix every web compile error by migrating `disabled` to `gate`. Green.
3. Lint and type-check core and web; run the web unit tests for the migrated files.

**Done when:** the core cases pass, web type-checks with no `disabled` left on an item, and the migrated surfaces' tests are green.

**Risk:** the migration touches #689–#691's areas mechanically (state-disabled items only). It changes what renders, not who may act; the children later replace the reasons and add permission gates.

---

## Slice 3 — Capabilities contract + `ObjectCapabilitiesService`

This slice adds the shared shape and the server helper. It's additive.

**Files**
- New:
  - `packages/core/src/contracts/capabilities.contract.ts` (+ `contracts/index.ts` export)
  - `packages/core/src/__tests__/contracts/capabilities.contract.test.ts`
  - `apps/api/src/services/object-capabilities.service.ts`
  - `apps/api/src/__tests__/services/object-capabilities.service.test.ts`

**Steps**
1. **Tests.**
   - Core: `withCapabilities` accepts `{read, write, delete}` and rejects a missing field; `withShareableCapabilities` requires `share` (3 cases).
   - API unit, with a real `PermissionSet` built from fixture statements as `permission-set` tests do (about 8 cases):
     - the owner gets all true;
     - a member gets all true on their own row and read-only on a system row;
     - `share` is present only for shareable types;
     - `attach` keeps row order and fields;
     - toolpacks: a builtin is read-only, and a custom row is computed from `createdBy`.
   Run; they fail.
2. **Implement** both. Green.
3. Lint and type-check core and api.

**Done when:** about 11 cases pass and no route uses the service yet.

**Risk:** none.

---

## Slice 4 — Shareable payloads (station, pin, curated_view) + their web consumers

**Files**
- Edit, core:
  - `station.contract.ts`: `capabilities` on list rows and the GET station, with **`canShare/canWrite/canDelete` removed**.
  - `portal.contract.ts`: new `PortalResultListResponsePayloadSchema` and `PortalResultGetResponsePayloadSchema`, each with shareable `capabilities`.
  - `curated-view.contract.ts`.
- Edit, API: `routes/{station, portal-results, curated-view}.router.ts` (one `set` per request, rows through `attach`/`for`; pin responses typed by the new contract), plus their existing integration tests.
- Edit, web: `views/{StationDetail, PinnedResultDetail}.view.tsx`, `api/portal-results.api.ts` (drop the hand-typed payload), the `components/ShareDialog.component.tsx` comment, and their tests.
- Edit: `config/swagger.config.ts`. The station components are already Zod-derived; the `PortalResult*` and `CuratedView*` components convert to `z.toJSONSchema` registrations.
- New: `apps/api/src/__tests__/__integration__/routes/object-capabilities.agreement.integration.test.ts`, table-driven. This slice adds rows for the three types.

**Steps**
1. **Tests.**
   - The agreement suite, for station, pin and curated_view, with owner, member and system rows:
     - list and GET `capabilities` match the matrix;
     - when `delete` is false, the member's DELETE returns 403 or 404 and the row survives;
     - the owner's DELETE on a throwaway row returns 2xx.
   - Web: the station and pin detail tests assert on `capabilities.*`.
   Run; they fail.
2. **Implement** the contracts, routes, Swagger conversion and web migration. Green.
3. Lint and type-check core, api and web; run the api `swagger.config` test and the integration suites for station, portal-results and curated-view.

**Done when:** the agreement rows pass for the three types, no `canShare/canWrite/canDelete` remains anywhere, and Swagger round-trip passes.

**Risk:** the contract break ripples into web fixtures. The memory note says to run the full root build before pushing a core model change.

---

## Slice 5 — The other nine payloads + `PortalAccessService` + Swagger

**Files**
- Edit, core: `{portal, connector-instance, connector-entity, entity-tag-assignment, entity-record, field-mapping, entity-tag, entity-group, column-definition, toolpack}.contract.ts`.
- Edit, API:
  - `routes/{portal, connector-instance, connector-entity, entity-tag-assignment, entity-record, field-mapping, entity-tag, entity-group, column-definition, toolpacks}.router.ts`
  - `services/portal-access.service.ts` (returns `{portal, set}`) and its callers
  - `config/swagger.config.ts`: convert ColumnDefinition, ConnectorEntity, FieldMapping, EntityTag, EntityGroup and Portal responses to Zod-derived
- Edit, tests: extend the agreement suite with the nine types.
  - Toolpacks: a builtin has `delete: false`, and the owner's DELETE on it is refused.
  - Records: one row per entity.

**Steps**
1. **Tests:** the agreement rows for the nine types (about 27 cases), plus the updated `PortalAccessService` callers' tests. Run; they fail.
2. **Implement** route by route. Green.
3. Lint, type-check, the api unit suite (swagger parity), and the integration suites for the touched routers.

**Done when:** all 12 types' agreement rows pass, every touched list and GET carries `capabilities`, and Swagger round-trip and OpenAPI conformance pass.

**Risk:** this is the widest slice. If review weight demands it, it can split at a router boundary into two commits, since each router's change is independent.

---

## Slice 6 — `decideActionGate`, `useActionGate`, `onPermissionDenied`

**Files**
- New: `apps/web/src/utils/action-gate.util.ts`, `use-action-gate.util.ts`, and their tests.
- Edit: `apps/web/src/utils/api.util.ts` (`AuthMutationConfig.onPermissionDenied`, wrapping `onError`), plus an `api.util` test.

**Steps**
1. **Tests** (spec → Web: precedence about 8, hook 3, `onPermissionDenied` 3).
   - Precedence: permission → hide, or primary-disable with the grant hint; tier → upsell; state → disable; allow. Permission beats tier, and tier beats state.
   - Hook: `entitled` is false when usage is undefined; `onUpgrade` navigates to billing.
   - `onPermissionDenied`: on `INSUFFICIENT_ROLE` the declared keys are invalidated and the caller's `onError` still runs; other errors don't invalidate.
   Run; they fail.
2. **Implement.** Green.
3. Lint and type-check web.

**Done when:** about 14 cases pass and no surface uses them yet.

**Risk:** `api.util` is mocked in many web tests, so the new import stays in `permission-denied.util.ts` (the reason it's a separate file).

---

## Slice 7 — Views reference adoption

**Files**
- Edit:
  - `apps/web/src/views/{CuratedViews, CuratedViewDetail}.view.tsx`;
  - `api/curated-views.api.ts` (declares `onPermissionDenied: { invalidate: () => [queryKeys.curatedViews.root] }` on update and delete; the grants share mutation too, if it lives in the share API);
  - `CuratedViewsView.test.tsx`, `CuratedViewDetailView.test.tsx`.

**Steps**
1. **Tests** (spec → Views, about 8):
   - a read-only row or view shows no Share, Edit or Delete;
   - write without share shows Edit but not Share;
   - Create is disabled with the hint for a caller who reads views but can't create them, and hidden for one who can't read them;
   - the editor is unreachable without write;
   - a mutation 403 invalidates `curatedViews.root`.
   Run; they fail.
2. **Implement:**
   - rows' `DetailCard actions` carry gates from `row.capabilities`;
   - Edit and Delete use `GatedButton`;
   - Create uses the primary-plausible rule (class `canOnResource("curated_view","write")`);
   - the `canManage` class gate goes.
   Green.
3. Lint and type-check web; run the web unit tests for the Views files.

**Done when:** the Views acceptance criterion holds in the tests, and `canOnResource("curated_view", …)` gates only Create.

**Risk:** none beyond test fixtures needing `capabilities`.

---

## Slice 8 — Guard + convention docs

**Files**
- New: `apps/web/src/__tests__/action-gate.guard.test.ts`.
- Edit: `CLAUDE.md`. It gains the "Action affordances & permissions (apps/web)" section, and the job-lock bullet is reworded to a `disable` gate that names the job.
- Edit: `.github/copilot-instructions.md`, the mirror.

**Steps**
1. **Tests** (spec → guard, about 4):
   - non-vacuity: at least 200 files scanned;
   - no unlisted violation;
   - the `KNOWN_VIOLATIONS` allowlist (#691's four files) is shrink-only, so each listed file must still violate;
   - a probe file containing `disabled={!canX}` is reported.
   Write the guard. Its first run lists the real tree, which must match exactly the four known violations; if it doesn't, fix or classify before going green.
2. **Docs.**
3. Lint, type-check, the full web unit suite, and `npm run lint:doc-pointers`.

**Done when:** the guard is green with exactly the four allowlisted files, and the docs are updated.

**Risk:** the guard's regex could false-positive on non-permission `can*` names. The allowlist by name (`canTest`, `canAdvance`, `canRemove`, `canAddSegment`, and those in `AdvancedFilterBuilder`) covers the ones the survey found.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | `ActionGate`, `GatedButton`, `GatedIconButton` | core unit |
| 2 | gated menus and suites; `disabled` → `gate` across web | core unit + web type-check + migrated web tests |
| 3 | capabilities contract + `ObjectCapabilitiesService` | core + api unit |
| 4 | station, pin, curated_view payloads; web station and pin migration; pin contract | agreement (3 types) + web tests + swagger round-trip |
| 5 | 9 more payloads; `PortalAccessService` → `{portal, set}`; Zod-derived Swagger | agreement (12 types) + swagger/OpenAPI |
| 6 | decider, hook, `onPermissionDenied` | web unit |
| 7 | Views adoption | web Views tests |
| 8 | guard + CLAUDE.md and mirror | guard + doc-pointers |

## Cross-slice notes

- **Core changes need a root build before pushing.** Web and api read core's `dist`, and per the memory note (core model change → run the full root build) web fixtures can break on a new required field. Rebuild core at every boundary that touches it (slices 1, 2, 4 and 5). Rebuilding while the dev stack runs can briefly break Vite and the API, so restart the API by touching `index.ts` if it dies.
- **Field order in responses:** `capabilities` is appended to rows, so existing consumers ignore it until they adopt it. Only the station and pin `can*` removals are breaking, and slice 4 handles them.
- **Agreement-test fixtures** use owner-created rows for the unreadable cases, never `SYSTEM_TEST`, which members can read. They reuse `seedTenancyFixture`.
- **Docs in sync:** CLAUDE.md and its mirror land in slice 8. The CLAUDE.md "Mutation Cache Invalidation" section gains a line about `onPermissionDenied` in slice 6.
- **PR:** open it as a draft against `epic/per-object-action-affordances` after slice 1. The epic's Status row for #688 updates as the PR opens and merges.

## Next step

Implementation starts on `feat/688-action-gates-foundation` once this plan is confirmed. Slice 1 comes first, tests first, with one commit per slice.
