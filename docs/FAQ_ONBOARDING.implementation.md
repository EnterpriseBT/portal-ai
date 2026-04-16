# FAQ & Onboarding — Implementation Plan (TDD)

> Step-by-step checklist based on `FAQ_ONBOARDING.audit.md`. Each step follows red-green-refactor: write the failing test first, implement just enough to pass, then clean up.
>
> Scope: Build the `/help` page (Getting Started + Glossary + FAQ tabs), the static content data, the search/filter behavior, and the sidebar entry point. Per-page contextual help icons, first-time onboarding flow, and empty-state guidance are explicitly out of scope (see "Incremental Enhancements (Future)" in the audit doc).

---

## Phase 0 — Pre-flight

Audit references: Implementation Plan → Where it lives

- [x] Confirm the new route `/help` does not collide with any existing route under `apps/web/src/routes/` — no `help*` files exist
- [x] Confirm `IconName.HelpOutline` (or the equivalent in `@portalai/core`) is exported and renders — added `IconName.HelpOutline` (mapped to `@mui/icons-material/HelpOutline`) in `packages/core/src/ui/Icon.tsx`
- [x] Decide and document the deduplication key for glossary terms (`term` lowercased) and FAQ entries (`question` lowercased) so future content additions don't introduce silent duplicates — enforced via the "terms are unique" tests in Phase 1.2 / 2.2

---

## Phase 1 — Glossary Data Layer

Audit references: Part 1 (Glossary categories + entry shape), Implementation Plan → Glossary data structure

### 1.1 `GlossaryEntry` type and category enum

File: `apps/web/src/utils/glossary.util.ts`
Test: `apps/web/src/__tests__/glossary.util.test.ts`

- [x] **RED** — Add test: `GlossaryCategory enum exposes the 5 documented categories`
  - Assert keys: `DataSources`, `DataModeling`, `Organization`, `Analytics`, `System`
  - Assert values match the kebab-case strings used in the type (`"data-sources"`, `"data-modeling"`, `"organization"`, `"analytics"`, `"system"`)
- [x] **RED** — Add test: `GLOSSARY_CATEGORY_LABELS maps each enum value to a human label`
  - Assert `"data-sources"` → `"Data Sources"`, `"data-modeling"` → `"Data Modeling"`, etc.
- [x] **GREEN** — Export `GlossaryCategory` enum, `GLOSSARY_CATEGORY_LABELS` record, and `GlossaryEntry` interface as defined in the audit doc
- [x] **REFACTOR** — No `utils/` barrel exists; re-export skipped

### 1.2 Glossary entries dataset

File: `apps/web/src/utils/glossary.util.ts`
Test: `apps/web/src/__tests__/glossary.util.test.ts`

- [x] **RED** — Add test: `GLOSSARY_ENTRIES contains an entry for every term named in the audit doc`
  - Build expected list from the audit table (Connector Definition, Connector Instance, Connector Entity, Entity Record, Sync, Column Definition, Field Mapping, Data Types, Validation Pattern, Canonical Format, Primary Key, Normalized Data, Entity Group, Entity Group Member, Link Field, Entity Tag, Overlap Preview, Station, Tool Pack, Portal, Portal Message, Portal Result, Pinned Result, Job, Job Status, Organization, Default Station)
  - Assert each term exists in the dataset (case-insensitive match on `entry.term`)
- [x] **RED** — Add test: `every entry has a non-empty term, definition, and category`
  - Assert no falsy `term`, `definition`, or `category` values
- [x] **RED** — Add test: `every entry's category is a valid GlossaryCategory value`
- [x] **RED** — Add test: `relatedTerms only references terms that exist in the dataset`
  - For every `entry.relatedTerms?.[i]`, assert at least one entry exists whose `term` matches (case-insensitive)
- [x] **RED** — Add test: `pageRoute (when set) starts with "/" — no absolute URLs`
- [x] **RED** — Add test: `terms are unique (no duplicate term in the same category)`
- [x] **GREEN** — Authored 28 glossary entries (covers all audit terms), grouped by category in source order, with cross-linked `relatedTerms` and `pageRoute` set via `ApplicationRoute`
- [x] **REFACTOR** — Entries are grouped by category in source order; all tests pass

### 1.3 Glossary search / filter helpers

