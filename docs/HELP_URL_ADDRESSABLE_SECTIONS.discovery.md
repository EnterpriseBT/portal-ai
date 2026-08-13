# Addressable Help sections — Discovery

**Issue:** [EnterpriseBT/portal-ai#365](https://github.com/EnterpriseBT/portal-ai/issues/365) · child of epic [#364](https://github.com/EnterpriseBT/portal-ai/issues/364) · branch `feat/help-url-addressable-sections` off `epic/portal-guidance`

**Why this exists.** Every link into Help is a bare `/help`, and `HelpViewUI` seeds its tab state with `useTabs(TAB_GETTING_STARTED)` (`Help.view.tsx:69-70`), so the reader always lands on onboarding steps no matter what they clicked. The clearest casualty is the portal empty state — "Learn what portal sessions can do →" (`PortalSession.component.tsx:160-166`) promises portal material and delivers a getting-started checklist. Help already knows how to *address* a section internally (`handleSelectGlossaryTerm`, `Help.view.tsx:100-115`, switches tab + clears filters + scrolls a term into view) but that address lives only in React state: it can't be linked to, shared, bookmarked, or reached with the back button.

This is the destination layer of epic #364. It makes a Help section a URL — `/help?tab=faq&category=analytics#faq-entry-<slug>` — so the sibling content ticket (#366) has somewhere to point and the `assistant` tool (#367) can cite a specific answer instead of dumping the reader on the front door.

## The current shape

### Help view and its routes

| Piece | Location | Note |
|---|---|---|
| Layout route `/help` | `apps/web/src/routes/help.tsx:7-9` | `Authorized` + `AuthorizedLayout` + `<Outlet/>`. No `validateSearch`. |
| Index route `/help/` | `apps/web/src/routes/help.index.tsx:5-7` | Renders `HelpView` directly. No `validateSearch`. |
| Container | `Help.view.tsx:247-265` | Wires `useNavigate` into `onNavigate`; passes the three static datasets. Nothing route-aware. |
| Pure UI | `Help.view.tsx:63-243` | `HelpViewUIProps` = `{steps, glossaryEntries, faqEntries, onNavigate}` (`:56-61`). |
| Tab indices | `Help.view.tsx:45-47` | `TAB_GETTING_STARTED=0`, `TAB_GLOSSARY=1`, `TAB_FAQ=2` — numeric constants, no slugs. |
| Local state | `Help.view.tsx:72-80` | `searchQuery`, `glossaryCategory`, `faqCategory`, `expandedGlossaryTerm`, plus a `glossaryEntryRefs` map. |
| Category chips | `Help.view.tsx:167-181`, `204-218` | Built inline per tab from `Object.values(GlossaryCategory)` / `FAQCategory`, with an "All" chip resetting to `null`. |
| FAQ grouping | `Help.view.tsx:233` | `groupByCategory={!faqCategory}` — a category filter flattens the grouped render. |

### The `validateSearch` precedent (the only one in the repo)

`routes/settings.tsx:17-21` declares `validateSearch` returning a plain object literal; a `tab` value not in `SettingsTab` collapses to `undefined` rather than throwing — "a bad link should open Settings, not error." The slug trio lives in `utils/routes.util.ts`: `SettingsTab` (`:32`), `SETTINGS_TAB_INDEX` (`:39`), `settingsTabIndexFromSearch(search: string)` (`:49`) which parses `window.location.search` itself and falls back to `0`.

`Settings.view.tsx:43-48` seeds `useTabs(settingsTabIndexFromSearch(window.location.search))` **at mount only**, with a comment stating outright that clicking a tab does not rewrite the URL. That read-once shape is the precedent this ticket deliberately diverges from — it satisfies "land me on billing" but not "share this view" or "go back."

`UpgradeLink.component.tsx:23-44` is the typed-link precedent: TanStack `<Link to="/settings" search={{tab: SettingsTab.Billing}}>` wrapping `<MuiLink component="span">`, because `MuiLink component={Link}` erases the router generic and collapses `search` to `never`, and because `to` must be the string literal (not the `ApplicationRoute` enum) for search inference. Today's three Help links use the simpler untyped form: `PortalSession.component.tsx:160-166`, `HeaderMenu.component.tsx:107-113`, `SidebarNav.component.tsx:147-150` (the last goes through `router.navigate({to: path})` at `:129`, and computes selected state from `pathname.startsWith(ApplicationRoute.Help)` — pathname only, so search params can't break it).

