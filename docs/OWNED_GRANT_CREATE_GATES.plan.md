# Create gates that agree with the create routes — Plan

**This plan implements a server-computed `create` on `resourcePermissions[type]` from a per-type create-rule table, and moves every web create gate onto it, in TDD order.**

- **Spec:** `docs/OWNED_GRANT_CREATE_GATES.spec.md`. **Discovery:** `docs/OWNED_GRANT_CREATE_GATES.discovery.md`.
- **Issue:** #708 (epic #684).
- **Builds on #689** (merged into the epic), which added the `DERIVED_CAPABILITIES` table this sits beside.
- **Related, out of scope:** #710 (connect-flow server gap).

There are 4 slices. Each sits behind a green test suite and leaves the repo compilable, and each lands as a **commit on `fix/708-owned-grant-create-gates`** (PR #709).

Run tests from each package; never invoke jest directly.

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice:
1. Write failing tests.
2. Make the smallest change that greens them.
3. Run them.
4. Run `npm run lint && npm run type-check` at the boundary. After slice 1 (a core contract change), run the **root** `npm run build`.
5. Move to the next slice.

**Sequencing rationale:**
- **Slice 1** pins the contract and the server rule. Everything reads it.
- **Slice 2** proves the rule against the real routes before any UI depends on it.
- **Slice 3** moves the gates, which needs `create` in the payload.
- **Slice 4** adds the guard, which would fail before slice 3, and the docs.
- #710 doesn't block any slice.

---

## Slice 1 — `create` in the contract, computed from `CREATE_RULES`

This slice adds `create` to `ResourcePermissionMapSchema`, and has the server compute it from the rule table with `set.can`. Nothing reads it yet.

**Files**

- **Edit:** `packages/core/src/models/permission.model.ts`: add `create: z.boolean()` to the `ResourcePermissionMapSchema` entry, with its doc comment (spec § Surface).
- **Edit:** `apps/api/src/services/permission.service.ts`: add `CreateRule`, `CREATE_RULES` (14 rows, each commented with its route) and `PermissionService.canCreate`. `permissionMaps` adds `create` per type.
- **New:** `apps/api/src/__tests__/services/permission-create.service.test.ts`: spec cases 3–9.
- **Edit tests:**
  - `packages/core/src/__tests__/models/permission.model.test.ts` (case 1);
  - `packages/core/src/__tests__/contracts/organization.contract.test.ts` (case 2);
  - `apps/api/src/__tests__/__integration__/services/permission-maps.integration.test.ts` (case 15).

**Steps**

1. **Tests (spec cases 1–9, 15).** Write the failing tests:
   - the schema requires `create`;
   - `canCreate` for the owner, the seeded member (`curated_view` false), custom owned-only, instance-only, `created_by_system`-only, a conditional deny, and the `none` types;
   - the exact-map expectations gain `create`.

   Run; they fail.
2. **Implement** the schema field, the table, `canCreate`, and the `permissionMaps` line. Green.
3. Rebuild core (`npm run build --workspace @portalai/core`) so api and web type-check against it. Then run the **root** `npm run build`, `npm run type-check` and `npm run lint`. Any web or site fixture typed as `ResourcePermissionMap` without `create` fails type-check here: add `create` to it in this slice (with the value the fixture's caller would really get), so the tree stays green.

**Done when:** cases 1–9 and 15 pass, the root build and type-check are green, and `GET /api/organization/current` returns `create` on every type. No web code reads it yet.

**Risk:** typed web fixtures. Step 3 absorbs them. Untyped fixtures read `create` as `undefined`, which slice 3 then makes explicit.

---

## Slice 2 — Agreement matrix against the real create routes

This slice proves each type's `create` matches its route for four kinds of caller. It's the test that catches a table row drifting from its route.

**Files**

- **New:** `apps/api/src/__tests__/__integration__/routes/create-capability.agreement.integration.test.ts`.

**Steps**

1. **Tests (spec cases 10–14).** Build the fixture:
   - owner and seeded member via `seedTenancyFixture`;
   - a custom group policy granting `write <type> created_by_caller` on the ten creatable types, inserted per the `permission-loadset.integration.test.ts:340-397` pattern;
   - instance-only grants on `connector_instance`, `pin` and `station`;
   - readable parents for the owned creates (a station for portal, a connector instance for entity, an entity plus a column definition for field mapping and record, a portal for pin).

   For each caller and type, write a minimal valid create body. Then:
   - read `GET /api/organization/current` → `resourcePermissions[type].create`;
   - call the create route;
   - assert `create` ⇔ "not 403".

   Case 14: the seeded member's curated-view create returns 403, and its `create` is false.
2. **Implement:** nothing. Slice 1 is the implementation. If a row disagrees, the **table** is wrong. Fix the row and its route comment, and record why in the commit.
3. Run `npm run test:integration -- --testPathPattern create-capability`, then lint and type-check.

**Done when:** the matrix (≈ 34 rows) and case 14 pass.

**Risks:**
- **Fixture cost.** Each type's minimal body and parents are the work of this slice.
- **Routes with side effects.** Toolpack register calls the webhook schema endpoint; use the integration harness's existing toolpack fixture or stub (`toolpacks.router.integration.test.ts`). The `customToolpacks` entitlement must be on, so that a 403 means permission and not the tier.

---

## Slice 3 — Web create gates read `create`

This slice adds `create` to `ResourceVerbs` and moves all eleven gate sites from `"write"` to `"create"`.

**Files**

- **Edit:** `apps/web/src/utils/use-capabilities.util.ts`: `ResourceVerbs` gains `create`.
- **Edit:** the 11 sites in spec § "Web create gates":
  - `Tags.view.tsx`, `ColumnDefinitionList.view.tsx`, `EntityGroups.view.tsx`, `Toolpacks.view.tsx`, `CuratedViews.view.tsx`, `Connector.view.tsx`, `Entities.view.tsx`, `ConnectorInstance.view.tsx`, `ColumnDefinitionDetail.view.tsx`, `EntityDetail.view.tsx`;
  - `components/PortalMessage.component.tsx`.
- **Edit:** the three doc comments: `connector-instance-actions.util.ts:12`, `entity-actions.util.ts:9`, `PortalMessage.component.tsx:108`.
- **Edit tests:**
  - `useCapabilities.test.tsx` (case 16);
  - `CuratedViewsView.test.tsx` (case 17);
  - the view and component tests in spec case 18: fixtures gain `create`, plus one `write: true, create: false` case each.

**Steps**

1. **Tests (spec cases 16–18).** Write the failing tests:
   - `canOnResource(type, "create")` and its fail-closed default;
   - a seeded-member fixture (`write: true, create: false`) where Create View is disabled, not enabled;
   - for each other gated surface, `write: true, create: false` hides or disables its Create.

   Run; they fail.
2. **Implement:** add the `ResourceVerbs` field, then change the eleven expressions and three comments. Green.
3. Run `npm run test:unit` (web) on the touched tests, then lint and type-check.

**Done when:** cases 16–18 pass, and no web create gate reads `"write"`.

**Risk:** existing tests whose fixtures set only `write: true` now see Create hidden. That is the intended behaviour change; update each fixture to `create: true` where the test is about the enabled path.

---

## Slice 4 — Guard and docs

This slice makes the convention stick: the guard rule, plus CLAUDE.md and its mirror.

**Files**

- **Edit:** `apps/web/src/__tests__/action-gate.guard.test.ts`: a new `describe`, "a create gate reads `create`, never `write`/`delete` (#708)".
- **Edit:** `CLAUDE.md` → "Action Affordances & Permissions (apps/web)", and `.github/copilot-instructions.md` (spec § Docs).

**Steps**

1. **Tests (spec case 19).** The guard rule:
   - strips comments, then flags any `canOnResource("<type>", "write"|"delete")` in non-test `apps/web/src` code;
   - a self-test asserts the matcher flags a fixture string and ignores the same string inside a comment.

   Before slice 3 it would fail. After slice 3 it passes, so write it and confirm it's green on the tree. Temporarily reverting one gate locally should make it fail; don't commit that.
2. **Implement** the docs, per spec § Docs.
3. Run the web unit tests on the guard, then root lint and type-check. Re-read the docs against what shipped (CLAUDE.md → "Keeping Documentation in Sync").

**Done when:** case 19 passes, and CLAUDE.md and its mirror state the `create` convention.

**Risk:** none beyond the guard's regex. The comment-stripping self-test covers it.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | `create` on the schema; `CREATE_RULES` + `canCreate` | cases 1–9, 15; root build + type-check |
| 2 | Agreement matrix over the real routes | cases 10–14 (integration) |
| 3 | `ResourceVerbs.create`; 11 gates → `"create"` | cases 16–18 |
| 4 | Guard rule; CLAUDE.md + mirror | case 19 |

## Cross-slice notes

- **Core contract change (slice 1):**
  - rebuild `@portalai/core` before api and web type-check;
  - run the root build, since a typed fixture in `apps/site` or `apps/web` can break;
  - never `--no-verify`, since CI's `format:check` runs.
- **Behaviour change visible in slice 3:** once the gates move, a seeded member loses the enabled Create View, so the smoke walk should open with that.
- **Docs:** CLAUDE.md and its mirror are the doc surfaces (slice 4). No help, glossary, FAQ or tool contract describes these gates.
- **The review chain:**
  - security review: required (this touches the authorization surface, even though it only exposes decisions);
  - smoke: the doc's acceptance criteria;
  - adversarial: likely waivable-with-reason, as #689 was, since the server stays the boundary and the matrix covers the misuse cases.
- **#710 is independent.** If it merges first, the Connect gate and the connect flows agree. If not, the gate is stricter than three flows until it does.

## Next step

Once discovery, spec and plan are confirmed, implementation begins on this branch: slice 1 first, tests first, one commit per slice.
