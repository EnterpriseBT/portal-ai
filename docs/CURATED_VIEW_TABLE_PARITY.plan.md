# Curated view table parity with the entity records table — Plan

**TDD-sequenced implementation: entity-table options, then the records contract and its one consumer together (columns, rows, sort), then the view-scoped ad-hoc filter, then the view page's filter builder and persistence.**

Spec: `docs/CURATED_VIEW_TABLE_PARITY.spec.md`. Discovery: `docs/CURATED_VIEW_TABLE_PARITY.discovery.md`. Issue: #678. Related: #680 (raw filter in the view payload) and #649 (keyset paging) stay out.

Four slices, each behind a green test suite and each leaving the repo compilable **and working**. They land as **commits on `fix/678-curated-view-column-labels`** (PR #679). One feature, one PR, per `CLAUDE.md` → "Phase = commit, not PR".

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration -- --testPathPattern "curated-view|portal-sql"
cd apps/web && npm run test:unit -- --testPathPattern "EntityRecordDataTable|CuratedViewDetail|EntityDetail"
```

Each slice:
1. write failing tests;
2. make the smallest change that greens them;
3. run the focused suites;
4. run `npm run lint && npm run type-check` (root; slice 2 also needs a root `npm run build`, since a core contract changes);
5. move to the next slice.

**Sequencing rationale:**
- **Slice 1** is a leaf. The table options are additive with defaults, so the entity page is untouched.
- **Slice 2** changes the records contract and its **only** consumer in one commit. `ResolvedColumn.key` is the column definition's key and rows move to `normalizedKey`, so a contract-only commit would type-check but render empty cells. Pairing them keeps the tree working.
- **Slice 3** adds the ad-hoc filter on the server. That's the security core, isolated in one reviewable commit with its own tests.
- **Slice 4** turns the builder on in the UI (it needs slices 2 and 3) and adds persistence, plus the doc check.

---

## Slice 1 — `EntityRecordDataTableUI` options

Three additive props so the curated view page can reuse the entity table without the parts a view doesn't have.

**Files**
- Edit `apps/web/src/components/EntityRecordDataTable.component.tsx`:
  - `source?` becomes optional (no chip when omitted);
  - `showValidity?: boolean` (default true; `toDataTableColumns(columns, { showValidity })` appends `VALID_COLUMN` only when true);
  - `columnConfigKey?: string` (default `column-config:entity-records:${connectorEntityId}`).
- Edit the `EntityRecordDataTable` story, if it needs the new controls.

**Steps**
1. **Tests (spec 17–19)**, in `apps/web/src/__tests__/EntityRecordDataTable.test.tsx`:
   - `showValidity={false}` drops the `isValid` column, and the default keeps it;
   - omitting `source` renders no Cached/Live chip;
   - `columnConfigKey` is the storage key used, and the default is unchanged.

   Run them; they fail.
2. **Implement.** Green. The existing `EntityDetailView` tests stay green, because the entity page passes `source` and nothing new.
3. Lint and type-check.

**Done when:** cases 17–19 pass, and the entity page behaves identically.

**Risk:** none. Additive props with defaults.

---

## Slice 2 — Records contract: `ResolvedColumn` columns, `normalizedKey` rows, sort rules (+ the view page renders them)

The records endpoint returns the readable projected columns as `ResolvedColumn` with `normalizedKey`-keyed rows. It refuses sorting non-sortable types. The view page renders the entity table over them.

**Files**
- Edit `packages/core/src/contracts/curated-view.contract.ts`:
  - `columns: z.array(ResolvedColumnSchema)`;
  - `records` documented as normalizedKey-keyed plus `_record_id` and `_source_id`;
  - remove `CuratedViewRecordColumnSchema` and its type, with no alias.
- New `packages/core/src/__tests__/contracts/curated-view.contract.test.ts`.
- Edit `apps/api/src/constants/api-codes.constants.ts`: `CURATED_VIEW_INVALID_SORT`.
- Edit `apps/api/src/services/portal-sql.service.ts` (`queryCuratedViewRecords`), spec Surface steps 2–3 and 6:
  - `readable` in projection order;
  - select aliases `w.<columnName> AS <normalizedKey>`, plus `_record_id` and `_source_id`;
  - `sortBy` by normalizedKey; a projected unsortable type gives 400 `CURATED_VIEW_INVALID_SORT`; an unprojected `sortBy` falls back.
- Edit `apps/api/src/routes/curated-view.router.ts`: `@openapi` columns `$ref ResolvedColumn` + the 400.
- Edit `apps/api/src/config/swagger.config.ts`: register `ResolvedColumn` (`z.toJSONSchema(ResolvedColumnSchema)`).
- Edit `apps/web/src/views/CuratedViewDetail.view.tsx`:
  - `CuratedViewDetailUIProps.columns: ResolvedColumn[]`;
  - render `EntityRecordDataTableUI` with `showValidity={false}`, no `source`, and `columnConfigKey="column-config:curated-view:${view.id}"` instead of the bare `DataTable`;
  - the sort handler passes normalizedKeys.

**Steps**
1. **Tests (spec 1–8, 20–22, 24):**
   - **core** (`curated-view.contract.test.ts`): cases 1–2;
   - **api integration** (`curated-view.router.integration.test.ts`): cases 3–8. Replace the pinning `Email`/`Age` header assertions with the normalizedKey/label/type shape and record why. Add the shared-column-definition case and the field-grant case;
   - **web** (`CuratedViewDetailView.test.tsx`): cases 20–22 and 24. Update the existing "renders the records table" fixture to `ResolvedColumn`s.

   Run them; they fail.
2. **Implement** core, then api, then web. Green.
3. Root `npm run build`, lint and type-check. A core contract changed, so any web/site typed fixture miss shows here (memory: core model change → full root build).

**Done when:** cases 1–8, 20–22 and 24 pass. The view page shows normalizedKey headers with captions, type-aware cells, a column picker limited to readable projected columns, and no validity column or chip.

**Risk:**
- **The contract shape change has one consumer** (the web view), and it changes in this commit.
- **The `_source_id` rename:** grep for `source_id` reads of view rows (none expected).

---

## Slice 3 — View-scoped ad-hoc filter (server)

`filters` is validated against only the readable projected columns, and ANDed after the view's own filter.

**Files**
- Edit `packages/core/src/contracts/curated-view.contract.ts`: request `filters: z.string().optional()`.
- Edit `apps/api/src/services/portal-sql.service.ts`, spec Surface steps 4–5:
  - `parseFilterPayload(opts.filters, readable)`; `renderFilterGroupToSql(expression, stmt, columnTypes)`;
  - any `FilterValidationError` gives `ApiError(400, CURATED_VIEW_INVALID_FILTER, message)`;
  - pushed after the view filter and before search; the count shares `whereSql`.
- Edit `apps/api/src/routes/curated-view.router.ts`: parse and pass `filters`; `@openapi` query param + the 400.

**Steps**
1. **Tests (spec 9–16):**
   - **api integration**:
     - 9: narrows rows and total;
     - 10: narrow-only against the view's own filter (an OR that would admit an excluded row);
     - 11: a column outside the projection gives 400;
     - 12: a projected column the caller can't read gives 400;
     - 13: malformed base64/JSON and a wrong operator give 400;
     - 14: an injection-shaped literal is escaped;
     - 15: filters + search + sort compose;
   - **portal-sql service integration**: 16, the shared escaping render;
   - **core**: the request accepts `filters` (extends case 1).

   Run them; they fail.
2. **Implement.** Green.
3. Lint and type-check.

**Done when:** cases 9–16 pass. A request without `filters` is byte-for-byte today's query.

**Risk:**
- **The security core.** `buildFilterSqlForEntity` resolves any entity column, so the restriction rests on validating against `readable`. Cases 11–12 must fail first against an implementation that passes `resolvedCols` instead; check that by temporarily passing the wider set.
- **The adversarial walk** extends these probes.

---

## Slice 4 — View page: filter builder + per-view persistence; doc check

The view page offers the advanced filter builder over its columns and remembers filters and column config per view.

**Files**
- Edit `apps/web/src/views/CuratedViewDetail.view.tsx` (container):
  - `useStorage<PaginationPersistedState>` under `pagination:curated-view:${viewId}`;
  - `usePagination({ sortFields: [], defaultSortBy: "created", defaultSortOrder: "asc", initialValue: cleaned, onPersist, columnDefinitions: columns })` (offset);
  - `columns` captured from the first successful response;
  - `advancedFilters` cleaned on load with `stripInvalidColumns` against them (as `EntityDetail.view.tsx:273-294`);
  - the toolbar's `filters` query param reaches `sdk.curatedViews.records`.
- Edit the `CuratedViewDetail` story, if present.

**Steps**
1. **Tests (spec 23 + persistence)**, in `CuratedViewDetailView.test.tsx`:
   - 23: the filter builder is offered over exactly the response's columns;
   - a persisted `advancedFilters` referencing a column no longer in `columns` is stripped on load;
   - the records query receives `filters` when a filter is applied.

   Run them; they fail.
2. **Implement.** Green.
3. **Doc check** (per `CLAUDE.md` → "Keeping Documentation in Sync"):
   - glossary "Curated View", the FAQ and getting-started have no copy about the view table today, so none is expected to change;
   - confirm, and record "checked, no change" (or the edit) in the commit;
   - `apps/web/README.md` has no per-view table notes.
4. Lint, type-check and the full web unit suite.

**Done when:** case 23 and the persistence cases pass. In the running app, a filter narrows the view, survives a reload, and drops cleanly when a column leaves the projection.

**Risk:** the `usePagination` offset reset on filter change. Confirm a new filter returns to page 1, as the sort handler does.

---

## Sequence summary

| # | Lands | Gating check |
|---|---|---|
| 1 | Entity table options (`showValidity`, optional `source`, `columnConfigKey`) | 17–19; entity page unchanged |
| 2 | `ResolvedColumn` columns + normalizedKey rows + sort refusal, and the view page renders the entity table | 1–8, 20–22, 24; root build |
| 3 | `filters`, scoped to readable projected columns, narrow-only | 9–16 (11–12 fail first against the wider set) |
| 4 | Filter builder + per-view persistence; doc check | 23 + persistence cases |

## Cross-slice notes

- **`ResolvedColumn.key` vs `normalizedKey`:** `key` is the column definition's key. Everything the table, sort, filters and rows use is `normalizedKey`, from slice 2 on.
- **Storage keys** are new (`*:curated-view:<id>`), so no migration of saved browser state is needed.
- **Review chain:** security review is **required** (the data-access path in slice 3), and the adversarial walk follows smoke (full ticket).
- **#680** may land before or after this. It touches the view GET/list, not the records endpoint, so no conflict is expected.

## Next step

Implementation starts on this branch with slice 1, tests first, one commit per slice, once discovery, spec and plan are confirmed.