### The tabs primitive

`packages/core/src/ui/Tabs.tsx:19-52` — `useTabs(initialValue = 0)` holds `React.useState` internally and returns `{value, setValue, handleChange, tabsProps, getTabProps, getTabPanelProps}`. **There is no controlled mode**: `tabsProps` is always built from internal state. A consumer can seed the initial value (Settings) or call `setValue` imperatively (`handleSelectGlossaryTerm`), but cannot hand it an external value. A11y ids are index-based (`tab-${index}` / `tabpanel-${index}`, `:34-42`, `:78-79`), so any URL slug must map to a numeric index exactly as `SETTINGS_TAB_INDEX` does.

### Entry-level expansion, today

| | Glossary | FAQ |
|---|---|---|
| Slug helper | `slugifyTerm` — `GlossaryList.component.tsx:77-78` (lowercase, spaces→`-`) | `slugifyQuestion` — `FAQList.component.tsx:23-27` (lowercase, non-alphanumerics→`-`, trimmed) |
| `data-testid` | `glossary-entry-${slug}` (`:107`) | `faq-entry-${slug}` (`:51`) |
| Expansion | `defaultExpanded={expanded}` (`:111`), driven by an `expandedTerm` prop (`:100-102`) | **none** — `FAQEntryAccordion` (`:44-93`) takes no expansion prop |
| Scroll ref | `registerEntryRef` callback ref (`:108-110`) | **none** |

Two facts matter for the anchor work. First, both slug helpers are **module-private** to their component files, while #367 needs to *construct* these URLs from `apps/api`. Second, `defaultExpanded` is uncontrolled — an accordion that is already mounted ignores a later `expandedTerm` change, so today's cross-tab jump reliably scrolls but only expands when the target happens to remount. Third, `FAQEntryAccordion` is an inline helper component, which the Component File Policy forbids; adding props to it is the moment that debt comes due.

### Content enums (the `category` vocabulary)

`GlossaryCategory` (`glossary.util.ts:18-24`): `data-sources`, `data-modeling`, `organization`, `analytics`, `system`. `FAQCategory` (`faq.util.ts:11-17`): `getting-started`, `data`, `organization`, `analytics`, `jobs`. `analytics` is a member of **both** — which is exactly what the target link `?tab=faq&category=analytics` relies on — while `data-modeling` is glossary-only, the ticket's mismatch case. Both modules are dependency-free by design (shared with the marketing site, #311); `filterGlossary` (`:411`) / `filterFAQ` (`:276`) take `{query?, category?}` and match category by exact equality.

### Tests

`__tests__/test-utils.tsx` renders through a `createTestRouter()` built on a bare `createRootRoute()` with memory history — **no file routes are registered**, so `validateSearch` is never exercised by that render path. `SettingsView.test.tsx:24-55` shows the working convention: an `at(search)` helper doing `window.history.replaceState(null, "", "/settings" + search)` before render, then asserting `aria-selected`. That works only because `Settings.view.tsx` reads `window.location.search` directly. `UpgradeLink.test.tsx:11` asserts the exact generated `href` (`/settings?tab=billing`) — the pattern for the repointed portal link. `HelpView.test.tsx` currently drives `HelpViewUI` through props plus one container smoke test. `routes.util.test.ts` only asserts `ApplicationRoute.Help === "/help"`; there is no test for the Settings trio to copy.

## The design space

### Decision 1 — Which route declares `validateSearch`

**A. The layout route (`help.tsx`).** Search params are inherited down the tree, so `/help` and any future `/help/<child>` share one contract.
**B. The index route (`help.index.tsx`).** The contract sits on the route that actually renders `HelpView`.

| | A — layout | B — index |
|---|---|---|
| `<Link to="/help" search={…}>` type inference | Resolves against the route the path names; the layout owns `/help` | The index is `/help/`; the literal `to="/help"` is the ergonomic form |
| Future `/help/<something>` | Inherits the contract free | Would need its own copy |
| Precedent match | Settings is a flat route — no guidance either way | Same |

**Lean: A, the layout route.** One declaration covers the subtree, and `HelpView` reads it with `useSearch({from: ApplicationRoute.Help})`. If typed-link inference against `to="/help"` misbehaves at implementation time, moving the declaration to the index is a one-line change — the spec should name the assertion (`UpgradeLink`-style exact-href test) that proves which is right.

