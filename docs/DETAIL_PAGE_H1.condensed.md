# Detail pages keep their h1 when not found — Condensed design (#982)

**Issue:** [EnterpriseBT/portal-ai#982](https://github.com/EnterpriseBT/portal-ai/issues/982) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic #791; branches from and merges into `epic/a11y-conformance`.

**Why.** #797 requires every page to render exactly one `h1`, so a screen reader can land on it and `useRouteAnnouncer` can title the tab and focus it. A detail page whose header waits on data passes `pageTitle` to `DataResult`, which keeps a hidden `h1` while loading or failing. Three detail views skip this, so their loading and not-found states have no `h1`. #793's adversarial walk found this on an entity group deleted in another tab. Only `apps/web` is touched.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `DataResult`'s `pageTitle` | `apps/web/src/components/DataResult.component.tsx:36` | Renders a `visuallyHidden` `<Box component="h1">` before the loading/error status (`withTitle`, :51) |
| Entity group | `apps/web/src/views/EntityGroupDetail.view.tsx:560` | `<DataResult results={{ group }}>` with **no** `pageTitle` |
| Pinned result | `apps/web/src/views/PinnedResultDetail.view.tsx:377` | `<DataResult results={{ result }}>` with **no** `pageTitle` |
| Curated view | `apps/web/src/views/CuratedViewDetail.view.tsx:271` | No `DataResult`. With no fresh view, it renders `PageEmptyState "View not found"` (:275), whose title is an `h6` (core `PageEmptyState.tsx:50`), or else `return null` (:282) while loading. **No `h1` in either.** The issue's table missed this one |
| The other detail views | Station, Entity, EntityRecord, ColumnDefinition, ConnectorInstance, Job, Portal | Already pass `pageTitle` |
| Why the audit didn't catch it | `packages/e2e/src/lib/a11y-routes.ts` (`entity-group-detail`, `portal-result-detail`, `view-detail`) | The axe walk runs `best-practice` (`page-has-heading-one`) on these routes' populated, error and loading states, but all 9 runs are **skipped**: the e2e fixture has no group, pinned result or curated view to drill into |

## Decision — one hidden-heading component, used by every not-yet-loaded page

- **A. Pass `pageTitle` to the two `DataResult`s, and inline a hidden `h1` in CuratedViewDetail's two early returns.** It's smallest, but it copies `DataResult`'s markup into a view.
- **B. Rewrite CuratedViewDetail onto `DataResult`.** `DataResult` shows a refetch error over cached data, as `freshData` does (#713), but it renders a `StatusMessage`. That would replace the "View not found" empty state's copy and icon, which is a UI change this bug doesn't need.
- **C (chosen). Extract `HiddenPageHeading`** into core (`packages/core/src/ui/HiddenPageHeading.tsx`, pure UI: `{ children }` → a `visuallyHidden` `h1`), so its hiding recipe isn't an ad hoc `sx` in `apps/web`. `DataResult`'s `withTitle` renders it, the two views pass `pageTitle`, CuratedViewDetail renders it in both early returns, and `LoadingView` uses it for its own hidden `h1`. The hidden-`h1` markup then lives in one place, and the empty state keeps its look.
- **Review fix: a paused query is loading.** React Query v5's `isLoading` is `isPending && isFetching`, so a query paused offline has no data yet isn't "loading". `DataResult` used to skip it and call `children` with `undefined` data: no `h1`, or a crash. It now waits on any entry that isn't successful and has no data.

The titles follow the other detail views, naming the kind of page: **"Entity group"**, **"Pinned result"**, **"View"**. The tab reads "View · Portals AI" until the data loads and `PageHeader`'s visible `h1` replaces it.

**No source guard.** A rule like "a view's first `DataResult` passes `pageTitle`" can't see CuratedViewDetail's shape, which is the case the issue missed. The durable check is axe's `page-has-heading-one` on these routes' error and loading states, which #799 will gate. That needs the fixture coverage under Out of scope.

## Plan — 1 slice

**Files**
- New: `packages/core/src/ui/HiddenPageHeading.tsx` (exported from `@portalai/core/ui`) + `packages/core/src/__tests__/ui/HiddenPageHeading.test.tsx`
- Edit: `apps/web/src/components/DataResult.component.tsx` (`withTitle` renders `HiddenPageHeading`; a paused query counts as loading), `apps/web/src/views/Loading.view.tsx`
- Edit: `apps/web/src/views/EntityGroupDetail.view.tsx` (`pageTitle="Entity group"`), `apps/web/src/views/PinnedResultDetail.view.tsx` (`pageTitle="Pinned result"`), `apps/web/src/views/CuratedViewDetail.view.tsx` (`HiddenPageHeading` "View" in the not-found and loading returns)

**Tests** (failing first; `cd apps/web && npm run test:unit -- --testPathPattern …`)
- `__tests__/DataResult.test.tsx`: the existing `pageTitle` cases stay green (one hidden `h1` while loading and on error, none once loaded); a paused query renders the loading state with its `h1`; a successful query with `undefined` data still renders children.
- `__tests__/EntityGroupDetailView.test.tsx` and `__tests__/PinnedResultDetail.test.tsx`: the container with its get query erroring and then loading has exactly one `h1`, named "Entity group" / "Pinned result".
- `__tests__/CuratedViewDetail.container.test.tsx`: "View not found" has exactly one `h1` "View"; the loading state has one too.
- Then `npm run lint && npm run type-check && npm run format:check` in `apps/web`.

## Smoke (manual, against your dev stack)

1. As the e2e owner, create a group "Smoke 982 G" and open it. Delete it from a second tab, then refocus the first tab (or reload). The page reads "Entity group not found". The headings list has exactly one `h1` "Entity group", and the tab title is "Entity group · Portals AI".
2. Open `/entity-groups/00000000-0000-0000-0000-000000000000`. Same result: one `h1` "Entity group".
3. Open `/portal-results/00000000-0000-0000-0000-000000000000`. One `h1` "Pinned result", and the tab title follows it.
4. Open `/views/00000000-0000-0000-0000-000000000000`. "View not found" shows as before (icon, copy), and the page has one `h1` "View".
5. With DevTools on "Slow 3G", open an existing group, a pinned result and a view. While each loads, the page already has its one `h1`. Once loaded, the visible `PageHeader` title is the only `h1`.
6. Delete "Smoke 982 G" if step 1 didn't.

## Out of scope

- **Fixture coverage for the axe walk:** seeding a group, a pinned result and a curated view into `e2e-fixture`, so the 9 skipped runs execute and #799 can gate this. It belongs with #799 (the gates need every route audited) or the audit's "Skipped runs" list.
- `PageEmptyState`'s `h6` title (a heading-order row on empty states) is #794's.

## Adversarial

Probes for how the hidden `h1` and `DataResult`'s paused-query change break. Walk against your dev stack as the e2e owner (`/smoke-walk docs/DETAIL_PAGE_H1.condensed.md` walks the agent-walkable ones). Create "Adv 982 G" first; delete it after.

**§1 — State & lifecycle**
- [ ] Open `/entity-groups`, go offline (DevTools "Offline"), then click through to "Adv 982 G" (a client-side navigation, so the query starts paused) — the page shows "Loading..." with exactly one `h1` "Entity group". It is not blank and doesn't crash (no error boundary, no console `TypeError`). Back online, the group loads and its visible header is the only `h1`.
- [ ] With "Adv 982 G" open, delete it from a second tab, then refocus the first tab (no reload) — the refetch on focus gives "Entity group not found" with one `h1` "Entity group". The cached group name is in neither the page nor the tab title.
- [ ] Delay the group's GET (Slow 3G), open the group, then click to `/stations` before it loads — the final page's `h1` and tab title are "Stations". No hidden "Entity group" `h1` is left behind.

**§2 — Auth & tenant boundary**
- [ ] Open `/entity-groups/<id>`, `/views/<id>` and `/portal-results/<id>` with ids from **another org** (look them up with psql) — each renders exactly the not-found state the zero-id smoke steps show, one generic `h1`. The other org's object name appears nowhere: not in the page, the tab title or the console.

**§3 — Malformed input**
- [ ] `/entity-groups/not-a-uuid`, `/portal-results/%3Cscript%3Ealert(1)%3C%2Fscript%3E`, `/views/%00` — each renders an error or not-found state with exactly one `h1`. No script runs, nothing crashes, and the tab title doesn't echo the id.

**§4 — Misuse sequences**
- [ ] Go from the not-found group page to `/stations`, then to a station detail, and press Back twice and Forward twice — every page lands with exactly one `h1`, focus on it, and a tab title that matches it.

N/A: **boundary & limit inputs** (no new input or pagination), **concurrency** (read-only change with no new mutation; the deletion race is §1's probe 2).

### Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| §4 Back/Forward through `/stations` | `h1` and title correct, but focus lands on the toolbar's "Search..." input, not the `h1`: `PaginationToolbar`'s search has `autoFocus` (#649), taking focus from the route announcer on every paginated page | low | out of #982's scope (pre-existing, not on these pages); file under epic #791 |
