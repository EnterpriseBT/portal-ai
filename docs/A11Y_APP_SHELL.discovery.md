# Accessibility: app shell, navigation and landmarks — Discovery

**Issue:** [EnterpriseBT/portal-ai#797](https://github.com/EnterpriseBT/portal-ai/issues/797) · child of epic [#791](https://github.com/EnterpriseBT/portal-ai/issues/791), blocked by #792 (its inventory is the input).

**Why this exists.** Every signed-in page renders inside one shell: the header, the sidebar, the content area, toasts and the update banner. The portal chat renders inside a full-screen layout, and `/login` inside a public one. #792's audit (`docs/A11Y_AUDIT.md` → #797) charges this area with **93 rows and 670 instances**, by far the largest slice, plus six keyboard findings (KB-01 and KB-03 to KB-06). Most of it is the shell repeating on every route:
- **No landmarks:** no `<main>`, no `<nav>`, and no skip link (`region` 247 instances, `landmark-one-main` 23).
- **Unnamed sidebar entries:** 243 instances of `aria-command-name`, because a collapsed item drops its label.
- **Unnamed spinners:** 53 instances of `aria-progressbar-name`.
- **Heading order:** the brand is an `h3` sitting before every page's `h1`.
- **Faint or missing focus rings.**

Until the shell is fixed, every other area's walk still fails on the chrome around it.

This is the ticket that makes the shell a correct frame for every page:
- landmarks and a skip link;
- named, link-based navigation;
- focus and title on route change;
- visible focus and AA contrast in both themes;
- toasts, the update banner and the shared loading and error primitives that announce themselves;
- the portal chat as an APG log with a labelled composer.

## The current shape

### Layouts and landmarks

| Piece | Location | Note |
|---|---|---|
| Root route | `apps/web/src/routes/__root.tsx:15-54` | A bare `<Outlet/>`. Its pending, notFound and error components wrap `LoadingView`, `NotFoundView` and `ServerErrorView` in `AuthorizedLayout`. There's no pathless `_authorized` route: each route file wraps itself (`routes/login.tsx:11` → `PublicLayout`, `routes/portals.$portalId.tsx:15` → `FullScreenLayout`). |
| Signed-in shell | `apps/web/src/layouts/Authorized.layout.tsx:24-68` | An `AppBar` (implicit `banner`) holding the mobile toggle, a brand `Link` around `Typography variant="h3"` (42), and `ThemeSwitcher` and `HeaderMenu` (49-50). Then `SidebarNav` (55), then content in a plain `Box` (56-68). **No `<main>`, no `<nav>`, no skip link.** |
| Public shell | `apps/web/src/layouts/Public.layout.tsx:27-41` | The same AppBar with the `h3` brand, and content in a `Box`. |
| Full-screen | `apps/web/src/layouts/FullScreen.layout.tsx:9` | One flex `Box`. The portal session renders here. |
| Update banner | `apps/web/src/Application.tsx:17-18` | Mounted outside the router, beside `RouterProvider`. |
| Page titles | — | **`document.title` is never set.** A grep over web and core finds only `replaceState(…, document.title, …)` in `providers/Auth.provider.tsx`. Every tab reads "Portals AI". There's also no focus handling on navigation. |

### Sidebar

| Piece | Location | Note |
|---|---|---|
| Items | `apps/web/src/components/SidebarNav.component.tsx:38-111` | `NAV_ITEMS`/`PAGE_NAV` hold `{route, label, icon, match}`. |
| Drawer | `SidebarNav.component.tsx:131-220` | A `variant="permanent"` MUI `Drawer`, not a `nav`. Items navigate through `router.navigate` in `handleClick` (230-233), so they have **no href**. The version caption (260-277) is a clickable `Typography` that can't take focus. |
| Item | `apps/web/src/components/SidebarNavItem.component.tsx:56-74` | An MUI `ListItemButton` (`div[role=button]`). When collapsed, `{!collapsed && <ListItemText …/>}` (70) removes the label, and nothing else names the item. |
| Collapse state | `apps/web/src/providers/Layout.provider.tsx:21-26` | `useStorage("sidebar-state")`, default `"collapsed"`, so items are unnamed by default. |
| Toggle | `apps/web/src/components/SidebarNavToggle.component.tsx:23-34` | `aria-label="toggle sidebar"`, with no `aria-expanded`/`aria-controls`. The desktop compact variant is `theme.spacing(2)` × 32 = **16×32 px** (KB-06). |

### Header controls

| Piece | Location | Note |
|---|---|---|
| Theme switcher | `apps/web/src/components/ThemeSwitcher.component.tsx:53-87` | `IconButton` plus MUI `Menu`. The selection is shown with `selected`, not `menuitemradio`/`aria-checked`. Visible focus is MUI's ripple only (KB-04). |
| Account menu | `apps/web/src/components/HeaderMenu.component.tsx:42-112` | Its `aria-label="account menu"` hides the visible user name, the `label-content-name-mismatch` on 20 routes. `Avatar alt={label}` repeats the name (`image-redundant-alt`). |
| Org switcher | `apps/web/src/components/OrgSwitcher.component.tsx:44-77` | With two or more orgs it's a `Select` inside the account `Menu`. A non-menu-item control inside `role=menu` breaks the APG menu pattern. |

### Toasts, banner, chat

| Piece | Location | Note |
|---|---|---|
| Toast queue | `apps/web/src/providers/Toast.provider.tsx:108-158` | Errors persist with no timer. |
| Toast host | `apps/web/src/components/ToastHost.component.tsx:41-109` | Returns `null` when idle, so **there's no live region in the DOM before the first toast**. Every `Alert` gets `role="alert"`, so a success announces assertively. It portals to the end of the body: a keyboard user reaches a persistent error only by tabbing through the whole page. |
| Update banner | `apps/web/src/components/UpdateBanner.component.tsx:32-57` | An `Alert` (implicit `role=alert`) with Dismiss and Reload, and no focus path. A recorded exception to the toast rule (CLAUDE.md "Toast Pattern"). |
| Chat feed | `apps/web/src/components/ChatWindow.component.tsx:210-220` | A scrolling `Box` with no `role="log"` and no label. |
| Composer | `ChatWindow.component.tsx:287-300` | A multiline `TextField` with `autoFocus` and **only a placeholder**. Its icon buttons are labelled (308-337). |
| Streaming | `apps/web/src/components/PortalSession.component.tsx:60-170` | Streaming blocks render as plain `Box`es. `TypingIndicator` is `role="status"` (`TypingIndicator.component.tsx:45`). The empty state is an `h6` (170). |

### Status primitives and headings

| Piece | Location | Note |
|---|---|---|
| `LoadingView` | `apps/web/src/views/Loading.view.tsx:5-6` | A bare `CircularProgress`. There are **31** raw `<CircularProgress` uses across web and core, none named. |
| `StatusMessage` | `packages/core/src/ui/StatusMessage.tsx:54-77` | A spinner or icon plus `body2` text, with no `role`. |
| `DataResult` | `apps/web/src/components/DataResult.component.tsx:37-105` | Error and loading render through `StatusMessage`. It has about 35 call sites, and on detail pages it replaces the whole page, `PageHeader` included, so the error and loading states have no `h1` (`page-has-heading-one`, 8 routes). |
| `PageHeader` | `packages/core/src/ui/PageHeader.tsx:85-93` | The title is a real `h1`, used by about 24 views. |

### Themes

| Piece | Location | Note |
|---|---|---|
| Palettes | `packages/core/src/assets/themes/brand-theme.json`, `brand-theme-dark.json` | Built in `packages/core/src/ui/ThemeProvider.tsx:11-25`. Light text secondary/disabled is `#4a4468`/`#9b96b8`; dark is `#c4bce8`/`#6e6890`. No `action` block is defined, so the MUI defaults apply. |
| Focus styles | same files | **No `MuiButtonBase` or `focusVisible` override** (only `MuiSlider`). `MuiIconButton` and `MuiListItemButton` style hover and selected only. |
| Site tokens | `apps/site/scripts/generate-tokens.mjs:1-36` | Reads the same JSONs into CSS custom properties, so a palette change reaches the site on its next build. |
| Sign-in | `apps/web/src/views/Login.view.tsx:4-16`, `LoginForm.component.tsx:79` | The form title is `h4` rendered as `h1`, but it comes after the banner's `h3`. |

## The design space

### Decision 1 — Landmarks and skip link

**A.** Make the existing layouts semantic:
- the content `Box` becomes `component="main"` with `id="main-content"` and `tabIndex={-1}`;
- the `Drawer`'s paper becomes a `nav` named "Primary";
- a visually hidden "Skip to main content" link becomes the first focusable element in each of the three layouts.

**B.** Add a new pathless `_authorized` layout route that owns the landmarks once, and move every route under it.

| | A | B |
|---|---|---|
| Files touched | 3 layouts | 41 route files plus the route tree |
| Risk | low | moves every route id |
| Covers `/login` and the portal | yes, per layout | no: they're not under `_authorized` |

**Lean: A.** The layouts already are the shared frame, and B would be a routing refactor this ticket doesn't need.

### Decision 2 — Sidebar items: buttons or links

**A.** Keep `ListItemButton` as a button, and add `aria-label={label}` plus a `Tooltip` when collapsed.

**B.** Render each item as a router link (`ListItemButton component={Link} to=…`): an `<a href>` with `aria-current="page"` on the match, plus `aria-label` and a `Tooltip` when collapsed. Parents that expand stay buttons with `aria-expanded`.

| | A | B |
|---|---|---|
| Fixes `aria-command-name` | yes | yes |
| Fixes KB-03's 2.4.4: it navigates, so it's a link | no | yes |
| Open in a new tab, real URLs | no | yes |
| Change | a label | the item's element type, `handleClick` goes away |

**Lean: B.** These entries navigate, so they're links. That also gives screen-reader users the current-page cue.

### Decision 3 — Page title and focus on route change

**A.** A static `head()` title on each route, rendered through TanStack Router's `<HeadContent/>` (1.170 supports it). Focus handling would be a separate piece.

**B.** One shell component, `RouteAnnouncer` (rendered by each layout). After a pathname change it:
1. waits for the page's `h1` inside `main`;
2. sets `document.title` to `"<h1 text> · Portals AI"`;
3. moves focus to that `h1` (`tabIndex={-1}`).

The first load sets the title but doesn't move focus. The title follows whatever the page shows, so a detail page's object name is in it.

**C.** A title map in a util, keyed by route id, plus B's focus move.

| | A | B | C |
|---|---|---|---|
| Unique per route (detail pages) | no: routes have no loaders to read a name from | yes: the `h1` is the object's name | no |
| New route needs | a `head()` | an `h1`, which axe already requires | a map entry |
| Focus on navigate | separate | same mechanism | same as B |

**Lean: B.** The `h1` is already the page's name and is unique per object, so this gives one source of truth.
- A test asserts that every manifest route renders an `h1`.
- The error and loading states get one too: see Decision 6.
- The org name stays out of the title, since titles land in browser history.

### Decision 4 — Visible focus and contrast

**A.** Add a global focus ring to the theme. `MuiButtonBase` gets `&.Mui-focusVisible { outline: 2px solid <focus token>; outline-offset: 2px }`, and inputs, links and `ListItemButton` get the same rule. The focus token is chosen to clear 3:1 against both backgrounds. Then adjust only the palette values that fail AA (text.secondary/disabled, divider, contained button text, dark `MuiButton`), keeping their hues. A core unit test computes contrast ratios for the token pairs a component actually renders, so a later palette edit can't regress.

**B.** Per-component focus styles in the shell only.

| | A | B |
|---|---|---|
| Covers every area's controls | yes | shell only |
| Regression guard | the contrast test | none |
| Site picks it up | yes, through the tokens | no |

**Lean: A.** The user confirmed that palette tokens may shift to meet AA, and a ring from the theme is the only fix that reaches every control. KB-05's faint sidebar focus becomes the same ring.

### Decision 5 — Toast announcements and keyboard reach

**A.** Make `ToastHost` render an always-present region, even when empty:
- a polite `role="status"` container for success and info;
- an assertive `role="alert"` container for error and warning;
- MUI's `Alert` given `role={undefined}` inside them, so nothing is announced twice.

The stack becomes a named `region` ("Notifications"). While an error toast is open, the skip-link menu gains "Skip to notifications". No focus is stolen.

**B.** Move focus to each new error toast.

**C.** A global hotkey (F6 or Alt+N) that jumps to notifications.

| | A | B | C |
|---|---|---|---|
| Steals focus mid-task | no | yes | no |
| Discoverable | in the skip-link menu and landmark list | — | needs documenting |
| Matches WCAG 4.1.3 status messages | yes | yes | needs A's region anyway |

**Lean: A.** The update banner gets the same treatment: a polite status, since it isn't urgent, plus a skip-link entry while it's shown.

### Decision 6 — Loading, error and empty primitives

**A.** Fix the shared pieces at the source:
- **Spinners:** the theme gets `MuiCircularProgress.defaultProps["aria-label"] = "Loading"`, which names all 31 raw spinners at once. `StatusMessage` passes its `message` as the name.
- **`StatusMessage`:** gets `role="status"`, or `role="alert"` for the error variant.
- **Headings:** `DataResult` accepts the page's title, so a detail view keeps its `PageHeader` (with a placeholder like "Connector" while loading) around the status instead of replacing it. That clears `page-has-heading-one` in the error and loading states.

**B.** Fix each call site.

**Lean: A.** One change at each shared source. Call sites that still need a title change are only the detail views the walk lists (8).

### Decision 7 — Header menus and headings

- **Account menu:**
  - Drop the `aria-label`, so the visible name labels the button (it was overriding the name, the mismatch on 20 routes).
  - Make the avatar `alt=""`, since the name is already in the button.
  - Turn the org `Select` into a "Switch organization" group of `menuitemradio` items with `aria-checked`.
- **Theme switcher:** make its items `menuitemradio`.
- **Brand mark:** stop rendering it as a heading (`component="span"`), so each page's `h1` is the first heading.
- **Stray `h6`s:** map them to the right level (`component`). The ones in other areas' components (`ToolpackMetadataModal`, `RegionDrawingStep`) stay with #793 and #795.

**Lean: as listed.** These are the APG menu-button and menu-radio patterns. The only visual change is the org list rendering as menu items instead of a select.

### Decision 8 — Portal chat

The feed gets `role="log"`, `aria-label="Conversation"` and `aria-busy` while streaming, so the reply is read once it completes rather than token by token. The composer gets a visible-or-hidden label ("Message"), and `lockedReason` is linked through `aria-describedby`. The empty-state `h6` becomes body text.

**Lean: as stated.** That's the APG log pattern.

## Tradeoff comparison

| | D1 semantic layouts | D2 links | D3 RouteAnnouncer | D4 theme ring + tokens | D5 live regions | D6 shared primitives | D7 menus | D8 chat log |
|---|---|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Packages | web | web | web | core (+ site via tokens) | web | core + web | web | web |
| New pattern | no | no | yes | yes (contrast test) | no | no | no | no |

## Recommendation

1. The three layouts render a skip link first, a `nav` named "Primary" (signed-in), and a `main#main-content` with `tabIndex={-1}`. `AppBar` stays the banner.
2. Sidebar entries render as router links with `aria-current="page"`. Collapsed entries carry `aria-label` and a `Tooltip`. The toggle gets `aria-expanded` and `aria-controls`, and a target of at least 24×24 px. The version caption becomes a button.
3. A `RouteAnnouncer` in each layout sets `document.title` to `"<h1> · Portals AI"` and focuses the page `h1` after every client-side navigation (not on first load).
4. The theme gets a 2px `focus-visible` outline on every `ButtonBase`, input and link, in a focus token that clears 3:1 in both themes. Failing palette values are adjusted, keeping their hues. A core test pins AA ratios for the rendered token pairs.
5. `ToastHost` always renders a named "Notifications" region, with a polite status container for success and info and an assertive alert container for error and warning. The skip-link menu offers "Skip to notifications" while an error toast or the update banner is shown.
6. `MuiCircularProgress` defaults to `aria-label="Loading"`. `StatusMessage` gets `role="status"`, or `alert` for errors, and names its spinner from its message. `DataResult` keeps a detail page's `PageHeader` around its loading and error states.
7. The account menu drops its overriding `aria-label` and the avatar's redundant alt. The org switcher and theme switcher become `menuitemradio` groups. The brand is no longer a heading.
8. The chat feed is a `role="log"` labelled "Conversation", with `aria-busy` while streaming. The composer is labelled "Message", with the lock reason as its description.
9. Done means:
   - the walk shows zero #797 rows in every state and theme;
   - KB-01 and KB-03 to KB-06 are re-walked and closed in `docs/A11Y_AUDIT.md`;
   - `expectNoAxeViolations` tests cover each changed shell component.

## Open questions

1. **Skip-link targets beyond main?** Lean: "Skip to main content" always, plus "Skip to notifications" only while something is there. A "skip to navigation" link isn't needed, since `nav` comes before `main` in tab order.
2. **Sidebar default state.** It defaults to collapsed (icons only). Should it default to expanded so labels show? Lean: keep collapsed (no redesign). A `Tooltip` plus `aria-label` meets 2.4.4 and 4.1.2, and the user's stored choice still wins.
3. **Success toast politeness.** Lean: success and info polite, error and warning assertive. That's the 4.1.3 pattern, and it stops a save confirmation from interrupting.
4. **Contrast for disabled controls.** WCAG exempts inactive components. Lean: leave `text.disabled` as it is unless the walk flags it, and fix only rendered text and UI that's active.
5. **What happens to KB-02 (auto-focused search)?** It belongs to #794 (`PaginationToolbar`). Lean: leave it there. RouteAnnouncer's focus move happens after the page renders, so where the two conflict, #794 drops the `autoFocus`.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A because this is client-side presentation only, with no shared state or writes.
- **Accuracy & auditability:** Lean: `docs/A11Y_AUDIT.md`, regenerated by `a11y:report`, is the record of truth. This ticket closes rows there, and #800's ACR reads it.
- **Failure modes:** Lean: fail-safe by construction.
  - RouteAnnouncer falls back to "Portals AI" and leaves focus alone when a page has no `h1`.
  - The live regions are always mounted, so no announcement depends on the toast queue's timing.
- **Scale & unbounded growth:** N/A because the shell's cost doesn't grow with data. The toast stack is already capped at 3.
- **Multi-tenancy:** Lean: the org name is kept out of `document.title`, since titles land in shared browser history. The org switcher's radio group shows only the caller's own memberships, as it does today.
- **Contract stability:** Lean: a new route needs only an `h1` and its layout to get a title, focus and landmarks. A new long-running notice uses `ToastHost`'s regions rather than its own `Snackbar`, which matches the existing toast rule.
- **Data lifecycle:** N/A because nothing is stored. The sidebar's collapsed state keeps its existing local-storage key.

## What this doesn't decide

- **Other areas' components:**
  - dialog fields (#793);
  - tables, `PaginationToolbar`'s auto-focus and the drag alternatives (#794, KB-02 and KB-07);
  - the RegionEditor (#795);
  - charts and maps (#796, KB-09);
  - the marketing site's own markup (#798).
  Each sees this ticket's palette and focus-ring changes for free.
- **Turning the walk into a gate:** that's #799.
- **A visual redesign:** palette values move only as far as AA needs.

## Next step

`docs/A11Y_APP_SHELL.spec.md` pins each piece's exact contract:
- the layout landmark markup;
- the `SidebarNavItem` link props;
- `RouteAnnouncer`'s behavior;
- the focus and palette tokens, with their target ratios;
- `ToastHost`'s regions;
- the `StatusMessage`/`DataResult` props.

`docs/A11Y_APP_SHELL.plan.md` then slices the work into about six TDD commits:
1. theme focus ring, palette and contrast test (core);
2. status primitives (core + web);
3. layouts, skip link and sidebar links;
4. RouteAnnouncer and titles;
5. toasts, banner, menus and chat;
6. re-walk, inventory regeneration and KB updates.