### Decision 2 — How tab/category state relates to the URL

This is the ticket's real decision: the AC demands the back button work, which rules out seeding.

**A. Seed-only, emit-on-change.** Keep internal state; read the URL once at mount; push a new URL on every change. Simple, but the URL is write-only after mount — pressing back changes the address bar and nothing else. **Fails the back-button AC.**

**B. URL as the single source of truth.** `HelpView` reads `useSearch()`, passes `tab`/`category` down as values, and `HelpViewUI` calls `onTabChange` / `onCategoryChange`; the container navigates, `useSearch` re-renders, the UI follows. Requires driving the MUI `Tabs` from a prop, which `useTabs` cannot do.

**C. Internal state mirrored from the URL by effect.** Keep `useTabs`, add a `useEffect` that calls `setValue` when the search changes. Two sources of truth kept in sync by an effect — the classic drift/flicker shape, and an extra render per navigation.

| | A — seed only | B — URL is truth | C — state + effect |
|---|---|---|---|
| Back button | ✗ | ✓ | ✓ (one frame late) |
| Flash of Getting Started | ✗ on deep link | ✓ none | possible — mounts at tab 0, then corrects |
| `useTabs` usable as-is | ✓ | ✗ needs controlled support | ✓ |
| Sources of truth | 1 (state) | 1 (URL) | 2 |

**Lean: B.** It is the only option that satisfies both "no intermediate flash of Getting Started" and "back returns to the previous tab" without an effect keeping two copies honest. It costs one small change in `@portalai/core`: give `useTabs` an optional controlled value.

### Decision 3 — How `useTabs` gains a controlled mode

**A. Extend `useTabs` in core** with an optional `{value, onChange}` override — when supplied, `tabsProps` reflects the caller's value and `handleChange` delegates. Additive; every existing caller (`initialValue` only) is untouched.
**B. Bypass `useTabs` in Help** and build `tabsProps`/`getTabProps` inline.
**C. A second hook** (`useControlledTabs`) beside it.

**Lean: A.** `getTabProps`/`getTabPanelProps` carry the a11y id scheme, and B duplicates it in a view — the exact drift the primitive exists to prevent. C splits one concept across two hooks for no gain. A is a backwards-compatible signature widening with a core unit test.

### Decision 4 — Where the tab/category pairing is validated

The AC requires `?tab=faq&category=data-modeling` to open FAQ with **no** filter — a cross-field rule, since `category` is only meaningful relative to `tab`.

**A. Entirely in `validateSearch`.** It receives the whole search object, so it can drop a category that doesn't belong to the resolved tab. Downstream (`useSearch`, the view, tests) never sees an invalid pair.
**B. In `validateSearch` per-field, pairing resolved in the view** via a `helpCategoryFromSearch(tab, category)` helper.

**Lean: A for the pairing, with the enum membership tests living in `routes.util.ts`** as `helpTabFromSearch` / `helpCategoryForTab` so they're unit-testable without a router — mirroring the `SettingsTab`/`SETTINGS_TAB_INDEX`/`settingsTabIndexFromSearch` trio the ticket asks us to parallel. One place owns "what is a valid Help address", and it's the route.

### Decision 5 — Where the entry slug functions live

The anchor is `#glossary-entry-<slug>` / `#faq-entry-<slug>`, and #367's `assistant` tool must build those URLs **server-side from `apps/api`**, where `GlossaryList.component.tsx`'s private `slugifyTerm` is unreachable.

**A. Promote both helpers to `@portalai/core/content`,** next to the entries they slugify (`glossaryTermSlug` / `faqQuestionSlug`), and have the two list components import them.
**B. Leave them in `apps/web` and duplicate the algorithm in the API when #367 lands.**

**Lean: A.** The slug *is* part of the content contract the moment it appears in a URL; two independent copies of a slugifier that must agree byte-for-byte across a network boundary is a bug waiting for the first term containing punctuation. Promoting it is additive to a dependency-free module and unblocks #367 without a second edit here.

### Decision 6 — Making an anchored entry actually expand

`GlossaryList` uses uncontrolled `defaultExpanded`; `FAQList` has no expansion plumbing at all.

