# Addressable Help sections — Plan

**TDD-sequenced implementation of the Help URL contract: the resolver quartet + `validateSearch`, a controlled `useTabs`, the shared `contentEntrySlug`, the prop-driven `HelpViewUI` + URL-writing container, controlled entry expansion + anchor scroll, and the repointed portal link.**

Spec: `docs/HELP_URL_ADDRESSABLE_SECTIONS.spec.md`. Discovery: `docs/HELP_URL_ADDRESSABLE_SECTIONS.discovery.md`. Issue: #365 (epic #364). No shipped dependency — this is the epic's first child; #367 consumes slices 1, 3, and 5.

Six slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/help-url-addressable-sections`**, PR base `epic/portal-guidance` — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — the URL *vocabulary* and the *primitives* are testable before anything user-visible moves:

- **Slice 1** — the resolvers + the route's `validateSearch`. Pure functions plus one route declaration; the view still ignores search, so no rendered behavior changes.
- **Slice 2** — `useTabs` controlled mode in `@portalai/core`. Additive; Help doesn't use it yet.
- **Slice 3** — `contentEntrySlug` promoted, both private slugifiers deleted. Pinned as output-identical, so no `data-testid` moves. **#367 can start against this.**
- **Slice 4** — the render path changes: `HelpViewUI` becomes prop-driven for tab + category, the container reads and writes the URL. First user-visible slice.
- **Slice 5** — the anchor: controlled expansion on both lists, `FAQEntryAccordion` extracted, scroll-to-entry, and the cross-tab jump rerouted through navigation.
- **Slice 6** — the repointed portal link + the convention doc-sync.

No migration, no seed, no API change (spec → *Migration / Seed*: none).

---

## Slice 1 — Resolvers + `validateSearch`

The URL vocabulary lands as pure functions, and `/help` starts declaring its search contract. Nothing reads the result yet.

**Files**

- Edit: `apps/web/src/utils/routes.util.ts` — `HelpTab`, `HELP_TAB_INDEX`, `HelpCategory`/`HelpSearch`/`HelpAnchor` types, `normalizeHelpSearch`, `helpTabIndexFromSearch`, `parseHelpAnchor`, `helpAnchorHash`.
- Edit: `apps/web/src/routes/help.tsx` — `validateSearch: (search) => normalizeHelpSearch(search)`.
- Edit: `apps/web/src/routeTree.gen.ts` — regenerated, never hand-formatted (CLAUDE.md excludes it from Prettier).
- Edit: `apps/web/src/__tests__/routes.util.test.ts` — cases 7–14.
- New: `apps/web/src/__tests__/HelpRoute.test.tsx` — case 15.

**Steps**

1. **Tests (spec cases 7–14).** `normalizeHelpSearch`: valid tab slugs pass through, unknown → `undefined`; category kept on a matching pair (`faq`+`analytics`, `glossary`+`data-modeling`), dropped on a mismatched pair with the tab surviving, dropped when tab is absent or Getting Started; array/object/number garbage → `undefined` with no throw. `helpTabIndexFromSearch`: each tab → its `HELP_TAB_INDEX` value, `{}` → `0`. `parseHelpAnchor`: accepts `#faq-entry-x` and `faq-entry-x`, rejects `#faq-x` / `#getting-started-entry-x` / `""` / `undefined`. `helpAnchorHash` round-trips. Run; fail.
2. **Test (spec case 15).** In `HelpRoute.test.tsx`, build a memory router registering the **real** `validateSearch` with a probe component that renders `JSON.stringify(useSearch())`; assert every row of the spec's URL grammar table resolves to the expected `{tab, category}`. (Pattern: `HttpErrorComponent.test.tsx:17-30` — `createRouter` + `createMemoryHistory` + `RouterContextProvider`, not `test-utils.tsx`.) Run; fail.
3. **Implement** the resolvers, then wire `validateSearch` on `routes/help.tsx`. Regenerate the route tree. Green.
4. Lint + type-check + `format:check`.

