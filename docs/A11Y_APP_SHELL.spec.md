# Accessibility: app shell, navigation and landmarks — Spec

This spec pins the contract for bringing the shared shell to WCAG 2.2 AA. It covers:
- the layouts' landmarks and skip links;
- link-based sidebar navigation;
- page titles and focus on route change;
- a theme-wide focus ring and an AA palette;
- announced toasts, update notice and status primitives;
- APG header menus;
- the portal chat as a labelled log.

Discovery: `docs/A11Y_APP_SHELL.discovery.md`. Issue: [#797](https://github.com/EnterpriseBT/portal-ai/issues/797), a child of epic #791. Input: #797's slice of `docs/A11Y_AUDIT.md` (93 rows, 670 instances; KB-01 and KB-03 to KB-06).

## Key decisions (flag for review)

1. **Landmarks live in the three existing layouts** (`Authorized`, `Public`, `FullScreen`). No layout route is added and no route file moves.
2. **Sidebar entries that navigate are links** (`<a href>` through the router's `Link`), with `aria-current="page"` on the match. Logout stays a button. Collapsed entries are named by `aria-label` and a `Tooltip`. The sidebar still defaults to collapsed.
3. **The page's `h1` is the title source.** `useRouteAnnouncer` sets `document.title` to `"<h1 text> · Portals AI"` and, after a client-side navigation (not on first load), focuses the `h1`. The org name never appears in the title.
4. **The focus ring and contrast come from the theme.** `buildTheme` adds the ring and the spinner's default name in code, on top of the JSON palettes. Palette values move only where a ratio test fails, keeping their hues. The test pins ratios, not hex values.
5. **Announcements never steal focus.** Success and info are polite, error and warning assertive. Keyboard users reach a notice through a skip link that appears only while one is shown.
6. **Status primitives are fixed at their source:** the theme names every `CircularProgress`, `StatusMessage` gets a role, and `DataResult` renders a visually hidden page `h1` while loading or failing.
7. **The open questions resolved as their leans:**
   - skip links are main always, and notifications only while present;
   - the sidebar stays collapsed by default;
   - success and info toasts are polite;
   - `text.disabled` is untouched (WCAG exempts inactive controls);
   - KB-02 (auto-focused search) stays with #794.

## Scope

### In scope
- `apps/web`: the three layouts, sidebar, header menus (account, org, theme), toasts, update banner, `DataResult`, `LoadingView`, the portal chat, and the sign-in page's headings.
- `packages/core`: the theme build (`ThemeProvider.tsx`), the two palette JSONs, `StatusMessage`, and a shared `visuallyHidden` style.
- `docs/A11Y_AUDIT.md`: the regenerated inventory, with KB-01 and KB-03 to KB-06 closed.

### Out of scope
- Other areas' components: dialogs (#793), tables and `PaginationToolbar`'s auto-focus (#794), RegionEditor (#795), charts and maps (#796), and site markup (#798).
- CI gates (#799) and visual redesign.

## Surface

### Core: theme build — `packages/core/src/ui/ThemeProvider.tsx`

`buildTheme(options)` becomes `responsiveFontSizes(createTheme(options, a11yComponents(base)))`, where `base = createTheme(options)` supplies the palette. Exported for tests:

```ts
/** The overrides every theme gets, whatever its JSON says. */
export function a11yComponents(theme: Theme): ThemeOptions;
export const FOCUS_RING_WIDTH = 2; // px
```

`a11yComponents` returns:
- **`MuiButtonBase.styleOverrides.root`:** `"&.Mui-focusVisible": { outline: "2px solid <palette.primary.main>", outlineOffset: 2 }`. That covers buttons, icon buttons, list items, menu items, tabs and chips.
- **`MuiLink.styleOverrides.root`:** the same ring under `"&:focus-visible"`.
- Inputs get no extra ring: outlined, filled and standard inputs already draw their own `.Mui-focused` border or underline.
- **`MuiCircularProgress.defaultProps`:** `{ "aria-label": "Loading" }`. A caller's own `aria-label` or `aria-labelledby` still wins.

Merging is deep: a JSON override for the same component keeps its other keys.

### Core: palettes — `packages/core/src/assets/themes/brand-theme{,-dark}.json`

Values change only until `theme-contrast.test.ts` passes. Measured today, these fail:

| Theme | Pair | Ratio now | Required |
|---|---|---|---|
| light | `warning.main` as text on `background.default`/`paper`, and `warning.contrastText` on `warning.main` | 2.69 / 2.57 | 4.5 |
| dark | `primary.contrastText` on `primary.main` (contained buttons) | 3.38 | 4.5 |
| dark | `secondary.contrastText` on `secondary.main` | 2.97 | 4.5 |
| dark | `info.contrastText` on `info.main` | 2.97 | 4.5 |
| dark | `success.contrastText` on `success.main` | 3.43 | 4.5 |
| dark | `error.main` as text on `background.default`/`paper` | 3.51 / 3.27 | 4.5 |

Fixes darken or lighten within the same hue, or swap a `contrastText` between the theme's near-white and near-black text values. `text.disabled` and `divider` aren't changed. `apps/site` picks the new values up through `scripts/generate-tokens.mjs` on its next build.

### Core: `StatusMessage` — `packages/core/src/ui/StatusMessage.tsx`

The props are unchanged. Rendering:
- **Role:** the root `Stack` gets `role="alert"` when `variant === "error"`, and `role="status"` otherwise (loading included).
- **Spinner name:** the loading spinner gets `aria-label={message ?? "Loading"}`, and the icon in non-loading variants gets `aria-hidden`.

### Core: `visuallyHidden` — `packages/core/src/ui/visually-hidden.ts` (new, exported from `@portalai/core/ui`)

`export const visuallyHidden: SxProps` is MUI's screen-reader-only recipe. It replaces the local copy in `apps/web/src/components/KeyValueTable.component.tsx:171`.

### Web: `SkipLinks` — `apps/web/src/components/SkipLinks.component.tsx` (new, pure UI)

```ts
export interface SkipLinkTarget { id: string; label: string }
export interface SkipLinksUIProps { targets: SkipLinkTarget[] }
export const SkipLinksUI: React.FC<SkipLinksUIProps>;
export const SkipLinks: React.FC; // container
```

- **UI:** renders `<nav aria-label="Skip links">` holding one `<a href="#<id>">` per target. Each link is visually hidden until focused, then shown top-left above the AppBar. Activating one focuses the element with that id (all targets are `tabIndex={-1}`).
- **Container:** the targets are always `{ id: "main-content", label: "Skip to main content" }`. While `useToastPresence() > 0` or `useUpdateNotice().open` holds, it adds `{ id: "notifications", label: "Skip to notifications" }`.

### Web: layouts — `apps/web/src/layouts/{Authorized,Public,FullScreen}.layout.tsx`

- **First child:** each layout renders `<SkipLinks />` first and calls `useRouteAnnouncer()`.
- **Content:** the content container becomes `component="main"` with `id="main-content"` and `tabIndex={-1}`, with no outline on programmatic focus. `FullScreenLayout` wraps its children in that `main`.
- **Brand:** the brand `Typography` in `Authorized` and `Public` becomes `component="span"`, keeping `variant="h3"` for its look, so no heading comes before the page's `h1`.

### Web: sidebar — `SidebarNav.component.tsx`, `SidebarNavItem.component.tsx`, `SidebarNavToggle.component.tsx`

- **Drawer:** `SidebarNavUI`'s drawer paper renders as `component="nav"` with `aria-label="Primary"` (via `slotProps.paper`). The version caption becomes `SidebarVersionCaptionUI` (new `components/SidebarVersionCaption.component.tsx`), a `ButtonBase` named by its visible text plus a visually hidden "(app version)". An `aria-label` of "App version" would break 2.5.3, since the name has to contain the visible text.
- **Item props:** `SidebarNavItemUIProps` gains `href?: string`.
  - **With `href`:** the `ListItemButton` renders `component={Link} to={href}`, with `aria-current="page"` when `selected`.
  - **`onClick`:** if given, it still runs on activation (mobile collapse) and never calls `navigate`.
  - **Without `href` (Logout):** it stays a button.
  - **Parents with children:** they stay buttons, with `aria-expanded={open}`.
- **Collapsed items:** an item carries `aria-label={label}` and is wrapped in `<Tooltip title={label} placement="right">`. Expanded items rely on their visible text.
- **`SidebarNav`:** passes `href={item.route}` (and Settings and Help's routes). `handleClick`'s `router.navigate` is removed, and the mobile collapse stays as `onClick`.
- **`SidebarNavToggleUI`:** gets `aria-expanded={!collapsed}` and `aria-controls="primary-nav"` (the drawer paper's id). The compact variant's hit area grows to at least 24×24 px with an invisible pseudo-element, so the 16 px visual is unchanged.

### Web: `useRouteAnnouncer` — `apps/web/src/utils/route-announcer.util.ts` (new)

A hook rather than a component: it renders nothing and owns effects, and the Component File Policy keeps a single-component file pure UI. Each layout calls `useRouteAnnouncer()`.

```ts
export const APP_NAME = "Portals AI";
export function pageTitle(h1Text: string | null | undefined): string; // "<trimmed> · Portals AI", or "Portals AI" when blank
export function useRouteAnnouncer(): void;
```

Behavior, keyed on `useRouterState({ select: s => s.location.pathname })`:
1. **On every pathname, first load included:** observe `#main-content`. Whenever its first `h1`'s text changes, set `document.title = pageTitle(text)`. With no `h1`, the title is `"Portals AI"`.
2. **After a pathname change (not first load):** once an `h1` exists inside `#main-content`, give it `tabIndex=-1` and focus it. If none appears within 5 s, focus `#main-content` instead.
   - Focus moves once per navigation. A later `h1` text change (loading, then the object's name) updates the title but doesn't refocus.
   - Focus is taken only if it's still where the navigation left it: the element focused when navigation began (the clicked link, captured on the router's `onBeforeNavigate`), `body`, or `main`. A user who has moved into a field or dialog since keeps their place.
   - The hook keys on the router's `resolvedLocation`, which changes once the new route has rendered. `location` changes first, while the old page's `h1` is still on screen.
3. **Cleanup:** disconnect the observer on pathname change and unmount.

### Web: `DataResult` — `apps/web/src/components/DataResult.component.tsx`

`DataResultProps` gains `pageTitle?: string`. When set, the loading and error branches render `<Box component="h1" sx={visuallyHidden}>{pageTitle}</Box>` before the status. The views the walk flags for `page-has-heading-one` in their loading and error states pass their noun (e.g. `pageTitle="Job"`): `ColumnDefinitionDetail`, `ConnectorInstance`, `EntityDetail`, `JobDetail`, `EntityRecordDetail`, `StationDetail` and `Toolpacks` (7 views; the inventory row's eighth route, `connectors`, didn't recur in the latest walk and is re-checked in slice 6).

### Web: `LoadingView` — `apps/web/src/views/Loading.view.tsx`

Its spinner relies on the theme default (`"Loading"`). It also renders a visually hidden `h1` reading "Loading", so the root pending state has a title.

### Web: notifications — `ToastHost.component.tsx`, `Toast.provider.tsx`, `toast.context.tsx`, `UpdateBanner.component.tsx`

- **One Notifications region.** `apps/web/src/utils/notifications-root.util.ts` exports `NOTIFICATIONS_ID = "notifications"` and `getNotificationsRoot()`, which creates `<section id="notifications" aria-label="Notifications" tabindex="-1">` on `<body>` on first use and returns it afterwards. Toasts and the update notice both portal into it.
- **`ToastHost` always renders** into that region, even with no toasts, so a test's render container stays empty when idle. It renders a fixed-position `Box` at `TOAST_ANCHOR` (the `Snackbar` is gone) holding:
  - a `Stack` with `aria-live="assertive"` for error and warning toasts;
  - a `Stack` with `aria-live="polite"` for success and info toasts.
  The regions use `aria-live`, not `role="alert"`/`role="status"`. The host is in the shared test harness, and an always-present `alert` role would answer every `queryByRole("alert")` in the app. Each `Alert` gets `role="none"`, so its region announces it once. `data-testid="toast-host"` is present only while toasts exist. The `+N more` row and Dismiss all are unchanged.
- **`toast.context.tsx`** adds `ToastPresenceContext` (a number, default 0) and `useToastPresence(): number`. `Toast.provider.tsx` provides the visible count. `ToastApi` is unchanged, so its identity stays stable.
- **Update notice:** a new `apps/web/src/utils/update-notice.context.tsx` exports:
  - `UpdateNoticeProvider`, which owns `useAppVersion()` once;
  - `useUpdateNotice(): { open: boolean; dismiss(): void }`.
  `Application.tsx` wraps `RouterProvider` and `UpdateBanner` in it, and `UpdateBanner` reads it instead of calling `useAppVersion` itself.
- **`UpdateBannerUI`:** its `Alert` becomes `role="status"` (polite). `UpdateBanner` portals it into `getNotificationsRoot()`, so "Skip to notifications" reaches it.

### Web: header menus

- **`HeaderMenuUI`:** the trigger drops `aria-label`. Its visible content (the name, or `"Account"` when there's no label) is the name. On `xs` the name is visually hidden rather than `display: none`, so it still names the button. `Avatar` gets `alt=""`. `aria-haspopup="menu"`. (This landed in slice 3: the layout's axe test needs it.)
- **`OrgSwitcherUI`:** with two or more memberships, it renders a `ListSubheader` "Organization", then one `MenuItem` per membership with `role="menuitemradio"` and `aria-checked={isCurrent}`. Activating a non-current item calls `onSwitch(id)`. The "Organization" subheader is `aria-hidden`, since a menu may only own menu items, groups and separators, and each radio already names its org. With one membership, it renders the name as a disabled `MenuItem`. The `Select` and the click-stopping `Box` are removed. `OrgSwitcherUIProps` is unchanged.
- **`ThemeSwitcherUI`:** each item is `role="menuitemradio"` with `aria-checked`, and the trigger has `aria-haspopup="menu"`.

### Web: portal chat — `ChatWindow.component.tsx`, `PortalSession.component.tsx`

- **Feed:** the scroll `Box` that holds `children` gets `role="log"`, `aria-label="Conversation"` and `aria-busy={Boolean(isStreaming)}`, using the existing `isStreaming` prop that `PortalSession` already passes.
- **Composer:** the `TextField` gets `label="Message"` with `slotProps.inputLabel.sx = visuallyHidden`. `lockedReason` stays its `helperText`, which MUI wires to `aria-describedby`. `autoFocus` stays: it's the page's primary input, and `useRouteAnnouncer` leaves focus where it already is.
- **Empty state:** the `h6` at `PortalSession.component.tsx:170` becomes `Typography variant="h6" component="p"`.

### Web: sign-in

No heading change is needed once the brand is a `span`: `LoginForm`'s `h1` becomes the first heading.

## Migration
## Seed

No schema, migration or seed change.

## TDD test plan

Run per package: `cd packages/core && npm run test:unit`, `cd apps/web && npm run test:unit`. Never invoke jest directly.

### Core
- `packages/core/src/__tests__/ui/theme-contrast.test.ts` (new), for each theme:
  - `text.primary`, `text.secondary` and each status `main` as text on `background.default` and `paper` are ≥ 4.5;
  - each `contrastText` on its `main` is ≥ 4.5;
  - the focus ring colour on both backgrounds is ≥ 3;
  - `text.disabled` is deliberately absent.
  **≈ 22**
- `packages/core/src/__tests__/ui/ThemeProvider.test.tsx`:
  - a focus-visible `ButtonBase` has the 2px outline in both themes;
  - an unnamed `CircularProgress` is named "Loading";
  - a caller's `aria-label` wins;
  - a JSON override for the same component survives the merge.
  **4**
- `packages/core/src/__tests__/ui/StatusMessage.test.tsx`:
  - error is `role=alert`, others `role=status`;
  - the loading spinner is named by its message;
  - `expectNoAxeViolations`.
  **4**

### Web
- `SkipLinks.test.tsx` (new):
  - the main link is first and focusable;
  - activating it focuses `#main-content`;
  - the notifications link appears only when presence > 0 or an update is open;
  - axe.
  **5**
- `Authorized.layout.test.tsx`, `PublicLayout.test.tsx` and a new `FullScreenLayout.test.tsx`:
  - one `main#main-content`;
  - one `nav` "Primary" (Authorized);
  - no heading before the page content;
  - axe on a layout with an `h1`.
  **8**
- `SidebarNavItem.test.tsx`:
  - an `href` renders a link with that href;
  - `aria-current="page"` when selected;
  - a collapsed item is named by its label and shows a tooltip on hover or focus;
  - a parent keeps `aria-expanded`;
  - Logout (no href) is a button;
  - axe collapsed and expanded.
  **7**
- `SidebarNav.test.tsx`:
  - items are links to their routes;
  - activating one on mobile collapses the drawer;
  - the version caption is a button named "App version".
  **3**
- `SidebarNavToggle.test.tsx`: `aria-expanded` follows collapsed, `aria-controls` names the drawer, and the compact hit area is ≥ 24px. **3**
- `route-announcer.util.test.tsx` (new):
  - `pageTitle` formats and falls back;
  - first load sets the title without moving focus;
  - navigation focuses the new `h1`;
  - a later `h1` text change updates the title without refocusing;
  - with no `h1`, focus falls back to `main` after the timeout;
  - focus already in an input isn't taken;
  - the org name never appears.
  **8**
- `DataResult.test.tsx`:
  - `pageTitle` renders a hidden `h1` in the loading and error branches;
  - it's absent on success and when not given.
  **3**
- `LoadingView.test.tsx`: a named progressbar and an `h1` "Loading". **2**
- `ToastHost.test.tsx`:
  - the region exists with no toasts;
  - success and info render in the polite container, error and warning in the assertive one;
  - the alerts carry no own role;
  - axe.
  **5**
- `toast.context.test.tsx` / `Toast.provider.test.tsx`: `useToastPresence` follows the visible count, and it's 0 with no provider. **2**
- `UpdateBanner.test.tsx`: `role=status`; renders inside `#notifications` when present; reads `useUpdateNotice`. **3**
- `HeaderMenu.test.tsx`: the trigger's name is the visible user name, the avatar is decorative, axe. **3**
- `OrgSwitcher.component.test.tsx`:
  - two or more orgs render `menuitemradio`s with one checked;
  - activating another calls `onSwitch`, and the current one doesn't;
  - one org renders a subheader;
  - there's no combobox.
  **4**
- `ThemeSwitcher.test.tsx`: items are `menuitemradio` and the current one is checked. **2**
- `ChatWindowUI.test.tsx`: the feed is a log named "Conversation", `aria-busy` while streaming, the composer is labelled "Message", the locked reason describes it, axe. **5**
- `KeyValueTable` tests stay green on core's `visuallyHidden`. **0 new**

### Walk and inventory (verification, not unit tests)
`npm run a11y:report` against the demo-seeded fixture org. #797's section of `docs/A11Y_AUDIT.md` must read "No automated findings." KB-01 and KB-03 to KB-06 are re-walked by keyboard and marked closed in the Keyboard pass table.

**Totals ≈ 93 cases.**

## Acceptance criteria

- [ ] On every app page, the first Tab reaches "Skip to main content", and activating it moves focus into `main`.
- [ ] The landmark list shows banner, "Primary" navigation and main on signed-in pages; banner and main on `/login`; and main on the portal.
- [ ] Every sidebar destination is a link with a name, collapsed or expanded, and the current page carries `aria-current="page"`.
- [ ] Each route's tab title is `"<page h1> · Portals AI"`, and client-side navigation moves focus to the new page's `h1`.
- [ ] Every interactive control shows a 2px focus ring in both themes.
- [ ] Theme contrast ratios pass AA for text and UI components (`theme-contrast.test.ts`).
- [ ] Toasts are announced (success and info politely, error and warning assertively), and "Skip to notifications" appears while one is shown or the update notice is up.
- [ ] Every loading spinner and status message is announced. Detail pages keep an `h1` while loading or failing.
- [ ] The account, org and theme menus follow APG menu-button and menu-radio patterns. The account button's name matches its visible text.
- [ ] The portal chat feed is a labelled log and its composer has a label.
- [ ] A fresh `npm run a11y:report` shows zero #797 rows in every state and theme. KB-01 and KB-03 to KB-06 are closed.
- [ ] No other area's row count rises.

## Risks & rollback

- **Focus theft.** If `useRouteAnnouncer` moves focus at the wrong time, it could pull focus out of a dialog or a field the page auto-focuses. It guards against both: it only moves focus when focus hasn't moved since the navigation began, and only once per navigation. Tests cover both cases. Rollback is removing the `useRouteAnnouncer()` calls from the layouts; titles and focus then go back to today's behavior.
- **Palette shifts are visible.** They're bounded by the ratio test and the same hues, and the site's next build carries them. They show up in screenshots and Storybook, not as breakage. Rollback is reverting the JSON values.
- **Sidebar links change click behavior.** A middle-click now opens a tab, which is intended. Gating (`visibleNavItems`) is untouched, and `SidebarNavGating.test.tsx` holds it.
- **The always-mounted toast region appears in every render.** Tests that snapshot the whole body may need updating, so `toast.harness.test.tsx` checks that the region holds no text when idle.
- **This isn't a security surface.** There's no data, auth or tenant change. The org name is kept out of `document.title`, which lands in browser history.

## Files touched

- **Core:**
  - `src/ui/ThemeProvider.tsx` (`a11yComponents`, `FOCUS_RING_WIDTH`);
  - `src/assets/themes/brand-theme.json`, `brand-theme-dark.json`;
  - `src/ui/StatusMessage.tsx`;
  - new `src/ui/visually-hidden.ts` and its `ui/index.ts` export;
  - tests: new `ui/theme-contrast.test.ts`, and `ThemeProvider.test.tsx` and `StatusMessage.test.tsx`.
- **Web, new:**
  - `components/SkipLinks.component.tsx`, `utils/route-announcer.util.ts`, `utils/update-notice.context.tsx`;
  - tests `SkipLinks.test.tsx`, `route-announcer.util.test.tsx`, `FullScreenLayout.test.tsx`.
- **Web, edited:**
  - the layouts: `layouts/Authorized.layout.tsx`, `Public.layout.tsx`, `FullScreen.layout.tsx`;
  - the sidebar: `components/SidebarNav.component.tsx`, `SidebarNavItem.component.tsx`, `SidebarNavToggle.component.tsx`;
  - header menus: `HeaderMenu.component.tsx`, `OrgSwitcher.component.tsx`, `ThemeSwitcher.component.tsx`;
  - notifications: `ToastHost.component.tsx`, `providers/Toast.provider.tsx`, `utils/toast.context.tsx`, `UpdateBanner.component.tsx`, `Application.tsx`;
  - page status: `DataResult.component.tsx`, `views/Loading.view.tsx`, the 7 flagged views (`pageTitle`), `KeyValueTable.component.tsx` (shared `visuallyHidden`);
  - portal chat: `ChatWindow.component.tsx`, `PortalSession.component.tsx`;
  - their tests listed above.
- **Docs:**
  - `docs/A11Y_AUDIT.md` (regenerated; KB rows closed);
  - `CLAUDE.md` Accessibility Requirements:
    - a new route needs an `h1`;
    - navigation is links;
    - a status message goes through `StatusMessage` or a toast, never a local live region;
  - `apps/web/README.md` (testing note on `useRouteAnnouncer`).

## Next step

`docs/A11Y_APP_SHELL.plan.md` sequences this into about six TDD slices on `feat/797-a11y-app-shell`:
1. Core: theme ring, spinner name, palette and the contrast test.
2. Core and web: `StatusMessage`, `visuallyHidden`, `DataResult.pageTitle` and `LoadingView`.
3. Web: layouts, skip links and sidebar links.
4. Web: `useRouteAnnouncer`.
5. Web: notifications (toast regions, presence, update notice), header menus and the chat.
6. Re-walk: `a11y:report`, the KB re-walk, and the docs.
