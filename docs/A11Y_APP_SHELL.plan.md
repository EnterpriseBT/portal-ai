# Accessibility: app shell, navigation and landmarks — Plan

**TDD-sequenced implementation of the accessible shell, in six slices:**
1. the theme's focus ring, spinner name and AA palette;
2. the shared status primitives;
3. landmarks, skip links and link-based sidebar navigation;
4. page titles and focus on route change;
5. announced notifications, APG header menus and the chat log;
6. a full re-walk that empties #797's slice of the inventory.

Spec: `docs/A11Y_APP_SHELL.spec.md`. Discovery: `docs/A11Y_APP_SHELL.discovery.md`. Issue: #797 (epic #791). Builds on **#792, merged into `epic/a11y-conformance`**: `npm run a11y:report`, `docs/A11Y_AUDIT.md`, and `expectNoAxeViolations` (web `test-utils`, core `__tests__/axe.util`).

Six slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/797-a11y-app-shell` / PR #969**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package. Never invoke jest directly (`feedback_use_npm_test_scripts`); narrow a run with `-- --testPathPattern <name>`:

```bash
cd packages/core && npm run test:unit
cd apps/web && npm run test:unit
```

Each slice:
1. Write the failing tests.
2. Make the smallest change that turns them green.
3. Do a focused run.
4. Run `npm run lint && npm run type-check` in each touched package at the boundary. A core change also needs `npm run build -w @portalai/core` first, so web type-checks against the new dist.
5. Move to the next slice.

**Sequencing rationale.** Shared foundations come before the shell that uses them, and the shell comes before behavior layered on it:

- **Slice 1, core theme.** It has no dependencies. Every later slice's axe tests assume the theme names spinners and draws a focus ring, so it goes first.
- **Slice 2, status primitives.** `visuallyHidden` lands here, and slices 3–5 reuse it (skip links, chat label). It's also where `DataResult` gets the hidden `h1` that slice 4's title logic reads.
- **Slice 3, landmarks and sidebar.** This creates `main#main-content`, which slice 4 observes. The skip-link container here offers "main" only; slice 5 adds the notifications target, which has no forward dependency.
- **Slice 4, `useRouteAnnouncer`.** It needs `#main-content` (slice 3) and page `h1`s in every state (slice 2).
- **Slice 5, notifications, menus and chat.** These are independent surfaces. They're grouped because each is small, and the skip link's notifications target needs the presence signals introduced here.
- **Slice 6, re-walk.** It measures the whole result, so it must come last. The other area children (#793–#796, #798) see the palette and focus ring once this PR merges into the epic.

---

## Slice 1 — Theme focus ring, spinner name and AA palette (core)

Every theme gets a 2px focus-visible ring and a named `CircularProgress`, and the palette values that fail AA move just enough to pass.

**Files**

- Edit: `packages/core/src/ui/ThemeProvider.tsx`: `a11yComponents(theme)` and `FOCUS_RING_WIDTH`; `buildTheme` merges them over the JSON options.
- Edit: `packages/core/src/assets/themes/brand-theme.json`, `brand-theme-dark.json`: the failing pairs from the spec's palette table.
- New: `packages/core/src/__tests__/ui/theme-contrast.test.ts`.
- Edit: `packages/core/src/__tests__/ui/ThemeProvider.test.tsx`.

**Steps**

1. **Tests (spec: Core, theme-contrast ≈ 22 and ThemeProvider 4).**
   - Ratio assertions for each theme, from `getContrastRatio`.
   - A focus-visible `ButtonBase` has the 2px outline in both themes.
   - An unnamed `CircularProgress` is named "Loading", and a caller's `aria-label` wins.
   - A JSON `MuiCircularProgress`/`MuiIconButton` override survives the merge.
   - Run them: the contrast cases fail on the pairs measured in the spec, and the ring and name cases fail.
2. **Implement** `a11yComponents` and the merge in `buildTheme`. Then change palette values one pair at a time until `theme-contrast` is green, staying within each hue and swapping `contrastText` between the theme's own text values where that is enough. Green.
3. Run core's full `test:unit` (snapshot or colour assertions elsewhere may name old hex values), then `lint` + `type-check`, then `npm run build -w @portalai/core`. Also run web's `type-check`, and web's `test:unit` with `--testPathPattern theme`, since `theme.util.test.tsx` reads the palettes.

**Done when:**
- `theme-contrast.test.ts` passes for both themes;
- the ring and name tests pass;
- core's full suite and web's theme tests are green.

**Risk:**
- Palette changes are visible. Keep each to the smallest step that passes, and record old → new values in the commit message for review.
- `apps/site` regenerates tokens from these JSONs on its next build. No site test pins hex values, but check `npm run build -w @portalai/site`.

---

## Slice 2 — Status primitives: `StatusMessage`, `visuallyHidden`, `DataResult`, `LoadingView`

Loading and error states announce themselves and keep a page heading.

**Files**

- New: `packages/core/src/ui/visually-hidden.ts`, plus its export from `packages/core/src/ui/index.ts`.
- Edit: `packages/core/src/ui/StatusMessage.tsx`: `role`, the spinner's name, a decorative icon.
- Edit: `apps/web/src/components/DataResult.component.tsx`: `pageTitle?: string` and the hidden `h1` in the loading and error branches.
- Edit: `apps/web/src/views/Loading.view.tsx`: a hidden `h1` reading "Loading".
- Edit: `apps/web/src/components/KeyValueTable.component.tsx`: use core's `visuallyHidden`, and drop the local copy.
- Edit: the 7 views that pass `pageTitle`: `ColumnDefinitionDetail`, `ConnectorInstance`, `EntityDetail`, `JobDetail`, `EntityRecordDetail`, `StationDetail`, `Toolpacks`.
- Tests: `packages/core/src/__tests__/ui/StatusMessage.test.tsx`, `apps/web/src/__tests__/DataResult.test.tsx`, `LoadingView.test.tsx`.

**Steps**

1. **Tests (spec: StatusMessage 4, DataResult 3, LoadingView 2).**
   - Error is `role=alert`, other variants `role=status`, and the loading spinner is named by its message.
   - `pageTitle` renders a hidden `h1` while loading or failing, and none on success or when it isn't given.
   - `LoadingView` has a named progressbar and an `h1`.
   - `expectNoAxeViolations` on each.
   - Run them; they fail.
2. **Implement** the four component changes and the 7 `pageTitle` call sites. Green.
3. Run the web tests of the 7 views (`--testPathPattern` on each view name), since an extra `h1` can break a `getByRole("heading", { level: 1 })` that expected exactly one. Then `lint` + `type-check` in core and web, and rebuild core.

**Done when:**
- the status cases pass;
- the 7 views' existing tests stay green;
- `KeyValueTable` tests pass on the shared style.

**Risk:**
- **Two `h1`s on success.** The hidden `h1` exists only in the loading and error branches, so a page never shows two at once. A test asserts it's absent on success.

---

## Slice 3 — Landmarks, skip link and link-based sidebar

Each layout exposes a banner, navigation and main, starts with a skip link, and has no heading before the page's `h1`. Sidebar destinations become named links.

**Files**

- New: `apps/web/src/components/SkipLinks.component.tsx` (`SkipLinksUI` + `SkipLinks`; the container returns the "main" target only in this slice).
- Edit: `apps/web/src/layouts/Authorized.layout.tsx`, `Public.layout.tsx`, `FullScreen.layout.tsx`: `<SkipLinks/>` first; `main#main-content tabIndex=-1`; the brand becomes `component="span"`.
- Edit: `apps/web/src/components/SidebarNav.component.tsx`:
  - the paper as `nav` "Primary" with `id="primary-nav"`;
  - `href` on items;
  - `router.navigate` removed;
  - the version caption becomes a `ButtonBase`.
- Edit: `apps/web/src/components/SidebarNavItem.component.tsx`: `href`, `component={Link}`, `aria-current`, the collapsed `aria-label` + `Tooltip`, `aria-expanded` on parents.
- Edit: `apps/web/src/components/SidebarNavToggle.component.tsx`: `aria-expanded`, `aria-controls`, a hit area of at least 24px.
- Tests:
  - new `SkipLinks.test.tsx` and `FullScreenLayout.test.tsx`;
  - `Authorized.layout.test.tsx`, `PublicLayout.test.tsx`;
  - `SidebarNavItem.test.tsx`, `SidebarNav.test.tsx`, `SidebarNavToggle.test.tsx`;
  - `SidebarNavGating.test.tsx` stays unchanged and must stay green.

**Steps**

1. **Tests.**
   - From the spec: SkipLinks 5 (minus the two notifications cases, which move to slice 5), layouts 8, SidebarNavItem 7, SidebarNav 3, toggle 3.
   - Additional assertions: `main#main-content` exists; `nav` is named "Primary"; items are links with hrefs and `aria-current`; collapsed items are named; Logout is a button; the toggle carries `aria-expanded`/`aria-controls` and a ≥ 24px hit area; axe passes on each layout and on collapsed and expanded items.
   - Run them; they fail.
2. **Implement.** Sidebar items render through the shared test router's `Link`, so render them with `renderWithProviders`' router. Green.
3. Run the broader web suites that touch the shell: `--testPathPattern "Sidebar|layout|Layout|Authorized|Login"`. Then `lint` + `type-check`.

**Done when:**
- every layout test shows the landmarks and a skip link that focuses `main`;
- sidebar items are named links;
- gating tests are unchanged and green.

**Risk:**
- **A test that drove navigation by `onClick` + `navigate`** now needs a router `Link`. Check `SidebarNav.test.tsx`'s mocks of `useRouter`.
- **Mobile behaviour.** The mobile drawer still collapses through `onClick` alongside the link's navigation.

---

## Slice 4 — `useRouteAnnouncer`: titles and focus on route change

Tab titles follow each page's `h1`, and client-side navigation moves focus to it.

**Files**

- New: `apps/web/src/utils/route-announcer.util.ts` (`APP_NAME`, `pageTitle`, `useRouteAnnouncer`).
- Edit: the three layouts: call `useRouteAnnouncer()`.
- New test: `apps/web/src/__tests__/route-announcer.util.test.tsx`.

**Steps**

1. **Tests (spec: useRouteAnnouncer 8).**
   - `pageTitle` formats and falls back.
   - First load sets the title without moving focus.
   - A navigation focuses the new `h1`.
   - A later `h1` text change updates the title and doesn't refocus.
   - With no `h1`, focus falls back to `main` after the timeout (fake timers).
   - Focus already in an input isn't taken.
   - The org name never appears (render with an org in context and assert the title).
   - Drive navigation through the test router's `navigate`. Run them; they fail.
2. **Implement** the observer and effect, keyed on `useRouterState`'s pathname. Green.
3. Re-run the layout tests from slice 3, then `lint` + `type-check`.

**Done when:** the 8 cases pass and the layout tests stay green.

**Risk:**
- **Stealing focus.** An effect that fires on every render could steal focus. The test that types into an input, then triggers a re-render without navigating, catches that.

---

## Slice 5 — Notifications, header menus and the portal chat

Toasts and the update notice announce through always-mounted regions and are reachable by a skip link. The account, org and theme menus follow APG, and the chat feed is a labelled log.

**Files**

- Edit: `apps/web/src/utils/toast.context.tsx`: `ToastPresenceContext`, `useToastPresence`.
- Edit: `apps/web/src/providers/Toast.provider.tsx`: provides the visible count.
- Edit: `apps/web/src/components/ToastHost.component.tsx`: an always-present `section#notifications` with polite and assertive containers, and `Alert role={undefined}`.
- New: `apps/web/src/utils/update-notice.context.tsx` (`UpdateNoticeProvider`, `useUpdateNotice`).
- Edit: `apps/web/src/Application.tsx`: wrap the app in `UpdateNoticeProvider`.
- Edit: `apps/web/src/components/UpdateBanner.component.tsx`: read `useUpdateNotice`, `role="status"`, its section portalled into `#notifications`.
- Edit: `apps/web/src/components/SkipLinks.component.tsx`: add the notifications target when presence > 0 or the notice is open.
- Edit: `HeaderMenu.component.tsx`, `OrgSwitcher.component.tsx`, `ThemeSwitcher.component.tsx`.
- Edit: `ChatWindow.component.tsx` (`role="log"`, `streaming` prop, composer label), `PortalSession.component.tsx` (pass `streaming`, empty-state `component="p"`).
- Tests:
  - `ToastHost.test.tsx`, `toast.context.test.tsx`, `Toast.provider.test.tsx`, `toast.harness.test.tsx`;
  - `UpdateBanner.test.tsx`, `SkipLinks.test.tsx` (the 2 notifications cases);
  - `HeaderMenu.test.tsx`, `OrgSwitcher.component.test.tsx`, `ThemeSwitcher.test.tsx`;
  - `ChatWindowUI.test.tsx`.

**Steps**

1. **Tests (spec: ToastHost 5, presence 2, UpdateBanner 3, SkipLinks' remaining 2, HeaderMenu 3, OrgSwitcher 4, ThemeSwitcher 2, ChatWindowUI 5).**
   - The region exists with no toasts.
   - Severities land in the right live container.
   - The banner is `role=status` and sits inside `#notifications`.
   - The skip link appears only while something is shown.
   - The account trigger is named by its visible text.
   - The org and theme items are `menuitemradio` with `aria-checked`.
   - The chat feed is a named log with `aria-busy`, and the composer is labelled.
   - Run them; they fail.
2. **Implement** in this order:
   1. presence and the toast regions;
   2. the update notice provider and banner;
   3. the skip-link target;
   4. the menus;
   5. the chat.
   Green.
3. Run the toast suites: `toast.migrations.test.ts`, `toast-error-message.guard.test.ts` and `toast.harness.test.tsx` check how toasts are raised. Also run the org-switch flow's tests (`--testPathPattern "Org|HeaderMenu|Theme"`) and the portal's (`--testPathPattern "Portal|Chat"`). Then `lint` + `type-check`.

**Done when:**
- the slice's cases pass;
- every existing toast, org, theme and portal suite is green;
- an idle `ToastHost` adds an empty region and nothing visible.

**Risk:**
- **Org-switch tests click a `Select`.** They move to clicking a menu item, and the `onSwitch` contract is unchanged.
- **The portal-chat UI file is two components already** (container + UI). The new `streaming` prop goes on the UI props and is passed by the container (Component File Policy).
- **Partial mocks.** `api.util` and the toast context are faked partially in some web tests (`project_web_partial_module_mocks`). Grep for mocks of `toast.context` before adding the new export.

---

## Slice 6 — Re-walk, inventory and docs

This proves the result in the browser and records it.

**Files**

- Edit: `docs/A11Y_AUDIT.md`: regenerated, plus the Keyboard pass rows KB-01 and KB-03 to KB-06 marked closed (with the commit that fixed each).
- Edit: `CLAUDE.md` → Accessibility Requirements:
  - a new route renders an `h1`, which `useRouteAnnouncer` uses for its title and focus;
  - navigation is a link;
  - a status message goes through `StatusMessage` or a toast, never a local live region;
  - the theme owns the focus ring.
- Edit: `apps/web/README.md`, the accessibility testing note: the skip links, `useRouteAnnouncer`, and how to test focus after navigation.

**Steps**

1. **Verification run (the spec's walk cases).** Rebuild core. Then run `npm run a11y:report` with the dev stack up, the demo-seeded fixture org, `e2e:auth:all`, and the site previewed.
   - Expected: #797's section reads "No automated findings".
   - Expected: no other owner's row count rises against the epic's committed doc.
   - Any remaining #797 row goes back to the slice that owns it (as a new failing test there), not to an ad-hoc fix here.
2. **Keyboard re-walk** of KB-01 and KB-03 to KB-06, as owner and member in both themes. Record each as closed, or re-open it with what was seen.
3. **Docs:** `CLAUDE.md`, `apps/web/README.md`. Then the full suites for core and web (`npm run test:unit` in each), `lint`, `type-check`, and the root `npm run build`.

**Done when:**
- the regenerated inventory has zero #797 rows;
- no other area's count rose;
- the KB rows are closed;
- the full suites, build, lint and type-check are green.

**Risk:**
- **Run-to-run variation in loading states.** Adversarial F6 showed this. If one loading-state row flickers, re-run once before treating it as real. A row present in both runs is real.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | Theme ring, spinner name, AA palette (core) | `theme-contrast` + ThemeProvider tests; core full suite; core build |
| 2 | `StatusMessage` roles, `visuallyHidden`, `DataResult.pageTitle`, `LoadingView` | status tests; 7 views' tests unchanged |
| 3 | Landmarks, skip link (main), sidebar links, toggle | layout + sidebar tests; gating test unchanged |
| 4 | `useRouteAnnouncer` | 8 announcer cases; layouts green |
| 5 | Toast/update regions, skip link (notifications), APG menus, chat log | toast, menu, org, portal suites green |
| 6 | `a11y:report` re-walk, KB re-walk, docs | zero #797 rows; no other area up; full suites + build |

## Cross-slice notes

- **Core changes need a rebuild before web sees them** (`project_stale_core_dist_after_branch_switch`): slices 1 and 2 end with `npm run build -w @portalai/core`. Run the root build once before pushing (`feedback_core_model_change_run_full_build`).
- **`visuallyHidden` is the one cross-slice symbol.** Introduced in slice 2, it's used in slices 3 (skip links), 5 (chat label) and 2 (`DataResult`).
- **The skip-link container grows in two steps:** "main" in slice 3, notifications in slice 5. Each slice's tests cover only what exists at its boundary.
- **Component File Policy.** `SkipLinks` is a container + UI pair. Title and focus handling is a hook (`useRouteAnnouncer` in `utils/`), not a component, so no single-component file holds wiring.
- **Every new or changed component test calls `expectNoAxeViolations`.** That's the per-component floor until #799 turns the walk into a gate.
- **Doc sync (CLAUDE.md "Keeping Documentation in Sync"):** `CLAUDE.md`'s Accessibility Requirements and `apps/web/README.md` are updated in slice 6.
  - **The Help content doesn't change:** no glossary or FAQ term changes, so `glossary.util.ts` and `faq.util.ts` stay as they are.
  - **The site's tokens change, its copy doesn't.**
- **The epic's other children** start from the epic after this merges, so they inherit the theme ring and palette. Their inventories shrink on their own first walk; no rows move between owners.

## Next step

Implementation begins on `feat/797-a11y-app-shell`, slice 1 first, tests first, one commit per slice, once this plan is confirmed.
