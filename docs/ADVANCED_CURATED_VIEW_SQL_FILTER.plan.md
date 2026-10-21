# Advanced curated-view SQL filter — Plan

**This plan implements the advanced (SQL) row filter in TDD order:**
- the validator and splice proof
- storage and entitlement plumbing
- the role-bounded two-view session
- moving every curated-view read onto the reader session
- the write path with pinning
- the preview and suggest endpoints
- the editor's SQL mode
- docs

Spec: `docs/ADVANCED_CURATED_VIEW_SQL_FILTER.spec.md`. Discovery: `docs/ADVANCED_CURATED_VIEW_SQL_FILTER.discovery.md`. Issue: #644 (part of the Security & Enterprise Readiness epic #578, not an epic-branch child). Builds on shipped #599 (curated views), #802 (view-dependency lock), #660/#669 (the libpg-query fragment gate) and #649 (keyset view records).

The plan has eight slices. Each sits behind a green test suite and leaves the repo compilable. They land as **commits on `feat/644-advanced-curated-view-sql-filter` / PR #841**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly; see `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd packages/devops-cli && npm run test:unit
cd apps/web && npm run test:unit
```

Each slice runs the same loop:
1. Write failing tests.
2. Make the smallest change that greens them.
3. Run the focused tests (`--testPathPattern`).
4. Run `npm run lint && npm run type-check` at the boundary. A slice that touches `packages/core` also runs the root `npm run build`, because a new core field ripples into web and site fixtures.
5. Move to the next slice.

**Sequencing rationale.** Pure logic comes first, the security boundary before anything can write to it, and wiring last:

- **Slice 1** is the validator and render util: pure and riskiest. It answers discovery open question 1 (splice vs deparse) before anything depends on the answer.
- **Slice 2** is the columns, model and entitlement. They're inert: nothing reads or writes `filter_sql` yet, and no request body accepts it.
- **Slice 3** builds the two-view, role-bounded session for the agent and tile path. It's proven with SQL views inserted straight into the DB, so the role boundary is tested *without* the validator in front of it.
- **Slice 4** moves the records list and rows-by-column onto the reader session for **every** view. This carries the biggest regression risk, so it's isolated in its own commit for a clean revert.
- **Slice 5** opens the write path. Only now can a user store `filter_sql`, and every read path is already role-bounded. Pinning lands here too.
- **Slice 6** adds the preview and suggest endpoints, built on slice 5's dry-run.
- **Slice 7** is the web, which needs slices 5 and 6.
- **Slice 8** is docs.

One migration, in slice 2. No seed change: `portalops tier apply` converges the entitlement.

---

## Slice 1 — Validator, render and splice proof

This adds `validateViewFilterSql` and `renderViewFilterSql` as pure functions. Nothing calls them yet.

**Files**

- New: `apps/api/src/services/curated-view-filter-sql.util.ts`. It holds `validateViewFilterSql`, `renderViewFilterSql`, the three allow-lists, the identifier-extent scanner and the UTF-8 byte↔offset helpers.
- Edit: `apps/api/src/constants/api-codes.constants.ts`: add `CURATED_VIEW_INVALID_FILTER_SQL` and `CURATED_VIEW_FILTER_SQL_BROKEN`.
- New: `apps/api/src/__tests__/services/curated-view-filter-sql.util.test.ts`.

**Steps**

1. **Tests (spec: api unit, accept ≈16, reject ≈28, splice ≈8, audit 1).**
   - Every reject case asserts `CURATED_VIEW_INVALID_FILTER_SQL` and names the construct.
   - The splice cases cover multibyte UTF-8 before a ref, a key that prefixes another key, a quoted `"key"`, and refs inside JSON operators, PostGIS calls and next to comments. Each asserts the output re-parses to only `w.<col>` refs.
   - The audit test checks that the allow-lists don't intersect the pinned list of privileged and relation-taking functions.

   Run; fail.
2. **Implement validation:**
   - `parsePortalSqlExpression(sql, "where")`, with `PORTAL_SQL_FORBIDDEN` re-thrown as the new code;
   - the node-kind, `FuncCall`, `A_Expr`, `TypeCast` and `ColumnRef` walk over the fragment subtree;
   - the node count;
   - byte-range extraction (`location` minus the UTF-8 byte length of the wrapper prefix).

   Green the accept and reject cases.
3. **Implement `renderViewFilterSql`:** re-validate, splice right-to-left on a `Buffer`, re-parse, then assert the refs are `w.<known col>`. Add the bounded LRU, keyed by the caller-supplied cache key. Green the splice cases.
4. **Decision gate (discovery open question 1).**
   - If every splice case holds, record "splice proven" in the commit body.
   - If any can't (e.g. a ref location libpg-query doesn't report), switch the render to the parser's deparse, with only the column refs rewritten in the AST. Re-run the same matrix and record the switch.
5. Lint and type-check.

**Done when:** all ≈53 cases pass and the decision gate is recorded. Nothing imports the util yet.

**Risk:** `ColumnRef.location` semantics, i.e. whether it's a byte offset and where it points for a quoted identifier. The splice matrix exists to pin these down. Hand-check a 4-byte emoji case.

---

## Slice 2 — Storage, model and entitlement plumbing

This adds the columns, the model fields and the `advancedViewFilters` entitlement end to end. Everything is still inert.

**Files**

- Edit: `apps/api/src/db/schema/curated-views.table.ts`: add `filterSql`, `filterSqlKeys` and the `curated_views_filter_mode_exclusive` check.
- Edit: `apps/api/src/db/schema/tiers.table.ts`: add `advancedViewFilters`.
- Edit: `apps/api/src/db/schema/zod.ts`, `type-checks.ts`.
- New: `apps/api/drizzle/<n>_add-curated-view-filter-sql-and-tier-entitlement.sql`, plus `meta/_journal.json` and the snapshot, generated with `npm run db:generate -- --name add-curated-view-filter-sql-and-tier-entitlement`.
- Edit: `packages/core/src/models/curated-view.model.ts`: add `filterSql` and `filterSqlKeys`.
- Edit: `packages/core/src/models/tier.model.ts`: add `advancedViewFilters` to `TierEntitlementsSchema`.
- Edit: `packages/core/src/registries/tier-catalog.ts`: set it on all four tiers (pro and enterprise `true`).
- Edit: `apps/api/src/services/tier.service.ts`, `entitlement.service.ts`: add the mapping and `advancedViewFiltersEntitled`.
- Edit: `packages/devops-cli/src/commands/tier.ts`, `tables.ts`: add `CONVERGED_POLICY_FIELDS` and the mirror column.
- Edit: every curated-view creation site and fixture, which now set `filterSqlKeys: []` (found by type-check and a grep for `curatedViews.create` / `CuratedViewModelFactory`).

**Steps**

1. **Tests.** Write these and confirm they fail:
   - core `tier-catalog.test.ts`: pro and enterprise true, standard and plus false;
   - devops-cli: the tables parity test and the `tier apply` converge-diff case for `advancedViewFilters`;
   - api: `EntitlementService.advancedViewFiltersEntitled` for an entitled and an unentitled org (extend the existing entitlement test);
   - api integration: a DB insert with both `filter` and `filter_sql` set violates the `CHECK`.
2. **Implement** the columns, migration, model, catalog and plumbing. Run `npm run db:migrate` locally. Green.
3. Root `npm run build`, then lint and type-check.

**Done when:** these tests pass, the migration applies on a fresh DB, and the full build is green. No route accepts `filterSql`.

**Risk:** the required `filterSqlKeys` breaks a creation path the type checker misses (`model.parse()` runs in memory; see `project_required_model_field_breaks_create_path`). Grep every creation site and run the curated-view integration suites.

---

## Slice 3 — Role-bounded two-view session (agent and tile path)

`buildViewsForSession` learns the SQL-view shape, and `renderViewFilterWhere` learns to dispatch to it.

**Files**

- Edit: `apps/api/src/services/portal-sql.service.ts`:
  - `renderViewFilterWhere` dispatches on `filterSql`, calling `renderViewFilterSql` with the `(view.id, view.updated)` cache key;
  - `buildViewsForSession` emits the `__src_<n>` plus `security_invoker` pair, with a per-view `SAVEPOINT` degrade to `WHERE FALSE` and a log line;
  - FilterGroup views keep their DDL.
- Edit: `apps/api/src/services/portal-sql-reader-role.service.ts`: add `enter(tx, viewNames, columnGrants?)`.
- New: `apps/api/src/__tests__/__integration__/services/portal-sql-view-session.integration.test.ts`, covering the session half of the spec's security suite.

**Steps**

1. **Integration tests.** SQL views are inserted **directly** into `curated_views`, with no route, so the role is tested alone. Cover:
   - spatial `ST_DWithin` and JSON-path views return exactly the matching rows through `runSqlQuery`;
   - another org's rows never appear;
   - a fragment naming `organizations` or another `er__` table fails at the **role**, and that view degrades to zero rows while the session's other views still answer;
   - agent SQL selecting `__src_<n>` is refused;
   - a column-type change on a referenced column degrades only that view;
   - `resolveScopeHash` changes when `filter_sql` changes.

   Run; fail.
2. **Implement** the pair DDL, the column grants and the savepoint isolation. Green.
3. Run the existing portal-sql, map-tile and dissolve integration suites unchanged (regression), then lint and type-check.

**Done when:** the session tests pass and the existing portal-sql, tile and dissolve suites are still green.

**Risk:** `GRANT SELECT (cols)` on a temp view inside the transaction, combined with `security_invoker`, behaving unexpectedly on RDS. The test proves it locally (Postgres 17), and the app-dev smoke re-proves it. Also, the savepoint must wrap **both** CREATEs, so a half-created pair never survives.

---

## Slice 4 — Records list and rows-by-column on the reader session (every view)

`queryCuratedViewRecords` and `queryViewRowsByColumn` stop reading `er__` as the API role.

**Files**

- Edit: `apps/api/src/services/portal-sql.service.ts`:
  - new private `buildSingleViewSession(view | draft, columns, org, { exposeCreated, client })`;
  - both queries run inside `assertUsable()` → transaction → `openSqlSession`, with the outer SQL retargeted to `"__view" w` (`_record_id`, `_created`, `_er_id`) and the count kept in the same session;
  - degraded SQL views answer `409 CURATED_VIEW_FILTER_SQL_BROKEN`.
- Extend: `portal-sql-view-session.integration.test.ts` (the records half of the security suite), plus the existing `curated-view.router.integration.test.ts` records cases, run unchanged as the regression proof.

**Steps**

1. **Tests:**
   - Records through an SQL view (inserted into the DB) return matching rows with the viewer's readable projection only.
   - A degraded view → 409. A reader-role outage → 503.
   - Rows-by-column against an SQL view.
   - The existing #649 and #678 records cases (keyset on `created`, column sort, reverse walk, search, `?filters`, the count cache) must pass **without edits**.

   Run; the new cases fail.
2. **Implement.** Green, old and new.
3. **Plan measurement.** Record it in the commit body; it is not a test, per #442. Run `EXPLAIN ANALYZE` of page one, a deep keyset seek and the last page by `created`, plus a column sort, against the largest local entity (≥ 400K rows, if one exists), before and after. Raise any regression past #649's recorded numbers with the user before moving on.
4. Lint and type-check.

**Done when:** every existing records test is green unmodified, the new cases pass, and the measurements are recorded.

**Risk:** the highest-risk slice in the plan, which is why it's a single, separately revertible commit. Before this slice, FilterGroup views are correct on the API role, so reverting it is safe on its own *until* slice 5 lets users store `filter_sql`.

---

## Slice 5 — Write path, dry-run, masking and pinning

Users can now store `filter_sql`.

**Files**

- Edit: `packages/core/src/contracts/curated-view.contract.ts`: add `FILTER_SQL_MAX_LENGTH`, `filterSqlField`, `filterSql` on the create and update bodies, and the both-set `.superRefine`.
- Edit: `packages/core/src/contracts/filter.contract.ts`: add `collectViewFilterFields`.
- New: `apps/api/src/services/curated-view-filter-sql.service.ts`: `validateAndDryRun` only, mapping a pg error to `400` with its position.
- Edit: `apps/api/src/routes/curated-view.router.ts`. Create and PATCH run: lock → permission → entity read when changed → entitlement → `validateAndDryRun` → write with the mode switch. Update the `@openapi` request schemas.
- Edit: `apps/api/src/constants/api-codes.constants.ts`: add `CURATED_VIEW_FILTER_SQL_NOT_ENTITLED`.
- Edit: `apps/api/src/services/curated-view-payload.service.ts`: `scopeRow` masks `filterSql` and `filterSqlKeys`.
- Edit: `apps/api/src/services/curated-view-dependency.service.ts:121`: use `collectViewFilterFields`.
- Edit: `apps/api/src/config/swagger.config.ts`.

**Steps**

1. **Tests:**
   - core: the contract cases (≈10) and the `collectViewFilterFields` cases (3);
   - api unit: the dependency-service SQL pinning cases (3);
   - api integration, `curated-view.router` (≈12): entitled create, not entitled → 403, invalid → 400 with position, non-boolean → 400 from the dry-run, both set → 400, switching to the builder clears SQL, an unchanged resend on a downgraded org → 200, entity read required, the mask for a non-writer;
   - api integration, `field-mapping.router`: delete and rename of a referenced column → 409 (2).

   Run; fail.
2. **Implement.** Green.
3. Root `npm run build`, then lint and type-check.

**Done when:** the ≈30 cases pass, and an SQL view round-trips create → records → agent session.

**Risk:** the entitlement check has to sit on the **changed** comparison, or a downgraded org couldn't rename its view. The unchanged-resend test is the proof.

---

## Slice 6 — Preview and suggest endpoints

**Files**

- Edit: `apps/api/src/services/curated-view-filter-sql.service.ts`: add `preview` (25 rows, `hasMore`, no count) and `suggest` (validate and dry-run, one retry with feedback, `warning`).
- New: `apps/api/src/services/curated-view-filter-suggest.haiku.ts`: `getFilterSqlSuggester` and `__setFilterSqlSuggesterForTesting`, on Haiku 4.5 through `AiService`. The prompt carries keys, types and top-level JSON key names from up to 20 rows (no values), plus the hint to prefer indexable `ST_DWithin` on `geometry`.
- Edit: `apps/api/src/routes/curated-view.router.ts`: add `POST /filter-sql/preview` and `/filter-sql/suggest`, declared before `/:id/attach`, with `@openapi`.
- Edit: `packages/core/src/contracts/curated-view.contract.ts`: add the preview and suggest request and response schemas.
- Edit: `apps/api/src/constants/api-codes.constants.ts`: add `CURATED_VIEW_FILTER_SUGGEST_FAILED`.
- Edit: `apps/api/src/__tests__/config/route-authorization.map.ts`: classify both routes with `locks: none`.
- Edit: `apps/api/src/config/swagger.config.ts`.
- New: `apps/api/src/__tests__/__integration__/routes/curated-view-filter-sql.integration.test.ts`.
- New: `apps/api/src/__tests__/services/curated-view-filter-suggest.haiku.test.ts`.

**Steps**

1. **Tests:**
   - suggester unit (3): prompt contents, no row values, model id wiring;
   - integration (≈10): preview rows, `hasMore` and the empty case; the create-vs-write authorization split; another org's entity → 404; entitlement → 403; statement timeout; suggest success with the mocked suggester; retry after a validator failure; 502.
   - The route-map guard and `strict-request-bodies` pick up the new routes and schemas.

   Run; fail.
2. **Implement.** Green.
3. Lint and type-check.

**Done when:** these cases pass and the guards are green.

**Risk:** the JSON key-name sample is the only new egress. Assert in the unit test that no value ever reaches the prompt builder.

---

## Slice 7 — Web: Builder | SQL mode

**Files**

- Edit: `apps/web/src/api/curated-views.api.ts`: `previewFilterSql` and `suggestFilterSql`, both `LONG_WRITE_TIMEOUT_MS`; `filterSql` in the create and update bodies.
- New: `apps/web/src/components/FilterSqlEditor.component.tsx` (pure UI).
- New: `apps/web/src/components/FilterSqlPreview.component.tsx` (pure UI).
- Edit: `apps/web/src/components/CuratedViewEditorDialog.component.tsx`:
  - the mode toggle with an upsell gate, read-only mode on a downgraded org, and per-mode local state;
  - save sends the active mode only, with `validateWithSchema` and `focusFirstInvalidField`;
  - the container wires the two mutations, resets them on open and close (R4), and auto-previews after a successful suggest.
- New: `apps/web/src/stories/FilterSqlEditor.component.stories.tsx`, `FilterSqlPreview.component.stories.tsx`.
- New: `apps/web/src/__tests__/FilterSqlEditor.test.tsx`, `FilterSqlPreview.test.tsx`.
- Edit: `apps/web/src/__tests__/CuratedViewEditorDialog.test.tsx`.

**Steps**

1. **Tests (spec web: ≈8 + 5 + 9):**
   - the editor and preview states;
   - the dialog: mode toggle, upsell, active-mode-only save, Enter via `pressEnter`, can't close while pending, `FormAlert` plus reset on reopen, read-only on a downgraded org.

   The dialog and action-gate guards (R1–R5, `action-gate.guard`, `effect-mutation.guard`) must stay green. Run; fail.
2. **Implement.** Green.
3. Lint and type-check. Check the stories in Storybook.

**Done when:** these cases and all web guard tests pass.

**Risk:** the auto-preview after suggest must be called from the success handler through `mutateAsync`, not from an effect. If it does end up in an effect, the #783 rule applies.

---

## Slice 8 — Docs

**Files**

- Edit: `packages/core/src/content/glossary.util.ts`: an "Advanced filter" entry. Check `apps/web/src/utils/glossary-routes.util.ts` to see whether the entry needs a route.
- Edit: `packages/core/src/content/faq.util.ts`: "When should I use a SQL filter instead of the builder?"
- Edit: `docs/DEPLOYMENT_SECURITY_REVIEW.md` §1 egress: the suggester's data class.

**Steps**

1. **Tests.** Update `glossary.util.test.ts` and `faq.util.test.ts` for the new entries. Run; fail.
2. **Write the copy** in permission framing ("Needs write on the view and a plan that includes advanced filters"). It must pass `permission-copy.guard`. Green.
3. Run `npm run lint:doc-pointers`, then lint and type-check.

**Done when:** the doc tests and guards pass.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | Validator, render, splice proof | ≈53 unit cases; splice-vs-deparse recorded |
| 2 | Columns, model, entitlement | catalog, parity and CHECK tests; full build |
| 3 | Two-view role-bounded session | session security suite; tile/dissolve regression |
| 4 | Records and rows-by-column on reader session | existing records suite unmodified; EXPLAIN recorded |
| 5 | Write path, dry-run, masking, pinning | ≈30 contract, router and field-mapping cases |
| 6 | Preview and suggest | ≈13 cases; route-map and strict-body guards |
| 7 | Web SQL mode | ≈22 cases; dialog and gate guards |
| 8 | Glossary, FAQ, security review | doc tests and pointer lint |

## Cross-slice notes

- **The migration is in slice 2 only.** Commit the `.sql`, journal and snapshot together (`project_drizzle_journal_must_be_committed`). After pulling, run `npm run db:migrate` locally, since `npm run dev` only seeds.
- **Rebuild core** after slices 2, 5 and 6. The API dev server keeps a stale core until an API source file is touched (`project_api_dev_server_stale_core`).
- **Rollback hazard.** From slice 5 on, a revert of *code only* would widen SQL views to all rows, because old code renders `filter` (null). The PR body carries the pre-revert `UPDATE`, per the spec's Risks section.
- **The tests that close the issue's acceptance criteria** live in slices 3–5. The view/org-scoped criterion is slice 3 plus slice 4, and authoring-time rejection is slice 5.
- **Pinning (slice 5)** can be tested from slice 2 on, using DB-inserted views. It's kept in slice 5 so the first commit where users can store SQL is also the first one where its columns are protected.
- **Rollout** runs `portalops tier apply --env app-dev` (and later prod) after merge to converge `advancedViewFilters`. The smoke doc (`/smoke`) carries it.
- **Review chain.** This is a full feature touching data access and multi-tenancy, so code-review, security, smoke and adversarial are all required. The adversarial pass targets slice 1's validator and slice 3's role boundary.

## Next step

Implementation starts on this branch once discovery, spec and plan are confirmed: slice 1 first, tests first, one commit per slice.