File: `apps/web/src/utils/glossary.util.ts`
Test: `apps/web/src/__tests__/glossary.util.test.ts`

- [x] **RED** — Add test: `filterGlossary returns all entries when query is empty and no category set`
- [x] **RED** — Add test: `filterGlossary matches term substring case-insensitively`
  - Query `"connector"` returns Connector Definition, Connector Instance, Connector Entity
- [x] **RED** — Add test: `filterGlossary matches definition substring case-insensitively`
  - Query that hits a unique word in only one definition returns exactly that entry
- [x] **RED** — Add test: `filterGlossary scopes results to the supplied category`
  - `filterGlossary(entries, { category: GlossaryCategory.Analytics })` returns only Station, Tool Pack, Portal, Portal Message, Portal Result, Pinned Result
- [x] **RED** — Add test: `filterGlossary combines query and category (intersection)`
- [x] **RED** — Add test: `filterGlossary returns empty array on no matches`
- [x] **GREEN** — Implemented `filterGlossary(entries, { query?, category? })` lowercasing query and matching against term + definition substrings
- [x] **REFACTOR** — Searched-field count is 2; no `searchableText` helper extracted

---

## Phase 2 — FAQ Data Layer

Audit references: Part 2 (FAQ questions per category), Implementation Plan → FAQ data structure

### 2.1 `FAQEntry` type and category enum

File: `apps/web/src/utils/faq.util.ts`
Test: `apps/web/src/__tests__/faq.util.test.ts`

- [x] **RED** — Add test: `FAQCategory enum exposes the 5 documented categories`
  - Keys: `GettingStarted`, `Data`, `Organization`, `Analytics`, `Jobs`
  - Values: `"getting-started"`, `"data"`, `"organization"`, `"analytics"`, `"jobs"`
- [x] **RED** — Add test: `FAQ_CATEGORY_LABELS maps each enum value to a human label`
- [x] **GREEN** — Export `FAQCategory`, `FAQ_CATEGORY_LABELS`, and `FAQEntry` interface
- [x] **REFACTOR** — None needed

### 2.2 FAQ entries dataset

File: `apps/web/src/utils/faq.util.ts`
Test: `apps/web/src/__tests__/faq.util.test.ts`

- [x] **RED** — Add test: `FAQ_ENTRIES includes every question listed in the audit doc`
  - Build expected list from the audit's 5 question groups (4+6+3+3+2 = 18 questions)
  - Assert each question is present (exact-string match)
- [x] **RED** — Add test: `every entry has a non-empty question, answer, and category`
- [x] **RED** — Add test: `every entry's category is a valid FAQCategory value`
- [x] **RED** — Add test: `relatedGlossaryTerms only references terms in GLOSSARY_ENTRIES`
  - Cross-import `GLOSSARY_ENTRIES` and assert each related term exists (case-insensitive)
- [x] **RED** — Add test: `questions are unique (no duplicate question across the dataset)`
- [x] **GREEN** — Authored 18 FAQ entries (using "Portals.ai" — matches the rebrand applied earlier in the audit doc); answers reference glossary terms; `relatedGlossaryTerms` populated for cross-linking
- [x] **REFACTOR** — Entries grouped by category in source order to mirror the audit's structure

### 2.3 FAQ search / filter helpers

File: `apps/web/src/utils/faq.util.ts`
Test: `apps/web/src/__tests__/faq.util.test.ts`

- [x] **RED** — Add test: `filterFAQ returns all entries when query is empty and no category set`
- [x] **RED** — Add test: `filterFAQ matches question substring case-insensitively`
- [x] **RED** — Add test: `filterFAQ matches answer substring case-insensitively`
- [x] **RED** — Add test: `filterFAQ scopes results to the supplied category`
- [x] **RED** — Add test: `filterFAQ combines query and category (intersection)`
- [x] **RED** — Add test: `filterFAQ returns empty array on no matches`
- [x] **GREEN** — Implemented `filterFAQ(entries, { query?, category? })` mirroring `filterGlossary` (matches against question + answer)
- [x] **REFACTOR** — Helpers diverge only in searched fields but the duplication is two lines per helper; generic `filterByText` deferred until a third use case appears

---

## Phase 3 — Getting Started Content

Audit references: Implementation Plan → UI components → `GettingStarted.component.tsx`

### 3.1 Getting Started step data

