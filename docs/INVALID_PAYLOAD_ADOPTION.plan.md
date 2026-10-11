# Adopt `invalidPayload` across routers — Plan

**This plan implements #745 test-first. It adds a CI guard over hand-built schema-failure 400s, then strict contracts for the portal and pin PATCH routes. It converts every route-level schema failure to `invalidPayload` in three batches, makes the verified request bodies `.strict()`, and finishes with the OpenAPI and convention docs.**

Spec: `docs/INVALID_PAYLOAD_ADOPTION.spec.md`. Discovery: `docs/INVALID_PAYLOAD_ADOPTION.discovery.md`. Issue: #745. It builds on the `invalidPayload` and `describeFirstZodIssue` helpers shipped by #706 and #742 (`apps/api/src/utils/zod-issue.util.ts`) and on the `notFound400s` guard from #742/#743.

There are seven slices. Each sits behind a green test suite and leaves the repo compilable. They land as **commits on `chore/745-invalid-payload-adoption`**: one ticket, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package, never by invoking jest directly (`feedback_use_npm_test_scripts`), and only on the touched files (`--testPathPattern`):

```bash
cd packages/core && npm run test:unit -- --testPathPattern <pattern>
cd apps/api && npm run test:unit -- --testPathPattern <pattern>
cd apps/api && npm run test:integration -- --testPathPattern <pattern>
```

Each slice follows the same loop:

1. Write the failing tests.
2. Make the smallest change that greens them.
3. Run the focused tests.
4. Run `npm run lint && npm run type-check` in each touched package at the boundary.
5. Move to the next slice.

**Sequencing rationale.** The guard lands first, so every later slice is measured by it: each conversion batch deletes its own allowlist entries, and the guard proves the batch was complete.

- **Slice 1:** the guard and an allowlist seeded with today's offenders. No behaviour change.
- **Slice 2:** the portal and pin PATCH contracts and routes, the issue's headline bugs. These are hand-validated rather than `!x.success` branches, so they don't depend on the allowlist.
- **Slices 3–5:** router conversions in three batches grouped by domain, each small enough to review. The two new `ApiCode`s land in slice 4, where they're first used, so nothing depends on a later slice.
- **Slice 6:** strictness. It comes after the conversions so that an unrecognized key already produces the uniform 400 on every route when it lands, and its integration evidence reads the final shape.
- **Slice 7:** the OpenAPI `details` field and the convention docs.

There is no migration and no seed.

---

## Slice 1 — `schemaFailure400s` guard + seeded allowlist

This slice adds the CI rule. Every current offender is recorded in a shrink-only allowlist, so the slice is green with no route changes.

**Files**

- Edit: `apps/api/src/__tests__/invalid-request-code.guard.test.ts`:
  - export `schemaFailure400s(source)` with rules R1 and R2 (spec § Guard);
  - add `SCHEMA_FAILURE_ALLOWED: Array<{ file; code }>`;
  - add a `describe` block with a real-tree test, a stale-entry test and self-tests;
  - widen the file's header comment to cover #745.

**Steps**

1. **Tests (spec: guard self-tests).** Each of these snippet cases asserts the exact `{ code }` list:
   - a braced `if (!parsed.success) { return next(new ApiError(400, …)) }` is flagged;
   - the brace-less form is flagged;
   - a compound `!rt.success || typeof x !== "string"` is flagged;
   - a 4th-argument `{ issues: e.issues }` outside any branch is flagged (R2);
   - `invalidPayload(…)` inside the branch is **not** flagged;
   - `new ApiError(500, …)` in a `!x.success` branch is **not** flagged;
   - a semantic `if (!name) new ApiError(400, …)` is **not** flagged;
   - a nested block inside the failure branch is still flagged.

   Run them; they fail because the export is missing.