**Done when:** cases 7–15 pass; `/help?tab=faq&category=analytics` parses correctly at the router level while the rendered view is byte-identical to today (it doesn't read search yet).

**Risk:** the generated `routeTree.gen.ts` churns — commit it as-is. If TanStack resolves `/help`'s search against `help.index.tsx` rather than the layout route (spec → *Risks*, row 1), the probe test in step 2 fails immediately and the fix is moving the declaration one file over.

---

## Slice 2 — Controlled `useTabs`

`@portalai/core`'s tabs primitive gains an optional controlled mode. Additive; no consumer changes.

**Files**

- Edit: `packages/core/src/ui/Tabs.tsx` — `UseTabsOptions`, the widened `useTabs(initialValue, options?)`.
- Edit/new: `packages/core/src/__tests__/ui/Tabs.test.tsx` — cases 4–6.

**Steps**

1. **Tests (spec cases 4–6).** Uncontrolled (no options): `handleChange` and `setValue` both move `value` — the existing behavior, pinned. Controlled (`{value: 2, onChange}`): `value` and `tabsProps.value` are `2`; `handleChange` calls `onChange(1)` and leaves the rendered value at `2`; `setValue(1)` also routes to `onChange`. `getTabProps`/`getTabPanelProps` ids identical in both modes. Run; fail.
2. **Implement** — keep the `useState` unconditionally (no conditional hook); read from `options.value` when it is not `undefined`, and route `setValue`/`handleChange` to `options.onChange` in that mode. Green.
3. Lint + type-check; run the full `packages/core` unit suite plus `apps/web`'s Settings tests as the regression backstop.

**Done when:** cases 4–6 pass and every existing `useTabs` caller (notably `Settings.view.tsx:46`) is behaviorally unchanged.

**Risk:** low. The widening is additive; the omitted-`options` path is the current code path.

---

## Slice 3 — `contentEntrySlug` promoted to `@portalai/core/content`

One slug function replaces two private ones. Pinned as output-identical, so nothing user-visible moves.

**Files**

- Edit: `packages/core/src/content/glossary.util.ts` — export `contentEntrySlug` (the module stays import-free, per its header).
- Edit: `apps/web/src/components/GlossaryList.component.tsx` — delete `slugifyTerm` (`:77-78`), import `contentEntrySlug`.
- Edit: `apps/web/src/components/FAQList.component.tsx` — delete `slugifyQuestion` (`:23-27`), import `contentEntrySlug`.
- Edit/new: `packages/core/src/__tests__/content/glossary.util.test.ts` — cases 1–3.

**Steps**

1. **Tests (spec cases 1–3).** `contentEntrySlug` lowercases, collapses non-alphanumeric runs to one `-`, trims edge dashes. **Pinning:** every `GLOSSARY_ENTRIES` term produces the same slug the old whitespace-only rule produced (compute both in the test — the equivalence must be asserted, not assumed); every `FAQ_ENTRIES` question produces a non-empty slug, and all FAQ slugs are unique (a duplicate makes an anchor ambiguous). Run; fail.
2. **Implement** `contentEntrySlug`, then swap both components to it and delete the private copies — no aliases (`feedback_no_compat_aliases`). Green.
3. Run `GlossaryList.test.tsx` + `FAQList.test.tsx` untouched; every existing `data-testid` assertion (`GlossaryList.test.tsx:37-115`, `FAQList.test.tsx:32-35`) must still pass. Lint + type-check.

**Done when:** cases 1–3 pass, both list suites pass **unmodified**, and no `slugify*` remains in `apps/web/src/components/`.

**Risk:** a glossary term whose two slugs differ would break a `data-testid`. Verified today — all 38 terms are alphanumeric-plus-space — and step 1's pinning test is what keeps that true as #366 adds entries.

---

## Slice 4 — Prop-driven `HelpViewUI` + URL-writing container (tab + category)

The render path changes: the URL becomes the source of truth for tab and category. The anchor is slice 5.

**Files**

- Edit: `apps/web/src/views/Help.view.tsx` — `HelpViewUIProps` gains `tabIndex`, `glossaryCategory`, `faqCategory`, `onTabChange`, `onCategoryChange`; `useTabs` becomes controlled; the container reads `useSearch({strict: false})` and navigates.
- Edit: `apps/web/src/__tests__/HelpView.test.tsx` — cases 17–21, 27, 28–29.
- Edit: `apps/web/src/__tests__/HelpRoute.test.tsx` — case 16.

**Steps**

1. **Tests (spec cases 17–21, 27).** Prop-driven, no router: `tabIndex={2}` renders FAQ selected on first paint (no Getting Started flash); `faqCategory` renders its chip active and the list ungrouped; `glossaryCategory` likewise on the Glossary tab; a tab click calls `onTabChange` with the right `HelpTab` and does **not** move the tab by itself (controlled); a chip click calls `onCategoryChange(tab, category)`, the active chip calls it with `null`, "All" calls it with `null`; the search box stays hidden on Getting Started. Run; fail.
2. **Tests (spec cases 28–29).** Container with `useNavigate` mocked: `onTabChange` → `navigate({to: "/help", search: {tab}, hash: undefined})` with **no** `replace`; `onCategoryChange` → the same shape with `replace: true`, and a `null` category omits the param. Run; fail.
3. **Test (spec case 16).** In `HelpRoute.test.tsx`, `/help?tab=nonsense&category=nonsense` renders Help with Getting Started selected — no error boundary, no blank page. Run; fail.
4. **Implement** — lift tab/category out of `useState` into props; drive `useTabs(0, {value: tabIndex, onChange})` (slice 2); container normalizes with `normalizeHelpSearch` (slice 1) defensively, so the view still renders under the shared test router that never ran `validateSearch`. `searchQuery` stays local. Green.
5. Lint + type-check.

**Done when:** cases 16–21 and 27–29 pass; `/help?tab=faq&category=analytics` lands on the FAQ tab with the chip active in the running app; back/forward moves tabs.

**Risk:** a navigation loop (URL → state → URL). The UI must navigate only from user events, never from a render or effect; cases 28–29 assert exactly one `navigate` per interaction. The existing `handleSelectGlossaryTerm` still mutates state at this boundary — that's fine and intentional; slice 5 reroutes it.

---

## Slice 5 — The anchor: controlled expansion, `FAQEntryAccordion`, scroll

`#glossary-entry-<slug>` / `#faq-entry-<slug>` becomes a working address, and the cross-tab jump joins the same code path.

**Files**

- New: `apps/web/src/components/FAQEntryAccordion.component.tsx` — extracted from `FAQList.component.tsx:44-93` (the Component File Policy forbids the inline helper).
- Edit: `apps/web/src/components/GlossaryList.component.tsx` — `expandedSlugs` / `onToggleEntry`; `registerEntryRef` re-keyed term → slug; `defaultExpanded` → controlled `expanded`.
- Edit: `apps/web/src/components/FAQList.component.tsx` — same props, both render paths delegate to the extracted accordion.
- Edit: `apps/web/src/views/Help.view.tsx` — `anchor` + `onNavigateToEntry` props, the `entryRefs` map keyed `` `${surface}-entry-${slug}` ``, `expandedSlugs` seeded from the anchor, container reads `useLocation({select: l => l.hash})`.
- Edit: `apps/web/src/__tests__/HelpView.test.tsx` (cases 22–26, 30), `GlossaryList.test.tsx` / `FAQList.test.tsx` (cases 31–35).

**Steps**

1. **List tests (spec cases 31–35).** `GlossaryList` expands exactly `expandedSlugs` and re-renders expansion on a set change **without a remount** (the old `defaultExpanded` bug); an accordion click calls `onToggleEntry(slug)`; `registerEntryRef` receives the **slug** and a `null` on unmount; `FAQList` does the same in flat and grouped modes; every existing `data-testid` assertion still passes. Run; fail.
2. **View tests (spec cases 22–26, 30).** `anchor` renders that entry expanded and calls `scrollIntoView` on its ref (jsdom stub); an anchor **overrides** a passed category so the list renders unfiltered; an unknown slug expands nothing, scrolls nothing, throws nothing; a related-term click calls `onNavigateToEntry({surface, slug})` instead of mutating tab state; manual toggling still works independently of the anchor; the container maps `onNavigateToEntry` → `navigate({to: "/help", search: {tab: surface}, hash: "<surface>-entry-<slug>"})`. Run; fail.
3. **Implement** — extract `FAQEntryAccordion` first (pure move, suites stay green), then convert both lists to controlled expansion, then wire `anchor` through the view and container. Reuse the existing `requestAnimationFrame`-deferred `scrollIntoView` (`Help.view.tsx:109-112`). Green.
4. Lint + type-check.

**Done when:** cases 22–26 and 30–35 pass; a pasted `#faq-entry-<slug>` URL opens the FAQ tab with that entry expanded and scrolled; a related glossary term clicked from a FAQ answer now writes the URL. **#367 has its full link target after this slice.**

**Risk:** re-seeding `expandedSlugs` on every render would stomp the user's manual toggles — seed only when `anchor` changes (case 26 is the guard). The `registerEntryRef` key change (term → slug) touches `GlossaryList`'s public props; case 33 pins it.

---

## Slice 6 — Repoint the portal link + doc-sync

The user-facing payoff, plus the convention this ticket establishes written down.

**Files**

- Edit: `apps/web/src/components/PortalSession.component.tsx` — `:159-166` becomes the `Link` + `MuiLink component="span"` form with `search={{tab: HelpTab.Faq, category: FAQCategory.Analytics}}`; `data-testid` moves to the anchor.
- Edit: `apps/web/src/__tests__/PortalSession.test.tsx` — case 36.
- Edit: `CLAUDE.md` + `.github/copilot-instructions.md` — the URL-addressable-tab convention (Help is two-way, Settings stays read-once, and why).

**Steps**

1. **Test (spec case 36).** `portal-session-empty-help-link` has `href="/help?tab=faq&category=analytics"` — exact-href assertion, the `UpgradeLink.test.tsx:11` pattern. Run; fail.
2. **Implement** the link swap. `to` is the string literal `"/help"`, not `ApplicationRoute.Help` — the enum defeats search-param inference (`UpgradeLink.component.tsx:23-30`). Green.
3. **Doc-sync** — add the convention note to `CLAUDE.md` (Routing section) and its `.github/copilot-instructions.md` mirror. Header-menu and sidebar links stay bare; say so, so the next reader doesn't file it as a miss.
4. Lint + type-check + `format:check`; full `apps/web` and `packages/core` suites.

**Done when:** case 36 passes, clicking the portal empty-state link in the running app lands on FAQ → Analytics & Portals, and the convention is documented in both mirrors.

**Risk:** none beyond the type-inference risk already surfaced in slice 1 — this is where a wrong `validateSearch` placement would show up as a `type-check` failure if slice 1's probe test somehow missed it.

---

## Sequence summary

| Slice | Lands | Spec cases | Tests | User-visible |
|---|---|---|---|---|
| 1 | Resolvers + `validateSearch` + route-tree regen | 7–15 | web unit | no |
| 2 | `useTabs` controlled mode | 4–6 | core unit | no |
| 3 | `contentEntrySlug` promoted, slugifiers deleted | 1–3 | core unit (+ web regression) | no |
| 4 | Prop-driven `HelpViewUI` + URL read/write (tab + category) | 16–21, 27–29 | web unit | **yes** |
| 5 | Anchor: controlled expansion, `FAQEntryAccordion`, scroll | 22–26, 30–35 | web unit | **yes** |
| 6 | Repointed portal link + doc-sync | 36 | web unit | **yes** |

Total ≈ **36 cases**, no migration, no API change.

---

## Cross-slice notes

- **`routeTree.gen.ts` is generated.** It regenerates when slice 1 adds `validateSearch`; commit the generated output and never hand-format it (CLAUDE.md excludes it from Prettier).
- **`test-utils.tsx` is deliberately not touched.** Its router registers no file routes, so `validateSearch` can't be exercised through it. Route-level coverage lives in the purpose-built `HelpRoute.test.tsx` (slices 1 and 4); everything else is prop-driven or mocks `useNavigate` at the boundary, the way `HttpErrorComponent.test.tsx` does. The container calling `useSearch({strict: false})` is what keeps `HelpView` renderable under the shared test router.
- **Slices 1–3 are behavior-neutral by construction.** If any existing `apps/web` or `packages/core` test needs editing during them, that's a signal the slice overreached — the only permitted edits in slice 3 are the two `import` swaps.
- **What #367 consumes, and when.** The URL grammar freezes at slice 1, `contentEntrySlug` at slice 3, and the working anchor at slice 5. The assistant tool can be built against slices 1 + 3 before this branch merges into `epic/portal-guidance`.
- **What #366 must not collide with.** This branch touches `glossary.util.ts` only to add `contentEntrySlug` — no entry text. #366 edits entry text and adds entries. Both land on the epic branch; the merge is additive, but slice 3's pinning test is what catches a #366 term whose slug would be ambiguous or empty.
- **Doc-sync is slice 6, not a follow-up.** This ticket establishes a convention (`CLAUDE.md` → "Keeping Documentation in Sync"), so the Routing section and its copilot mirror move in the same PR. No other doc surface applies: no tool contract changes, no glossary/FAQ copy changes, no README-documented script or setup step changes.
- **Component File Policy compliance** is why slice 5 extracts `FAQEntryAccordion` rather than growing the inline helper; `Help.view.tsx` keeps its container + pure-UI pair, and every new prop is data-in/callback-out.
- **Epic branch hygiene** (`CLAUDE.md` → "Epic branches"): PR base is `epic/portal-guidance`, and `main` is merged into the epic branch before this PR merges (keep-pace rule). The child issue stays open at child-merge; its Status row flips to `Merged into epic`.

---

## Next step

Implementation begins on this branch — slice 1 first, tests before code — once discovery, spec, and plan are reviewed and confirmed. Before coding, re-read the spec's *Surface* section: the signatures there are lifted from the real `useTabs`, `GlossaryListProps`, `FAQListProps`, and `HelpViewUIProps`, so extend them rather than reinventing.