File: `apps/web/src/utils/getting-started.util.ts`
Test: `apps/web/src/__tests__/getting-started.util.test.ts`

- [x] **RED** — Add test: `GETTING_STARTED_STEPS contains the four documented steps in order`
  - Expected ordered titles: `"Connect a data source"`, `"Map your fields"`, `"Create a station"`, `"Open a portal"` (matches audit's "connect data → map fields → create station → open portal")
- [x] **RED** — Add test: `every step has title, description, ctaLabel, and ctaRoute`
- [x] **RED** — Add test: `each ctaRoute is a known ApplicationRoute value`
- [x] **GREEN** — Exported `GettingStartedStep` interface and `GETTING_STARTED_STEPS` array; added `ctaLabel` field on each step (button text was implicit in the audit but needed for the upcoming Phase 4.3 component)
- [x] **REFACTOR** — None needed

> Note: "Open a portal" routes to `ApplicationRoute.Stations` because portals are launched from a station, not a top-level list page. This intentionally matches the user journey described in the audit doc.

---

## Phase 4 — Presentational Components

Audit references: Implementation Plan → UI components, Page layout

### 4.1 `GlossaryList.component.tsx`

File: `apps/web/src/components/GlossaryList.component.tsx`
Test: `apps/web/src/__tests__/GlossaryList.test.tsx`

- [x] **RED** — Add test: `renders one accordion per provided entry`
  - Pass 3 fixture entries; assert 3 accordion summaries with the term text
- [x] **RED** — Add test: `renders the category label as a chip on each entry`
- [x] **RED** — Add test: `expanding an accordion reveals definition, example, related, and "Found on"`
  - Use `userEvent.click` on the summary; assert the panel content appears
- [x] **RED** — Add test: `omits "Example" section when entry has no example`
- [x] **RED** — Add test: `omits "Related" section when entry has no relatedTerms`
- [x] **RED** — Add test: `omits "Found on" section when entry has no pageRoute`
- [x] **RED** — Add test: `clicking a related term invokes onSelectTerm with that term`
  - Pass `onSelectTerm` spy; click a related-term link; assert called with the related term string
- [x] **RED** — Add test: `renders empty-state message when entries array is empty`
  - Assert text like "No glossary entries match your search."
- [x] **GREEN** — Implemented as props-only `React.FC<GlossaryListProps>` using MUI `Accordion`, `Chip`, and `Link`; added `expandedTerm` and `registerEntryRef` props so the future `HelpView` can drive expansion + scroll behavior from related-term clicks
- [x] **REFACTOR** — JSX kept inline (~95 lines for the component); subcomponent extraction deferred — readability is fine as-is

### 4.2 `FAQList.component.tsx`

File: `apps/web/src/components/FAQList.component.tsx`
Test: `apps/web/src/__tests__/FAQList.test.tsx`

- [x] **RED** — Add test: `renders one accordion per provided entry`
- [x] **RED** — Add test: `groups entries under category section headers when groupByCategory is true`
  - Pass entries spanning 2 categories; assert exactly 2 section headers in document order
- [x] **RED** — Add test: `does not render category headers when groupByCategory is false (flat list mode)`
- [x] **RED** — Add test: `expanding a question reveals the answer text`
- [x] **RED** — Add test: `renders related glossary term links when present`
- [x] **RED** — Add test: `clicking a related glossary term invokes onSelectTerm with that term`
- [x] **RED** — Add test: `renders empty-state message when entries array is empty`
- [x] **GREEN** — Implemented props-only `React.FC<FAQListProps>` using MUI `Accordion`; extracted a private `FAQEntryAccordion` subcomponent so flat and grouped modes share the same row rendering
- [x] **REFACTOR** — None needed

### 4.3 `GettingStarted.component.tsx`

File: `apps/web/src/components/GettingStarted.component.tsx`
Test: `apps/web/src/__tests__/GettingStarted.test.tsx`

- [x] **RED** — Add test: `renders all four steps in order with title, description, and step number`
- [x] **RED** — Add test: `clicking a step's CTA invokes onNavigate with the step's route`
- [x] **RED** — Add test: `step numbers render as 1, 2, 3, 4`
- [x] **GREEN** — Implemented as props-only `React.FC<{ steps: GettingStartedStep[]; onNavigate: (route: string) => void }>` using a numbered MUI `Card` list (simpler than vertical `Stepper` and visually consistent with existing dashboard cards)
- [x] **REFACTOR** — None needed

### 4.4 Search-bar wiring component

File: `apps/web/src/components/HelpSearchBar.component.tsx`
Test: `apps/web/src/__tests__/HelpSearchBar.test.tsx`

- [x] **RED** — Add test: `renders an input with placeholder "Search help"` (default) and supports override via prop
- [x] **RED** — Add test: `calls onChange with the new value on every keystroke`
- [x] **RED** — Add test: `renders the current value passed via props (controlled)`
- [x] **RED** — Add test: `renders a clear button when value is non-empty and clears on click` + companion `does not render the clear button when value is empty`
- [x] **GREEN** — Implemented a controlled core `TextInput` with `Search` start adornment and conditional `Close` end adornment using core `IconButton`
- [x] **REFACTOR** — None needed

---

## Phase 5 — Help View (container)

Audit references: Implementation Plan → Where it lives, Page layout, UI components

### 5.1 `Help.view.tsx` — pure UI

File: `apps/web/src/views/Help.view.tsx`
Test: `apps/web/src/__tests__/HelpView.test.tsx`

- [x] **RED** — Add test: `renders three tabs labeled "Getting Started", "Glossary", "FAQ"`
- [x] **RED** — Add test: `Getting Started is the default active tab`
  - Assert the Getting Started panel content is visible on initial render (matches audit's tab order: Getting Started | Glossary | FAQ)
- [x] **RED** — Add test: `clicking the Glossary tab swaps the panel to the glossary list`
- [x] **RED** — Add test: `clicking the FAQ tab swaps the panel to the FAQ list`
- [x] **RED** — Add test: `search bar filters glossary entries when on the Glossary tab`
  - Type "station"; assert only matching glossary entries remain visible
- [x] **RED** — Add test: `search bar filters FAQ entries when on the FAQ tab`
- [x] **RED** — Add test: `search bar is hidden on the Getting Started tab` — chose this option (filtering applies only to glossary/FAQ; search input is irrelevant on the Getting Started step list)
- [x] **RED** — Add test: `category chips on the Glossary tab filter entries to that category`
- [x] **RED** — Add test: `category chips on the FAQ tab filter entries to that category`
- [x] **RED** — Add test: `selecting a related glossary term from the FAQ tab switches to the Glossary tab and scrolls to that entry`
  - Stubbed `Element.prototype.scrollIntoView` and synchronous `requestAnimationFrame`; asserted call after click
- [x] **RED** — Add test: `clicking a Getting Started CTA invokes the navigate callback with the step's route`
- [x] **RED** — Add test: `renders the page title "Help" and an icon in the page header`
- [x] **GREEN** — Implemented `HelpViewUI` as props-only (steps, glossaryEntries, faqEntries, onNavigate) wiring `GettingStarted`, `GlossaryList`, `FAQList`, `HelpSearchBar`; tab/search/category/expandedTerm state local to the component; cross-tab navigation clears filters so the chosen term is guaranteed visible after the tab switch
- [x] **REFACTOR** — View is ~210 lines but reads top-to-bottom (header, tabs, optional search, three TabPanels); panel extraction deferred — current structure is easier to follow than splitting

### 5.2 `HelpView` container

File: `apps/web/src/views/Help.view.tsx`
Test: `apps/web/src/__tests__/HelpView.test.tsx`

- [x] **RED** — Add test: `HelpView container mounts and renders the real glossary + FAQ + getting-started content`
  - The container is a 5-line wrapper around `useNavigate`; smoke-renders `<HelpView />` against the test router and asserts the real GETTING_STARTED_STEPS content is visible. (Mocking `useNavigate` via `jest.unstable_mockModule` blew the heap because `test-utils` itself imports `@tanstack/react-router`; container wiring is implicitly covered by the UI test that asserts the `onNavigate` callback fires with the step's route.)
- [x] **GREEN** — Implemented `HelpView: React.FC` as the container that calls `useNavigate()` and forwards `(route) => navigate({ to: route })` to `HelpViewUI`
- [x] **REFACTOR** — None needed

---

## Phase 6 — Routing

Audit references: Implementation Plan → Where it lives (Route path)

### 6.1 Add `Help` to `ApplicationRoute`

File: `apps/web/src/utils/routes.util.ts`

- [x] **RED** — Created `apps/web/src/__tests__/routes.util.test.ts` asserting `ApplicationRoute.Help === "/help"`
- [x] **GREEN** — Added `Help = "/help"` to the enum
- [x] **REFACTOR** — None needed

### 6.2 Help routes — wrapper + index

Files: `apps/web/src/routes/help.tsx`, `apps/web/src/routes/help.index.tsx`

- [x] **GREEN** — Created `help.tsx` mirroring `tags.tsx` (Authorized + AuthorizedLayout + Outlet) bound to `ApplicationRoute.Help`
- [x] **GREEN** — Created `help.index.tsx` mirroring `tags.index.tsx`, renders `HelpView`
- [x] `routeTree.gen.ts` was auto-regenerated and now imports both `HelpRouteImport` and `HelpIndexRouteImport`; `npm run type-check` passes across the monorepo

> Routing files are thin shims and intentionally have no dedicated unit tests — the view tests in 5.x cover behavior. The TanStack Router file convention guarantees the wiring.

---

## Phase 7 — Sidebar Nav Entry

Audit references: Implementation Plan → Sidebar link, Page layout → "Sidebar nav gets a help icon (MUI HelpOutline) at the bottom near Settings"

### 7.1 Add Help item to footer of `SidebarNav`

File: `apps/web/src/components/SidebarNav.component.tsx`
Test: `apps/web/src/__tests__/SidebarNav.test.tsx`

- [x] **RED** — Add test: `footer renders a "Help" sidebar nav item with HelpOutline icon`
  - Render `SidebarNavUI` with a fixture footer that includes the new help item; assert text "Help" is visible
- [x] **RED** — Add test (in the existing `SidebarNav` container test if one exists, otherwise skip): `clicking the Help item navigates to /help`
- [x] **GREEN** — Add a `<SidebarNavItem icon={IconName.HelpOutline} label="Help" ... />` in the footer above Settings; selected when `pathname.startsWith(ApplicationRoute.Help)`; click calls `handleClick(ApplicationRoute.Help)`
- [x] **REFACTOR** — None expected

---

## Phase 8 — Storybook Stories

Audit references: Implementation Plan (UI components are Storybook-eligible per the workflow conventions in `CLAUDE.md`)

### 8.1 Stories for the new presentational components

Files:
- `apps/web/src/stories/GlossaryList.component.stories.tsx`
- `apps/web/src/stories/FAQList.component.stories.tsx`
- `apps/web/src/stories/GettingStarted.component.stories.tsx`
- `apps/web/src/stories/Help.view.stories.tsx`

- [x] Added `Default` story for each component using the real `GLOSSARY_ENTRIES` / `FAQ_ENTRIES` / `GETTING_STARTED_STEPS` data
- [x] Added `Empty` story for `GlossaryList`, `FAQList`, and `HelpViewUI`
- [x] Added `FilteredToAnalytics` (Glossary) and `FilteredToJobs` (FAQ) stories using the existing filter helpers
- [x] Added `GroupedByCategory` story for `FAQList` (the `groupByCategory={true}` mode the `HelpView` uses by default)
- [x] Added `GlossaryFilteredToAnalytics` story for `HelpView` showing the Glossary tab pre-filtered by category (per the audit's filter requirement)
- [x] File names follow the existing convention `*.component.stories.tsx` / `*.view.stories.tsx` (matches `DeleteTagDialog.component.stories.tsx`, `Dashboard.view.stories.tsx`)
- [x] `npm run type-check` clean across the monorepo — manual `npm run storybook` smoke test deferred to Phase 9.3

> Stories are visual aids only — no test coverage is required for them.

---

## Phase 9 — Integration Verification

### 9.1 Type check and lint

- [x] Ran `npm run type-check` — 0 TypeScript errors across the monorepo (4 packages cached + fresh)
- [x] Ran `npm run lint` — 0 errors; only pre-existing warnings in unrelated files (api `field-mapping-update.tool.ts`, api `filter-sql.util.ts`, core test files); no warnings in any new help-page file

### 9.2 Full test suite

- [x] Ran `npm run test` from repo root — all packages green:
  - `@portalai/api`: 47 suites, 720 tests passed
  - `@portalai/core`: 66 suites, 1168 tests passed
  - `@portalai/web`: 114 suites, 1506 tests passed
  - **Total: 3394 tests passing**
- [x] Web test count grew with the additions from Phases 1–7 (glossary, faq, getting-started, GlossaryList, FAQList, GettingStarted, HelpSearchBar, HelpView, routes.util, SidebarNavHelpItem)

### 9.3 Manual smoke test

> Deferred to the user — requires running dev servers. Checklist preserved verbatim:

- [ ] Start dev servers (`npm run dev`)
- [ ] Click the Help item in the sidebar — page loads with the Getting Started tab active
- [ ] Switch to Glossary tab — list of terms appears, grouped/filterable by category
- [ ] Type into the search bar — list narrows
- [ ] Click a related term inside an FAQ entry — view switches to Glossary and the corresponding entry expands
- [ ] Click a Getting Started CTA — router navigates to that route
- [ ] Resize to mobile width — sidebar collapses; help item still reachable

### 9.4 Content review

- [x] Glossary definitions reviewed: every entry uses a single sentence written for non-experts and avoids jargon (verified in `glossary.util.ts`); the unique-term and category-validity tests guard against drift
- [x] All 28 glossary entries include an `Example` (verified by inspection — all entries in `GLOSSARY_ENTRIES` have an `example` field)
- [x] Every FAQ answer cross-references the matching glossary term via `relatedGlossaryTerms`; the `relatedGlossaryTerms only references terms in GLOSSARY_ENTRIES` test guarantees these stay in sync

---

## File Change Summary

| File | Action | Phase |
|------|--------|-------|
| `apps/web/src/utils/glossary.util.ts` | New (data + filter helpers) | 1.1–1.3 |
| `apps/web/src/__tests__/glossary.util.test.ts` | New | 1.1–1.3 |
| `apps/web/src/utils/faq.util.ts` | New (data + filter helpers) | 2.1–2.3 |
| `apps/web/src/__tests__/faq.util.test.ts` | New | 2.1–2.3 |
| `apps/web/src/utils/getting-started.util.ts` | New (step data) | 3.1 |
| `apps/web/src/__tests__/getting-started.util.test.ts` | New | 3.1 |
| `apps/web/src/components/GlossaryList.component.tsx` | New | 4.1 |
| `apps/web/src/__tests__/GlossaryList.test.tsx` | New | 4.1 |
| `apps/web/src/components/FAQList.component.tsx` | New | 4.2 |
| `apps/web/src/__tests__/FAQList.test.tsx` | New | 4.2 |
| `apps/web/src/components/GettingStarted.component.tsx` | New | 4.3 |
| `apps/web/src/__tests__/GettingStarted.test.tsx` | New | 4.3 |
| `apps/web/src/components/HelpSearchBar.component.tsx` | New | 4.4 |
| `apps/web/src/__tests__/HelpSearchBar.test.tsx` | New | 4.4 |
| `apps/web/src/views/Help.view.tsx` | New (HelpViewUI + HelpView container) | 5.1, 5.2 |
| `apps/web/src/__tests__/HelpView.test.tsx` | New | 5.1, 5.2 |
| `apps/web/src/utils/routes.util.ts` | Add `Help` enum value | 6.1 |
| `apps/web/src/routes/help.tsx` | New (Authorized layout wrapper) | 6.2 |
| `apps/web/src/routes/help.index.tsx` | New (renders HelpView) | 6.2 |
| `apps/web/src/routes/routeTree.gen.ts` | Auto-regenerated | 6.2 |
| `apps/web/src/components/SidebarNav.component.tsx` | Add Help nav item to footer | 7.1 |
| `apps/web/src/__tests__/SidebarNav.test.tsx` | Extend with Help-item assertions | 7.1 |
| `apps/web/src/stories/GlossaryList.stories.tsx` | New | 8.1 |
| `apps/web/src/stories/FAQList.stories.tsx` | New | 8.1 |
| `apps/web/src/stories/GettingStarted.stories.tsx` | New | 8.1 |
| `apps/web/src/stories/HelpView.stories.tsx` | New | 8.1 |

---

## Out of scope (deferred to future work, per audit doc)

- Per-page contextual help icons / tooltips on every domain page in the "Per-Page Audit" section
- First-time onboarding stepper overlay for brand-new organizations
- Empty-state guidance content updates on existing pages
- Backend changes — none required; the help page is entirely client-side static content