2. **Implement the visitor.**
   - Walk to each `NewExpression` named `ApiError` whose first argument is `400`.
   - Climb `parent`s to any enclosing `IfStatement` where the node is inside `thenStatement`.
   - Test that statement's `expression` for a `PrefixUnaryExpression(ExclamationToken)` over a `PropertyAccessExpression` whose name is `success`.
   - Separately, apply R2 by checking argument 3 for an `ObjectLiteralExpression` with an `issues` property.
3. **Seed the allowlist.** Run the real-tree test once and paste its offender list, grouped by file, into `SCHEMA_FAILURE_ALLOWED`. Cross-check it against the spec's conversion table. Any site the guard finds that the table missed is noted in the commit body, and its route goes into the matching batch below.
4. Run lint and type-check.

**Done when** the self-tests pass, the real-tree test is green against the seeded list, and the stale-entry test passes.

**Risk:** an R1 false positive on a non-request `safeParse`. The scan is limited to `routes/`, and the 500 exclusion covers the response self-checks. Anything else the guard reports gets looked at before it is seeded.

---

## Slice 2 — portal and pin PATCH contracts

This slice closes the two silent-drop bugs from the issue.

**Files**

- Edit: `packages/core/src/contracts/portal.contract.ts`: add `UpdatePortalBodySchema` and `UpdatePortalResultBodySchema` and their types (spec § New contracts).
- Edit: `packages/core/src/__tests__/contracts/portal.contract.test.ts`.
- Edit: `apps/api/src/routes/portal.router.ts:607–653` and `apps/api/src/routes/portal-results.router.ts:683–715`. Both switch to `safeParse` + `invalidPayload` before the access load, and save the trimmed name from `parsed.data`.
- Edit: `apps/api/src/__tests__/__integration__/routes/portal.router.integration.test.ts` (`:599`) and `portal-results.router.integration.test.ts` (`:971`).
- Edit: `apps/web/src/api/portal-results.api.ts` (delete `RenamePortalResultBody`, type `rename` with the core type) and `apps/web/src/api/portals.api.ts:55`, `:80`.

**Steps**

1. **Core tests (spec: the 17 `portal.contract` cases).** Run them; they fail.
2. **Implement both schemas.** Green. Then run `npm run build` in `packages/core` so the API and web pick up the new exports (`project_stale_core_dist_after_branch_switch`).
3. **Integration tests (spec: portal ≈ 6, pin ≈ 4).** Cover each of these:
   - `{lastOpened:"x"}` → 400, with `/lastOpened/` in `message` and `details.issues[0].path` equal to `["lastOpened"]`;
   - `{name:123,lastOpened:1}` → 400;
   - an unknown key → 400 `unrecognized_keys`;
   - a bad body on a missing id → still 400;
   - a valid rename stores the trimmed name;
   - pin `name:123` → 400 naming `name`;
   - pin unknown key → 400;
   - pin `" A "` is stored as `"A"`.

   Rewrite the two message assertions. Run them; they fail.
4. **Implement both routes.** Green.
5. **Update the web types.** Run `type-check` in `apps/web`. Then run lint and type-check in core, api and web.

**Done when** all core and integration cases pass and web type-checks.

**Risk:** none. Both web callers already send exactly these shapes.

---

## Slice 3 — conversions, batch A: organization and RBAC

This batch covers `organization`, `group`, `policy`, `role`, `grant` and `billing`: 17 sites, including the split of the compound grant check.

**Files**

- Edit: `apps/api/src/routes/{organization,group,policy,role,grant,billing}.router.ts`, using the labels from the spec's conversion table.
- Edit: the six matching `apps/api/src/__tests__/__integration__/routes/*.router.integration.test.ts` files.
- Edit: `apps/api/src/__tests__/invalid-request-code.guard.test.ts`: delete these routers' allowlist entries.

**Steps**

1. **Tests.** Add one case per router. Each sends a malformed body (organization gets one per distinct schema it uses, such as invite with `role: "owner"` and switch with no `organizationId`) and asserts:
   - 400 with the existing code;
   - `message` contains the failing path;
   - `details.issues` is non-empty.

   For grant, add two cases: a bad `resourceType` → issues present; a valid type with no `resourceId` → the hand-written message and no `details`. Delete the allowlist entries too, so the guard goes red. Run everything; it fails.