**A. Controlled expansion on both lists** — an `expandedSlug` prop plus `onToggle`, `Accordion expanded={…}`. Fixes the existing latent "scrolls but doesn't expand" bug in the cross-tab jump for free.
**B. Uncontrolled + remount key** (`key={slug}-${expanded}`) to force `defaultExpanded` re-evaluation. Cheap, but re-mounting to change a boolean is a trick, and it discards the user's manual expand state on every URL change.
**C. Glossary controlled, FAQ `defaultExpanded`** — minimum new code, but leaves the two lists behaviorally different for no reason.

**Lean: A**, and take the Component File Policy debt with it: extract `FAQEntryAccordion` (`FAQList.component.tsx:44-93`) into its own pure-UI file rather than growing an inline helper the policy forbids.

### Decision 7 — History semantics for tab vs. category

**Lean: tab changes `push`, category chips `replace`.** The AC names only the tab for back-button behavior, and chip toggling is exploratory — five chips followed by five back presses is history spam, while the *shared* URL is identical either way. Record it so it reads as a decision, not an oversight.

## Tradeoff comparison

|  | D1 layout route | D2 URL-is-truth | D3 extend `useTabs` | D4 pairing in `validateSearch` | D5 slugs to core | D6 controlled expansion |
|---|---|---|---|---|---|---|
| Files outside `apps/web` | No | No | `packages/core/src/ui/Tabs.tsx` | No | `packages/core/src/content/*` | No |
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes |
| Unblocks #367 directly | Yes (URL shape) | No | No | No | Yes (slug fn) | Yes (anchor lands open) |
| Reversible later | Yes — one-line move | No — shapes the props | Yes — additive | Partly — the contract is the URL | Yes — re-export | Yes |

## Recommendation

1. Declare `validateSearch` on the `/help` **layout** route (`routes/help.tsx`), accepting `tab` and `category`; unrecognized values, and a category that doesn't belong to the resolved tab, collapse to `undefined`.
2. Add the `HelpTab` slug enum (`getting-started` | `glossary` | `faq`), `HELP_TAB_INDEX`, and the resolvers `helpTabIndexFromSearch` / `helpCategoryForTab` to `apps/web/src/utils/routes.util.ts`, mirroring the `SettingsTab` trio and unit-tested without a router.
3. Make the URL the single source of truth for tab + category. `HelpView` reads `useSearch()` and `useNavigate()`; `HelpViewUI` receives `tab`, `glossaryCategory`, `faqCategory`, `anchorSlug` as values and emits `onTabChange` / `onCategoryChange`. Search-box text stays local state (explicitly out of scope).
4. Widen `useTabs` in `@portalai/core` with an optional controlled `value`/`onChange`, leaving every existing caller's behavior identical.
5. Promote `glossaryTermSlug` and `faqQuestionSlug` into `@portalai/core/content` and import them in `GlossaryList` / `FAQList`; they become the shared contract #367 builds Help URLs from.
6. Give both lists controlled expansion keyed on the anchor slug, extracting `FAQEntryAccordion` into its own file per the Component File Policy, and reuse the existing `requestAnimationFrame`-deferred `scrollIntoView`.
7. Repoint "Learn what portal sessions can do →" at `/help?tab=faq&category=analytics` using the `Link` + `MuiLink component="span"` form, asserted by an exact-href test. Header-menu and sidebar Help links stay bare — a generic nav item carries no destination intent.
8. Tab changes push a history entry; category-chip changes replace.

## Open questions

