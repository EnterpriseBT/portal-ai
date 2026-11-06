# A11Y_APP_SHELL — Smoke Suite

Smoke test for [#797](https://github.com/EnterpriseBT/portal-ai/issues/797): the accessible app shell. It covers:
- landmarks and skip links;
- link-based sidebar navigation;
- page titles and focus on route change;
- the theme's focus ring and AA palette;
- announced toasts, update notice and status primitives;
- APG header menus;
- the portal chat log.

**Branch under test:** `feat/797-a11y-app-shell` (PR [#969](https://github.com/EnterpriseBT/portal-ai/pull/969)).

Every section is independent after preflight. Untagged steps are agent-walkable in a browser (`/smoke-walk`). Steps tagged `— manual` need a person (a screen reader, or visual judgment), and `— backend` steps run a command.

Two notes on where to run things:
- **Avoid list pages for focus checks.** List pages (Stations, Jobs, Connectors…) auto-focus their search field on load (KB-02, owned by #794), which takes focus before the skip link and before the post-navigation focus. Run the focus steps from the pages named here: Dashboard `/`, Help `/help`, Settings `/settings`.
- **The keyboard is what's under test.** Use Tab, Shift+Tab, Enter, the arrow keys and Escape; don't click where a step says "press".

## Preflight

### Environment
- [ ] `git checkout feat/797-a11y-app-shell && git pull --ff-only && npm install`. No migration.
- [ ] `npm run build -w @portalai/core` (the theme and `StatusMessage` changed), then `npm run dev`: web :3000, API :3001.
- [ ] For §10 only: the site is built and previewed on :3002 (`npm run build -w @portalai/site && npm run preview -w @portalai/site`).

### Fixtures
- [ ] The `e2e-fixture` org, demo-seeded (`npx portalai demo seed --org <id> --rows 2000 --env local --yes`), and `npm run e2e:auth:all -w @portalai/e2e`.
- [ ] The owner identity belongs to two orgs (`e2e-fixture` and one other), so the org switcher shows radios. The admin does too. The member belongs to one.

### Reset between runs
- [ ] §6 creates and then revokes one invitation, so revoke any left over in Settings → Members. Everything else is read-only. Clear `localStorage["portalai-theme"]` to return to the light theme.

## §1 — Skip link and landmarks

- [ ] As owner, open `/` and press Tab once. Expected: a "Skip to main content" link appears top-left, above the header, with a visible ring.
- [ ] Press Enter. Expected: focus is on `main#main-content` (`document.activeElement.id === "main-content"`), and the next Tab lands on the first control inside the page, not on the header or sidebar.
- [ ] On `/` the page has exactly one `main`, one `nav` named "Primary", and one `header` (banner). In DevTools: `document.querySelectorAll('main').length === 1` and `document.querySelector('nav[aria-label="Primary"]')` is non-null.
- [ ] Sign out and open `/login`. Expected: a skip link first, then a banner and a `main` holding the sign-in form. Its first heading is the form's `h1`, and the "Portals AI" brand isn't a heading.
- [ ] Open a portal (`/portals/<id>`; from a station, open or start a portal). Expected: the page content is inside `main#main-content`, behind a skip link.

## §2 — Sidebar navigation

- [ ] With the sidebar **collapsed** (the default), Tab into it. Expected: each item is announced as a **link** with a name ("Dashboard", "Stations", "Jobs"…), and its name shows as a tooltip on focus.
- [ ] The current page's item has `aria-current="page"` (on `/help`: the Help item).
- [ ] Expand the sidebar with its toggle. Expected: the toggle reports `aria-expanded="true"`, and the items show their labels and stay links.
- [ ] Middle-click (or Cmd/Ctrl+click) "Jobs". Expected: it opens in a new tab, since it's a real link now.
- [ ] The compact toggle on the drawer's edge (16 px wide) also responds to a click 3 px outside its left or right edge (24 px target).
- [ ] The footer's "Portalsai © 2026" is a button: Tab reaches it, Enter opens the App version dialog, and its accessible name is "Portalsai © 2026 (app version)".
- [ ] "Logout" is a button, not a link. — manual (activating it signs you out; check its role in DevTools instead)
- [ ] As member, the sidebar shows only the member's pages (7 links), all named.

## §3 — Titles and focus on navigation

- [ ] Open `/`. Expected: the tab title is "Dashboard · Portals AI", and focus is **not** moved on first load (it's on the body).
- [ ] From `/`, Tab to the sidebar's "Help" link and press Enter. Expected: the title becomes "Help · Portals AI", and focus is on the page's `h1` "Help" (a screen reader reads "Help, heading level 1").
- [ ] Navigate to a detail page whose data loads slowly: Settings → back to Dashboard → open a station from the Dashboard (or `/stations/<id>`). Expected: the title is "Station · Portals AI" while it loads, then "<station name> · Portals AI". Focus goes to the `h1`, unless the page's own search field auto-focuses (KB-02), in which case focus stays in that field.
- [ ] With DevTools open on `/settings`, check `document.title`. Expected: "Settings · Portals AI", with no organization name anywhere in the title.
- [ ] Use the browser's Back button. Expected: the title follows the page you return to.

## §4 — Focus ring and contrast

- [ ] On `/help`, in the light theme, Tab through the header (theme switcher, account button) and the sidebar links. Expected: each shows a solid 2px ring in the brand purple (`rgb(91, 63, 192)`), offset from the control.
- [ ] Switch to the dark theme (theme switcher → Dark) and repeat. Expected: the same ring in the lighter purple (`rgb(139, 111, 224)`).
- [ ] The ring shows on keyboard focus only. Clicking a button with the mouse shows no ring.
- [ ] Dark theme: the filled buttons (e.g. "Create Station" on `/stations`) have dark text on the purple fill, and error text (a form error) is a readable light red. Light theme: warning text and icons are a darker amber. Judge whether this reads well. — manual
- [ ] `npm run test:unit -w @portalai/core -- --testPathPattern theme-contrast` passes (AA ratios for text, status colours, button labels and the focus ring, both themes). — backend

## §5 — Loading, error and status

- [ ] On a detail page (e.g. a job at `/jobs/<id>`), throttle the network in DevTools ("Slow 3G") and reload. Expected: the spinner is named "Loading…" (`role="progressbar"` with that name), its message is in a `role="status"`, and the page has an `h1` "Job" (visually hidden) while it loads.
- [ ] Make a detail page fail: in DevTools → Network, block `*/api/jobs/*`, then open a job. Expected: the error message is in a `role="alert"`, and the page still has an `h1` "Job". Unblock afterwards.
- [ ] An error page (e.g. `/does-not-exist`) shows "404" as the `h1` and "Not Found" as an `h2`.
- [ ] Dashboard's health dot is an image named "Healthy — last checked: …" (`role="img"`).

## §6 — Notifications (toasts and the update notice)

- [ ] As owner, go to Settings → Members and create an invitation. Expected: the "Invitation created" toast appears bottom-right and is announced politely. It sits in the polite live stack (`#notifications [aria-live="polite"]`) and has no `alert` role.
- [ ] While the toast is visible, press Tab once from the top of the page. Expected: the skip links now offer **both** "Skip to main content" and "Skip to notifications". Choosing "Skip to notifications" puts focus on the Notifications region, and the next Tab reaches the toast's close button.
- [ ] Once the toast has gone (it auto-hides after 4 s), the "Skip to notifications" link is gone too.
- [ ] Raise an error toast: in DevTools → Network, block `*/api/organization/invitations*`, then revoke an invitation. Expected: the error toast has `role="alert"` (announced assertively) and stays until dismissed. Unblock, and revoke the invitation for real.
- [ ] Raise a success toast, then an error toast, without dismissing either. Expected: they stack oldest first (the success above the error), whatever their severity.
- [ ] Hear the update notice. While the app is open, rebuild the web app so `/version.json` changes, or wait for a deploy, then let the 60 s poll find it. The "A new version is available." banner is announced politely, and "Skip to notifications" reaches its Reload and Dismiss buttons. — manual

## §7 — Header menus

- [ ] As owner, Tab to the account button. Expected: its accessible name is the visible user name ("E2E Test User"), with `aria-haspopup="menu"`. The avatar is decorative (`alt=""`).
- [ ] Press Enter. Expected: the menu opens with focus on the **current org**, a `menuitemradio` with `aria-checked="true"`. ArrowDown moves to the other org, then on to Settings, Help and Logout.
- [ ] Choose the other org with Enter. Expected: the app switches to that org and the menu closes. Switch back the same way. (This changes the owner's active org, so leave it on `e2e-fixture`.)
- [ ] As member (one org), open the account menu. Expected: focus is on the single org, shown as a checked radio. Choosing it does nothing.
- [ ] Open the theme switcher with Enter. Expected: two `menuitemradio`s, Light and Dark, with the current one `aria-checked="true"`. Choosing one switches the theme and closes the menu.

## §8 — Portal chat

- [ ] Open a portal session. Expected: the message feed is `role="log"` named "Conversation". The composer is a textbox named "Message", and its placeholder still shows while it's empty and unfocused.
- [ ] Send "hello". While the reply streams, the feed has `aria-busy="true"`; when it finishes, `aria-busy="false"`.
- [ ] With a screen reader, send a prompt. Expected: the reply is read once, when complete, not token by token. — manual
- [ ] While a bulk job locks the chat, the composer's lock reason is announced as its description.

## §9 — Re-walk and inventory

- [ ] `npm run a11y:report`, with the dev stack up and the site previewed. Expected: in `docs/A11Y_AUDIT.md`, the "#797 App shell, navigation and landmarks" section reads "No automated findings", and the Summary row reads 0 rows and 0 keyboard/screen-reader findings. — backend
- [ ] In the same Summary, no other area's Rows count is above the epic branch's committed doc (#793 ≤ 27, #794 ≤ 20, #795 ≤ 9, #796 0, #798 ≤ 8). — backend
- [ ] The Keyboard pass table shows KB-01, KB-03, KB-04, KB-05 and KB-06 starting "**Closed:**", each naming its fix. — backend

## §10 — Marketing site

- [ ] Open `http://localhost:3002` in both themes. Expected: warning and error colours match the app's new palette (the site's tokens are generated from the same JSONs). Judge whether anything looks wrong. — manual

## §11 — Screen-reader pass

- [ ] With VoiceOver + Safari or NVDA + Firefox, walk flows 1 (sign-in) and 3 (station → portal → pin) from the screen-reader script in `docs/A11Y_AUDIT.md`. Expected: you hear the landmarks, "Skip to main content", the page title and focus move on navigation, named sidebar links, and announced toasts. Record anything off as an SR row. — manual

## Sign-off

- [ ] Every section above verified
- [ ] <date + name>: confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/job/entity ids):