2. **Implement the conversions.** At `grant.router.ts:150–154`, split the condition into two `if`s. Green, including the guard.
3. Run lint and type-check.

**Done when** the batch's integration cases and the guard are green, and no allowlist entry names these files.

---

## Slice 4 — conversions, batch B: entity domain and the two new codes

This batch covers `curated-view`, `entity-record`, `entity-group`, `entity-group-member`, `entity-tag`, `entity-tag-assignment`, `field-mapping`, `column-definition` and `connector-entity`, including their query sites (curated-view `:1061`, entity-record `:223`, entity-group `:974`, entity-group-member `:770`).

**Files**

- Edit: `apps/api/src/constants/api-codes.constants.ts`: add `ENTITY_TAG_ASSIGNMENT_INVALID_PAYLOAD` and `ENTITY_GROUP_MEMBER_INVALID_PAYLOAD`.
- Edit: the nine routers and their integration tests.
- Edit: the guard allowlist.

**Steps**

1. **Tests.** Add one case per router, plus one per query site, asserting the same three properties as batch A. The `entity-group-member` and `entity-tag-assignment` cases assert the **new** codes. Delete the allowlist entries. Run everything; it fails.
2. **Implement.** Add the codes, then convert the sites. The semantic 400s stay as they are: curated-view `:117`, `:188`, `:195`, `:534` and entity-record `:1285`. Green.
3. Run lint and type-check.

**Done when** the batch and the guard are green.

**Risk:** an existing integration test that asserted `ENTITY_GROUP_MEMBER_CREATE_FAILED` on a 400. The survey found none, but if one turns up it is updated in this slice.

---

## Slice 5 — conversions, batch C: connectors, layout plans, uploads and toolpacks

This batch covers `connector-instance` (`:741`, `:1588`, and the probe sites `:973`, `:1069`, `:1175`), `api-endpoints` (`.parse` in try/catch → `safeParse`), `layout-plans`, `connector-instance-layout-plans`, `file-uploads` (including the `:315` query) and `toolpacks`. **It empties the allowlist.**

**Files**

- Edit: the six routers and their integration tests.
- Edit: the guard. `SCHEMA_FAILURE_ALLOWED` becomes `[]`, with a comment saying it only shrinks. Its stale-entry test stays, trivially green.

**Steps**

1. **Tests.** Add one case per router asserting the three properties. For the sites that already carried `{ issues }`, the new assertion is the field path in `message`. For `api-endpoints`, a non-object body asserts a clean first-issue message rather than a Zod JSON dump. Empty the allowlist. Run everything; it fails.
2. **Implement.** Green.
3. Run lint and type-check.

**Done when** the allowlist is empty and the whole guard file is green. From here on, every schema failure in `routes/` goes through `invalidPayload`.

---

## Slice 6 — `.strict()` on the verified request bodies

This slice applies spec § Strictness: 43 schemas across 20 core contract files plus the router-local `PatchApiEndpointRequestBodySchema`.

**Files**

- Edit: the 20 contract files listed in the spec. Put `.strict()` on the inner `z.object`, before any `.refine`, with a `// #745:` comment.
- Edit: `apps/api/src/routes/api-endpoints.router.ts:58`.
- New: `packages/core/src/__tests__/contracts/strict-request-bodies.test.ts`.
- Edit: `apps/api/src/__tests__/tools/rbac/rbac-tools.test.ts`.

**Steps**