1. **Does the anchored entry survive its own category filter?** `#faq-entry-<slug>` names an entry that a paired `?category=` may filter out of the list. **Lean: the anchor wins** — when a fragment resolves to a known entry, drop the category filter for that render (the same "clear filters so the chosen term is guaranteed visible" rule `handleSelectGlossaryTerm` already applies at `Help.view.tsx:103-105`), rather than silently scrolling to nothing.
2. **Does the cross-tab jump now write the URL?** `handleSelectGlossaryTerm` currently mutates state only. **Lean: yes, it navigates** — it becomes `navigate({search: {tab: glossary}, hash: glossaryTermSlug(term)})`, which is the same code path as a deep link and collapses two behaviors into one. The AC already requires the destination to be reflected in the URL.
3. **Can `HelpView.test.tsx` exercise `validateSearch` at all?** The shared test router registers no file routes, so a `useSearch({from: "/help"})` container will not resolve there. **Lean: split the coverage** — pure resolver tests in `routes.util.test.ts`, prop-driven behavior tests on `HelpViewUI`, and the URL round-trip proven by a small router-registered test rather than by retrofitting `test-utils.tsx`. The spec should settle the exact mechanism; this is the likeliest place the plan under-estimates.
4. **Should `apps/site` get the same addresses?** The marketing site consumes FAQ content for JSON-LD (`apps/site/src/lib/jsonld.ts`) but renders no glossary/FAQ list. **Lean: no** — nothing to address there today; the promoted slug helpers make it cheap if that changes.
5. **Does `ApplicationRoute.Help` stay usable in `to=`?** `UpgradeLink.component.tsx:23-30` records that the enum defeats search-param inference. **Lean: use the string literal at the typed link site**, keep the enum everywhere else (including `SidebarNav`'s `startsWith` check, which is unaffected).

## Enterprise-scale considerations

- **Concurrency & correctness** — N/A because this is client-side routing state; there is no server write, no check-then-act, no shared resource.
- **Accuracy & auditability** — N/A because no record of truth is created; the URL *is* the state.
- **Failure modes** — the only failure is a malformed or stale link, and the design is deliberately **fail-open**: unknown `tab`, unknown `category`, mismatched pair, or an anchor naming a deleted entry all degrade to a working Help page rather than an error boundary. **Lean:** an anchor that matches no entry must be a no-op scroll, not a thrown lookup — content churn from #366 will produce exactly that.
- **Scale & unbounded growth** — N/A because the datasets are static module constants rendered in full today; addressing them adds no fan-out. History entries are the one unbounded thing, and Decision 7 (replace-on-chip) is the cap.
- **Multi-tenancy** — N/A because Help content is identical for every org; no tenant data enters the URL. Worth stating because the opposite would be a leak: **no entity ids, org ids, or user-typed text belong in these params** — which is also the substantive reason the search box stays out of scope.
- **Contract stability** — this is the dimension that carries weight. The URL shape becomes a cross-package contract: #367 constructs it from `apps/api`, #366's content churn changes which slugs resolve, and marketing could adopt it later. Shaping it now as `tab` + `category` + `#<surface>-entry-<slug>` — with slugs derived by a **shared** function in `@portalai/core/content` (Decision 5) and additive, fail-open validation — means a fourth tab or a new category is a data change, not a re-plumb.
- **Data lifecycle** — N/A because nothing is persisted; a bookmark is the only durable artifact, and fail-open validation is what keeps an old bookmark working after content moves.

## What this doesn't decide

- Two-way sync for the Help **search box**. Out of scope on the ticket: user-typed text in the URL brings debounce and history-spam decisions, and per the multi-tenancy note above, user text is the one thing that shouldn't land in a shareable address.
- Retrofitting `Settings.view.tsx` to two-way sync. Help is the surface people link *to*; whether Settings should follow is its own call, not a drive-by refactor here.
- Whether the header-menu and sidebar Help links ever get destinations. Confirmed as out of scope on the ticket — recorded so the next reader doesn't file it as a miss.
- The Help **content** those addresses point at — #366 owns the portal best-practices copy, and this branch must not touch `glossary.util.ts` / `faq.util.ts` entry text (the shared slug helpers are the one addition, and they are code, not content).
- Anything about the `assistant` tool's answer format. #367 consumes the URL shape decided here; it doesn't constrain it.
- `pageRoute` entries for `Portal` / `Portal Message` / `Portal Result` in `glossary-routes.util.ts` — the portal route needs an id, so there's no static destination to link.

## Next step

`docs/HELP_URL_ADDRESSABLE_SECTIONS.spec.md` pins the URL contract (the exact `tab`/`category`/hash grammar, the sanitization table including the mismatched pair, the widened `useTabs` signature, the promoted slug functions, and `HelpViewUIProps` in full), then `.plan.md` slices it. The natural slicing is bottom-up so each commit is independently green: (1) `routes.util.ts` resolvers + `validateSearch` with resolver unit tests; (2) `useTabs` controlled mode in core; (3) slug helpers promoted to `@portalai/core/content` with the two list components re-importing them; (4) `HelpViewUI` driven by props + `HelpView` reading/writing the URL; (5) controlled expansion + anchor scroll, including the `FAQEntryAccordion` extraction; (6) the repointed portal empty-state link with its exact-href assertion. Slices 1–3 touch no user-visible behavior, which keeps the risky render-path change (4–5) in a small reviewable commit.
