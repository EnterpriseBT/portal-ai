# Addressable Help sections — Spec

**Issue:** [EnterpriseBT/portal-ai#365](https://github.com/EnterpriseBT/portal-ai/issues/365) · **Epic:** [#364](https://github.com/EnterpriseBT/portal-ai/issues/364) · **Discovery:** `docs/HELP_URL_ADDRESSABLE_SECTIONS.discovery.md` · branch `feat/help-url-addressable-sections` → base `epic/portal-guidance`

This spec pins the Help URL contract — the `tab` / `category` search grammar, the `#<surface>-entry-<slug>` fragment, their sanitization rules — and the code surface that implements it: a controlled mode on `useTabs`, a shared entry-slug function in `@portalai/core/content`, controlled accordion expansion on both Help lists, and a `HelpViewUI` driven entirely by props.

## Key decisions (flag for review)

Discovery decisions D1–D7 and open questions Q1–Q5 are ratified as their stated leans:

- **D1 — `validateSearch` on the `/help` layout route** (`routes/help.tsx`), inherited by `/help/`.
- **D2 — the URL is the single source of truth** for tab + category. No seed-and-forget, no mirroring effect. Search-box text stays local state (out of scope).
- **D3 — `useTabs` gains an optional controlled mode** in `@portalai/core`; every existing caller is byte-identical in behavior.
- **D4 — the tab/category pairing is validated in one place** (`normalizeHelpSearch` in `routes.util.ts`), called by both `validateSearch` and the container.
- **D5 — one shared slug function** (`contentEntrySlug`) in `@portalai/core/content`, replacing the two private slugifiers. All 38 current glossary terms and every FAQ question slug **identically** under the unified rule, so no `data-testid` changes.
- **D6 — controlled accordion expansion** on both lists, keyed by slug; `FAQEntryAccordion` extracted to its own file per the Component File Policy.
- **D7 — tab changes `push`, category changes `replace`.**
- **Q1 — the anchor outranks the category filter**; a resolved anchor also selects its own tab.
- **Q2 — the cross-tab glossary jump navigates** rather than mutating state, collapsing it into the deep-link code path.
- **Q3 — coverage splits three ways**: pure resolver unit tests, prop-driven `HelpViewUI` tests, and one router-registered test that exercises the real `validateSearch`. `test-utils.tsx` is **not** retrofitted.
- **Q4 — `apps/site` gets nothing.** **Q5 — the string literal `"/help"` at the typed link site**, the `ApplicationRoute` enum everywhere else.
- **Fail-open everywhere** (discovery → Enterprise → Failure modes): unknown tab, unknown category, mismatched pair, and an anchor matching no entry each degrade to a working Help page. No throw, no error boundary, no empty render.

## Scope

### In scope

1. `HelpTab` enum + `HELP_TAB_INDEX` + `normalizeHelpSearch` / `helpTabIndexFromSearch` / `parseHelpAnchor` in `apps/web/src/utils/routes.util.ts`.
2. `validateSearch` on `apps/web/src/routes/help.tsx`.
3. Controlled mode on `useTabs` (`packages/core/src/ui/Tabs.tsx`).
4. `contentEntrySlug` in `@portalai/core/content`, consumed by both Help lists.
5. `HelpViewUI` prop-driven tab/category/anchor + `HelpView` reading and writing the URL.
6. Controlled expansion + scroll-to-anchor on `GlossaryList` and `FAQList`; `FAQEntryAccordion` extracted.
7. The portal empty-state link repointed to `/help?tab=faq&category=analytics`.

### Out of scope

- Two-way sync for the Help **search box**; user-typed text never enters the URL.
- Retrofitting `Settings.view.tsx` (or `test-utils.tsx`) to this pattern.
- Repointing `HeaderMenu.component.tsx:107` / `SidebarNav.component.tsx:147` — a generic nav item carries no destination intent (confirmed on the issue).
- Any change to glossary/FAQ **entry content** — #366 owns that; this branch touches those modules only to add the slug function.
- `apps/site` changes; `pageRoute` entries in `glossary-routes.util.ts`.

## Surface

### `apps/web/src/utils/routes.util.ts` (edit)

Appended after the `SettingsTab` block, mirroring its enum + index-map + resolver shape. `ApplicationRoute` is unchanged.

```ts
import {
  FAQCategory,
  GlossaryCategory,
} from "@portalai/core/content";

// ── Help tabs (#365) ─────────────────────────────────────────────────
//
// Help is the surface the rest of the app links *to*, so unlike Settings
// (read-once, `settingsTabIndexFromSearch` above) its tab + category are a
// two-way contract: the URL is the state. `normalizeHelpSearch` is the one
// authority on what a valid Help address is — `validateSearch` on the route
// calls it, and `HelpView` calls it again defensively so the view is
// renderable under any router (including test routers with no file routes).

export enum HelpTab {
  GettingStarted = "getting-started",
  Glossary = "glossary",
  Faq = "faq",
}

/** Tab order as rendered by `Help.view.tsx`. */
export const HELP_TAB_INDEX: Record<HelpTab, number> = {
  [HelpTab.GettingStarted]: 0,
  [HelpTab.Glossary]: 1,
  [HelpTab.Faq]: 2,
};

/** The categories addressable on each tab. Getting Started has none. */
export type HelpCategory = GlossaryCategory | FAQCategory;

export interface HelpSearch {
  tab?: HelpTab;
  category?: HelpCategory;
}

/**
 * Sanitize a raw search object into a valid Help address.
 * - `tab` not in `HelpTab` → `undefined` (Getting Started).
 * - `category` not in the enum belonging to the resolved tab → `undefined`.
 *   The pairing is cross-field on purpose: `analytics` is a member of both
 *   enums, `data-modeling` is glossary-only.
 * - Never throws. A malformed link opens Help.
 */
export function normalizeHelpSearch(search: Record<string, unknown>): HelpSearch;

/** Resolve a normalized search to the numeric index `useTabs` speaks. */
export function helpTabIndexFromSearch(search: HelpSearch): number; // default 0

export type HelpAnchorSurface = HelpTab.Glossary | HelpTab.Faq;

export interface HelpAnchor {
  surface: HelpAnchorSurface;
  slug: string;
}

/**
 * Parse `#glossary-entry-<slug>` / `#faq-entry-<slug>`. Accepts the hash with
 * or without a leading `#` (TanStack's `location.hash` omits it; a hand-built
 * href may not). Anything else → `undefined`.
 */
export function parseHelpAnchor(hash: string | undefined): HelpAnchor | undefined;

/** Build the fragment for an entry — the inverse of `parseHelpAnchor`. */
export function helpAnchorHash(anchor: HelpAnchor): string; // "glossary-entry-station", no leading "#"
```

### `apps/web/src/routes/help.tsx` (edit)

```ts
export const Route = createFileRoute(ApplicationRoute.Help)({
  component: RouteComponent,
  /**
   * `?tab=` + `?category=` make a Help section linkable (#365, epic #364).
   * Declared on the layout route so `/help/` and any future child inherit
   * one contract. Sanitization lives in `normalizeHelpSearch` so the same
   * rules apply here and in the view. Unrecognized or mismatched values are
   * dropped, never rejected — a stale link must open Help, not error.
   * The `#<surface>-entry-<slug>` fragment is not a search param; the view
   * reads it from `useLocation`.
   */
  validateSearch: (search: Record<string, unknown>): HelpSearch =>
    normalizeHelpSearch(search),
});
```

`help.index.tsx` is unchanged.

**URL grammar and sanitization — the contract tests assert this table:**

| URL | Tab | Category chip | Anchor |
|---|---|---|---|
| `/help` | Getting Started | — | — |
| `/help?tab=faq&category=analytics` | FAQ | Analytics & Portals | — |
| `/help?tab=glossary&category=analytics` | Glossary | Analytics | — |
| `/help?tab=nonsense&category=nonsense` | Getting Started | — | — |
| `/help?tab=faq&category=data-modeling` | FAQ | none (glossary-only category dropped) | — |
| `/help?category=analytics` (no tab) | Getting Started | none (no tab ⇒ no category) | — |
| `/help#faq-entry-<slug>` | FAQ (anchor selects its surface) | none | that entry, expanded + scrolled |
| `/help?tab=glossary&category=system#faq-entry-<slug>` | FAQ (anchor outranks `tab`) | none (anchor outranks `category`) | that entry |
| `/help?tab=faq#faq-entry-unknown-slug` | FAQ | — | no-op; no scroll, no throw |

### `packages/core/src/ui/Tabs.tsx` (edit)

`useTabs` gains an optional second argument. Called with one argument it is behaviorally identical to today — the existing callers (`Settings.view.tsx:46`, plus any other `useTabs(n)` site) are untouched.

```ts
export interface UseTabsOptions {
  /** When provided, the hook is controlled: this value is rendered and
   *  internal state is not read. Omit for the existing uncontrolled behavior. */
  value?: number;
  /** Called on tab change (and on imperative `setValue`) in controlled mode. */
  onChange?: (value: number) => void;
}

export function useTabs(initialValue = 0, options?: UseTabsOptions): {
  value: number;            // controlled ? options.value : internal state
  setValue: (value: number) => void;   // controlled ? options.onChange : setState
  handleChange: (event: React.SyntheticEvent, value: number) => void;
  tabsProps: { value: number; onChange: (e: React.SyntheticEvent, v: number) => void };
  getTabProps: (index: number) => { id: string; "aria-controls": string };
  getTabPanelProps: (index: number) => { value: number; index: number };
};
```

Controlled mode is keyed on `options?.value !== undefined`. Internal state still exists but is not read while controlled (no conditional hook). The a11y id scheme (`tab-${index}` / `tabpanel-${index}`) is unchanged — that is precisely why Help drives the primitive instead of hand-rolling `tabsProps`.

### `@portalai/core/content` — the shared entry slug (edit)

The module stays **pure data with zero imports**, per its header. Added to `packages/core/src/content/glossary.util.ts` and re-exported by the existing barrel:

```ts
/**
 * The URL-safe slug for a glossary term or FAQ question. It is a **contract**,
 * not a display detail: it appears in `#glossary-entry-<slug>` /
 * `#faq-entry-<slug>` Help fragments (#365) and in the `data-testid` of both
 * Help lists, and the API-side assistant (#367) builds those same URLs from
 * this function. Two copies that must agree byte-for-byte across a network
 * boundary would be a bug; this is the single source.
 */
export const contentEntrySlug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
```

This is `FAQList`'s current `slugifyQuestion` (`:23-27`) verbatim. It **supersedes** `GlossaryList`'s looser `slugifyTerm` (`:77-78`, whitespace-only replacement); every one of the 38 current glossary terms is alphanumeric-plus-space, so both rules produce identical output today and no existing `data-testid` assertion changes (`GlossaryList.test.tsx:37-115`, `FAQList.test.tsx:32-35`). A pinning test locks that equivalence. Both private slugifiers are **deleted** — no aliases (`feedback_no_compat_aliases`).

### `apps/web/src/components/GlossaryList.component.tsx` (edit)

```ts
export interface GlossaryListProps {
  entries: GlossaryEntry[];
  onSelectTerm?: (term: string) => void;
  /** Slugs whose accordion is expanded. Controlled — the consumer owns it. */
  expandedSlugs: ReadonlySet<string>;
  onToggleEntry: (slug: string) => void;
  /** Ref registry keyed by **slug** (was: term) so it matches the anchor. */
  registerEntryRef?: (slug: string, el: HTMLElement | null) => void;
}
```

`<Accordion expanded={expandedSlugs.has(slug)} onChange={() => onToggleEntry(slug)}>` replaces `defaultExpanded={expanded}` (`:111`). This also fixes the latent bug the discovery found: an already-mounted accordion ignored a later `expandedTerm` change, so the cross-tab jump scrolled to a term without opening it.

### `apps/web/src/components/FAQEntryAccordion.component.tsx` (new)

`FAQEntryAccordion` moves out of `FAQList.component.tsx:44-93` — the Component File Policy forbids inline helper components, and this is the change that grows it. Single pure-UI component, all data via props:

```ts
export interface FAQEntryAccordionProps {
  entry: FAQEntry;
  expanded: boolean;
  onToggle: () => void;
  onSelectTerm?: (term: string) => void;
  registerEntryRef?: (slug: string, el: HTMLElement | null) => void;
}
```

Rendering (question summary, `whiteSpace: "pre-line"` answer, related-term buttons, `data-testid={`faq-entry-${slug}`}`) is carried over unchanged.

### `apps/web/src/components/FAQList.component.tsx` (edit)

```ts
export interface FAQListProps {
  entries: FAQEntry[];
  groupByCategory?: boolean;
  onSelectTerm?: (term: string) => void;
  expandedSlugs: ReadonlySet<string>;
  onToggleEntry: (slug: string) => void;
  registerEntryRef?: (slug: string, el: HTMLElement | null) => void;
}
```

Both render paths (flat `:110-122` and grouped `:126-146`) delegate to the extracted `FAQEntryAccordion`. `groupByCategory` semantics are unchanged.

### `apps/web/src/views/Help.view.tsx` (edit)

**Pure UI** — every route input arrives as a prop; nothing reads a router.

```ts
export interface HelpViewUIProps {
  steps: GettingStartedStep[];
  glossaryEntries: GlossaryEntry[];
  faqEntries: FAQEntry[];
  onNavigate: (route: string) => void;
  /** Resolved tab index (0–2). The URL is the source of truth. */
  tabIndex: number;
  /** Active chip per tab; `null` = "All". */
  glossaryCategory: GlossaryCategory | null;
  faqCategory: FAQCategory | null;
  /** Resolved `#…-entry-<slug>` target, if any. */
  anchor: HelpAnchor | null;
  onTabChange: (tab: HelpTab) => void;
  onCategoryChange: (tab: HelpTab, category: HelpCategory | null) => void;
}
```

Behavior:

- `useTabs(0, { value: tabIndex, onChange: (i) => onTabChange(HELP_TAB_SLUG[i]) })` — controlled.
- Chips call `onCategoryChange(tab, next)`; a chip already active toggles to `null` (current behavior, `:177-179`, `:214-216`) — the container turns `null` into an omitted param.
- `searchQuery` remains local `useState` and still hides on Getting Started (`:129`).
- `expandedSlugs` is local `useState<Set<string>>`, **seeded from `anchor`** and re-seeded when `anchor` changes; `onToggleEntry` adds/removes. User toggles are not written to the URL.
- When `anchor` is set, the anchored surface renders with **no category filter** (Q1) — the anchor outranks it, the same "clear filters so the chosen entry is guaranteed visible" rule the cross-tab jump uses today (`:103-105`).
- Scroll: the existing `glossaryEntryRefs` map becomes one `entryRefs` map keyed by `` `${surface}-entry-${slug}` ``; on `anchor` change, `requestAnimationFrame(() => ref?.scrollIntoView({behavior: "smooth", block: "start"}))` — preserved from `:109-112`. A slug matching no entry is a no-op.
- `handleSelectGlossaryTerm(term)` (Q2) now calls `onCategoryChange`-adjacent navigation through a single prop callback: it invokes `onTabChange`/`onCategoryChange` semantics via the container by calling the new `onSelectTerm` path — concretely, `HelpViewUI` calls `props.onNavigateToEntry({surface: HelpTab.Glossary, slug: contentEntrySlug(term)})`, so a related-term click and a pasted deep link travel the same code path. (Add `onNavigateToEntry: (anchor: HelpAnchor) => void` to the props above.)

**Container** — the only router-aware code:

```ts
export const HelpView: React.FC = () => {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const hash = useLocation({ select: (l) => l.hash });
  // normalizeHelpSearch again (defensive + keeps the view renderable under a
  // router that never ran validateSearch, e.g. the shared test router).
  ...
};
```

Navigation writes:

| Trigger | Navigation |
|---|---|
| `onTabChange(tab)` | `navigate({ to: "/help", search: { tab }, hash: undefined })` — **push** |
| `onCategoryChange(tab, cat)` | `navigate({ to: "/help", search: { tab, category: cat ?? undefined }, hash: undefined, replace: true })` |
| `onNavigateToEntry(anchor)` | `navigate({ to: "/help", search: { tab: anchor.surface }, hash: helpAnchorHash(anchor) })` — **push** |

`tab: HelpTab.GettingStarted` is written as an explicit param (not omitted) so back/forward across the default tab is symmetrical.

### `apps/web/src/components/PortalSession.component.tsx` (edit)

`:159-166` becomes the `Link` + `MuiLink component="span"` form, for the reason recorded in `UpgradeLink.component.tsx:23-30` — `MuiLink component={Link}` erases the router generic and collapses `search` to `never`:

```tsx
<Link
  to="/help"
  search={{ tab: HelpTab.Faq, category: FAQCategory.Analytics }}
  style={{ textDecoration: "none" }}
  data-testid="portal-session-empty-help-link"
>
  <MuiLink component="span" variant="body2" sx={{ cursor: "pointer" }}>
    Learn what portal sessions can do →
  </MuiLink>
</Link>
```

The `data-testid` moves to the anchor so the existing selector still resolves to the element carrying `href`. Rendered href: `/help?tab=faq&category=analytics`.

## Migration / Seed

None — no DB schema change, no new table, no seed. Stated explicitly because the house spec template asks.

## TDD test plan

Run via npm scripts only (`feedback_use_npm_test_scripts`): `cd packages/core && npm run test:unit`, `cd apps/web && npm run test:unit`. Never raw jest — the missing `NODE_OPTIONS` breaks ESM.

### Layer 1 — `@portalai/core` (`packages/core/src/__tests__/`)

1. `contentEntrySlug` lowercases, collapses runs of non-alphanumerics to a single `-`, and trims leading/trailing `-` (`"Portal Result"` → `portal-result`, `"How do I connect?"` → `how-do-i-connect`).
2. **Pinning:** every `GLOSSARY_ENTRIES` term slugs to the same value the old whitespace-only rule produced — the guarantee that no `data-testid` changes.
3. **Pinning:** every `FAQ_ENTRIES` question slugs to a non-empty, unique value (uniqueness matters: a duplicate slug makes an anchor ambiguous).
4. `useTabs()` with no options is uncontrolled — `handleChange` updates `value`; `setValue` updates `value`.
5. `useTabs(0, {value: 2, onChange})` is controlled — `value`/`tabsProps.value` are `2`; `handleChange` calls `onChange(1)` and does **not** change the rendered value; `setValue(1)` also routes to `onChange`.
6. `getTabProps`/`getTabPanelProps` a11y ids are unchanged in both modes.

### Layer 2 — resolvers (`apps/web/src/__tests__/routes.util.test.ts`, extend)

7. `normalizeHelpSearch` maps each valid `tab` slug through; unknown → `undefined`.
8. Category kept when it belongs to the resolved tab's enum (`faq`+`analytics`, `glossary`+`data-modeling`).
9. Category dropped on a mismatched pair (`faq`+`data-modeling`) while the tab survives.
10. Category dropped when `tab` is absent or Getting Started.
11. Non-string / array / object garbage in either param → `undefined`, no throw.
12. `helpTabIndexFromSearch` → `HELP_TAB_INDEX` value; `{}` → `0`.
13. `parseHelpAnchor` accepts both `#faq-entry-x` and `faq-entry-x`; rejects `#faq-x`, `#getting-started-entry-x`, `""`, `undefined`.
14. `helpAnchorHash` round-trips with `parseHelpAnchor`.

### Layer 3 — route contract (`apps/web/src/__tests__/HelpRoute.test.tsx`, new)

One router-registered test file — a `createRootRoute` + a child route at `/help` carrying the **real** `validateSearch`, driven by `createMemoryHistory`. This is the only place the route's own declaration is exercised; `test-utils.tsx` is untouched (Q3).

15. Every row of the URL grammar table above resolves to the expected `{tab, category}` (parametrized).
16. `/help?tab=nonsense&category=nonsense` renders Help with the Getting Started tab selected — no error boundary, no blank render.

### Layer 4 — `HelpViewUI` behavior (`apps/web/src/__tests__/HelpView.test.tsx`, extend)

Prop-driven, no router needed.

17. `tabIndex={2}` renders with FAQ `aria-selected="true"` and no Getting Started flash (first paint asserted).
18. `faqCategory={FAQCategory.Analytics}` renders the Analytics & Portals chip active and the list ungrouped (`groupByCategory={false}`).
19. `glossaryCategory={GlossaryCategory.Analytics}` renders the Analytics chip active on the Glossary tab.
20. Clicking a tab calls `onTabChange` with the right `HelpTab` slug and does **not** move the tab on its own (controlled).
21. Clicking a chip calls `onCategoryChange(tab, category)`; clicking the active chip calls it with `null`; "All" calls it with `null`.
22. `anchor={{surface: Faq, slug}}` renders that entry expanded and calls `scrollIntoView` on its ref (jsdom stub).
23. `anchor` present **overrides** a passed category — the anchored list renders unfiltered.
24. `anchor` with an unknown slug renders normally, expands nothing, scrolls nothing, throws nothing.
25. Clicking a related glossary term calls `onNavigateToEntry({surface: Glossary, slug})` (Q2) rather than mutating internal tab state.
26. Manual accordion toggling still expands/collapses independently of the anchor.
27. The search box is hidden on Getting Started and shown on the other two tabs (regression on `:129`).

### Layer 5 — container navigation (`apps/web/src/__tests__/HelpView.test.tsx`, same file)

Router mocked at the `useNavigate` boundary, as `HttpErrorComponent.test.tsx:14-30` does.

28. `onTabChange` → `navigate({to: "/help", search: {tab}, hash: undefined})` **without** `replace`.
29. `onCategoryChange` → `navigate({… replace: true})`; a `null` category omits the param.
30. `onNavigateToEntry` → `navigate({to: "/help", search: {tab: surface}, hash: "<surface>-entry-<slug>"})`.

### Layer 6 — lists (`GlossaryList.test.tsx`, `FAQList.test.tsx`, extend)

31. `GlossaryList` expands exactly the entries in `expandedSlugs`; a change to that set re-renders expansion **without a remount** (the old `defaultExpanded` bug).
32. `GlossaryList` clicking an accordion calls `onToggleEntry(slug)`.
33. `registerEntryRef` is called with the **slug** (not the term) and a null on unmount.
34. `FAQList` (flat and `groupByCategory`) expands per `expandedSlugs` and calls `onToggleEntry`.
35. Existing `data-testid` assertions in both files still pass unchanged (the slug-unification guarantee).

### Layer 7 — the repointed link (`PortalSession.test.tsx` or `HelpDeepLink.test.tsx`)

36. The portal empty state renders `portal-session-empty-help-link` with `href="/help?tab=faq&category=analytics"` — exact-href assertion, the `UpgradeLink.test.tsx:11` pattern.

**Totals:** ~6 core, ~8 resolver, ~2 route, ~14 view/container, ~5 list, ~1 link ≈ **36 cases**.

## Acceptance criteria

- [ ] Every case above passes; existing suites green; `npm run lint && npm run type-check && npm run format:check` clean at repo root.
- [ ] `/help?tab=faq&category=analytics` opens the FAQ tab with the Analytics & Portals chip active, with no intermediate render of Getting Started.
- [ ] The portal empty state's "Learn what portal sessions can do →" lands on exactly that view.
- [ ] `/help?tab=glossary&category=analytics` opens the Glossary tab with the Analytics chip active.
- [ ] `/help` alone still opens Getting Started, unchanged.
- [ ] `/help?tab=nonsense&category=nonsense` opens Getting Started with no error boundary or blank page.
- [ ] `/help?tab=faq&category=data-modeling` opens FAQ with no category filter.
- [ ] `/help#faq-entry-<slug>` opens the FAQ tab with that entry expanded and scrolled into view; an unknown slug is a silent no-op.
- [ ] Switching tabs updates the address bar and the browser back button returns to the previous tab; chip changes do not accumulate history entries.
- [ ] Clicking a related glossary term from a FAQ answer switches tabs, expands and scrolls to the term, **and** the URL reflects that destination.
- [ ] The sidebar's Help selected state still resolves with search params present.
- [ ] `useTabs` callers outside Help behave identically (Settings tabs unchanged).
- [ ] No glossary/FAQ entry text is modified on this branch.

## Risks & rollback

| Risk | Detection / mitigation |
|---|---|
| `<Link to="/help" search={…}>` fails to type-check because the layout route (D1) isn't where TanStack resolves `/help`'s search. | Caught by `npm run type-check` on the link site. Fix is a one-line move of `validateSearch` to `help.index.tsx`; case 36's exact-href assertion proves whichever is right. |
| The generated `routeTree.gen.ts` churns when `validateSearch` is added. | Regenerate on save (never hand-format — CLAUDE.md excludes it from Prettier) and commit as part of the same slice. |
| The controlled `useTabs` change regresses Settings or another caller. | Case 4/6 pin uncontrolled behavior; the widening is additive (`options` omitted ⇒ identical code path). Full `apps/web` suite is the backstop. |
| Slug unification changes a `data-testid` and breaks unrelated tests. | Case 2/3 pin equivalence across all 38 terms + every FAQ question **before** the swap lands (slice ordering). Verified today: all current terms are alphanumeric-plus-space. |
| Controlled accordions lose the user's manual expansion when the URL changes. | `expandedSlugs` is re-seeded only when `anchor` changes, not on every render; case 26 asserts manual toggling survives. |
| An anchor points at an entry #366 later renames, silently scrolling nowhere. | Fail-open by design (case 24). The shared `contentEntrySlug` is what keeps #367's generated links in step; a renamed term is a #366 concern, and the epic's Status table is where that coupling is tracked. |
| Two-way sync causes a navigation loop (URL → state → URL). | The UI never navigates from a render — only from user events. Cases 28–30 assert one `navigate` call per interaction. |

**Rollback:** `git revert` the branch. No migration, no persisted state, no server change; the only durable artifact is a bookmark, which reverts to landing on Getting Started.

## Files touched

**`packages/core`** — edit `src/ui/Tabs.tsx` (controlled mode), `src/content/glossary.util.ts` (`contentEntrySlug`); new/extend `src/__tests__/` cases for both.

**`apps/web`** — new: `src/components/FAQEntryAccordion.component.tsx`, `src/__tests__/HelpRoute.test.tsx`. Edit: `src/utils/routes.util.ts`, `src/routes/help.tsx`, `src/routeTree.gen.ts` (generated), `src/views/Help.view.tsx`, `src/components/GlossaryList.component.tsx`, `src/components/FAQList.component.tsx`, `src/components/PortalSession.component.tsx`, and the tests `routes.util.test.ts`, `HelpView.test.tsx`, `GlossaryList.test.tsx`, `FAQList.test.tsx`, `PortalSession.test.tsx`.

No new dependency, no env var, no API change, no doc-surface change (the Help *content* is #366's; this ticket changes no user-facing copy).

## Next step

`docs/HELP_URL_ADDRESSABLE_SECTIONS.plan.md` — six TDD slices on this branch, ordered so nothing user-visible moves until the primitives are green: (1) resolvers + `validateSearch`; (2) `useTabs` controlled mode; (3) `contentEntrySlug` promoted and both slugifiers deleted; (4) `HelpViewUI` prop-driven + container URL read/write; (5) controlled expansion + anchor scroll + the `FAQEntryAccordion` extraction; (6) the repointed portal link. Slices 1–3 are behavior-neutral; the render-path change is isolated to 4–5.