1. **Core tests (spec: ≈ 45 cases).** Add a table of `[name, schema, minimalValidBody]`. Each entry asserts two things: the minimal body passes, and the minimal body plus `{ __extra: 1 }` fails with one `unrecognized_keys` issue at path `[]`. One more case shows that `InterpretRequestBodySchema` still strips unknown keys. Run; they fail.
2. **Implement** across the contract files. Green. Rebuild core.
3. **Tool tests (spec: ≈ 4 cases).** The policy, role, group and grant tool inputs each reject an extra key, and the update variant (`.extend({ id })`) rejects one as well. These are green from step 2. If any is red, the tool builds its input differently from what the spec assumed: stop and revisit spec Key decision 5.
4. **Regression sweep.**
   - Run the existing web unit tests for the pre-validating forms (CuratedViewEditorDialog, EntityGroups, EditEntityGroupDialog, InviteMemberDialog, RegisterToolpackDialog, EditToolpackDialog, SandboxConnectorWorkflow).
   - Run the api integration suites for the routers whose schemas changed.
   - Any fixture that sends an extra key is a test bug: fix the fixture, not the schema.
5. Run lint and type-check in core, api and web, **plus a root `npm run build`**. A core contract change ripples into typed fixtures in web and site (`feedback_core_model_change_run_full_build`).

**Done when** the strict-bodies table, the tool tests and the regression suites are green, and the root build passes.

**Risk:** this is the widest slice by file count, but each edit is one line. The real risk is an integration fixture or a web call that sends an extra key the survey missed. Step 4 exists to surface it here rather than in CI.

---

## Slice 7 — OpenAPI `details` + convention docs

**Files**

- Edit: `apps/api/src/config/swagger.config.ts:733`: add an optional `details` to `ApiErrorResponse` (spec § OpenAPI).
- Edit: `apps/api/src/utils/zod-issue.util.ts`: widen the doc comment to cover body or query, and add the label convention.
- Edit: `CLAUDE.md`, API Style Guide → **Error handling** (`:450`). Add one sentence: a request that fails its schema answers `invalidPayload(code, label, parsed.error)`, request bodies are `.strict()` contracts, and `invalid-request-code.guard.test.ts` fails CI on a hand-built schema-failure 400. Mirror it in `.github/copilot-instructions.md`.

**Steps**

1. **Test.** If one exists, extend the swagger spec test (the `/api/docs/spec` shape test) to assert that `ApiErrorResponse.properties.details` is present. Otherwise rely on `type-check` plus a manual look at Swagger UI during smoke.
2. **Implement.** Then run lint, type-check and the root build.

**Done when** the spec document carries `details` and both convention docs describe the rule the guard enforces.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | Guard + seeded allowlist | guard self-tests + real tree |
| 2 | Portal/pin PATCH contracts, routes, web types | core contract tests + 2 integration suites + web type-check |
| 3 | Batch A: org/RBAC/billing (17 sites) | 6 integration suites + guard |
| 4 | Batch B: entity domain + 2 codes | 9 integration suites + guard |
| 5 | Batch C: connectors/layout/uploads/toolpacks; allowlist empty | 6 integration suites + guard |
| 6 | `.strict()` on 44 schemas | strict-bodies table + tool tests + regression sweep + root build |
| 7 | OpenAPI `details`, doc comment, CLAUDE.md + mirror | type-check + root build |

## Cross-slice notes

- **Core dist.** Slices 2 and 6 change `packages/core`. Rebuild core before running api or web tests against it, or you'll see phantom type errors in files you didn't touch.
- **The allowlist only shrinks.** No slice after 1 adds an entry. A site discovered late is converted in the batch it belongs to.
- **Line numbers drift.** The spec cites `808ff64e`. Once a batch edits a router, its later sites move. The guard is the inventory; the line numbers are not.
- **Doc sync.** This is not a user-facing capability, so the glossary, FAQ, Help, tool descriptions and system prompt are untouched. The rbac tool *descriptions* don't mention extra keys either. The developer-facing convention lands in slice 7.
- **Smoke and adversarial** run after slice 7: `/smoke 745`, then `/adversarial-review 745`. Natural adversarial targets are oversized `details.issues` (deeply nested bodies), prototype-pollution keys (`__proto__`) against strict schemas, and query versus body confusion.

## Next step

Once discovery, spec and plan are confirmed, implementation starts on this branch with slice 1, tests first, one commit per slice.
