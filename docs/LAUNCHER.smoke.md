# launcher — Epic Smoke Suite

Integration smoke for epic [#1084](https://github.com/EnterpriseBT/portal-ai/issues/1084): the header's Open Portal split button (#1075), the command palette (#1076) and the sidebar Favorites group (#1077), all built on #1122's components. Each child passed its own smoke; this suite covers only how they interact. **Branch under test:** `epic/launcher`.

## Preflight

### Environment

- [ ] `git checkout epic/launcher && git pull --ff-only`
- [ ] `npm install`. No migration.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000)

### Fixtures

- [ ] The e2e owner and member sessions (`npm run --workspace @portalai/e2e e2e:auth`, `e2e:auth:member`) in the seeded `e2e-fixture` org
- [ ] The owner has no favorites and owns at least one station shared with the member (Smoke Sales)

### Reset between runs

- [ ] Unstar everything starred below; delete any portals the walk opened; restore the member's share if §4 removed it

## §1 — One launcher behind the header and the palette

- [ ] On a station's page, the header's main button reads "Open Portal in <station>", and the palette's (⌘K / Ctrl+K) first action reads the same
- [ ] Run the palette's action: one portal opens in that station, and the station page's Portals list shows exactly one new portal
- [ ] "Open Portal: choose station…" in the palette and "Choose station…" in the header's menu open the same chooser dialog. Picking a station opens a portal there
- [ ] Back on the dashboard (no station page), the header and the palette both name the station of the portal opened last

## §2 — Favorites agree on all three surfaces

- [ ] Star a station on its page. Without a reload it appears in the sidebar's Favorites group, in the header menu's favorite stations, and in the palette's Favorites group
- [ ] Star a view and a pinned result. They appear in the sidebar and in the palette's Favorites, but not in the header menu (stations only)
- [ ] Unstar the station from the sidebar's link target page. It leaves all three surfaces without a reload

## §3 — Recent and current page across surfaces

- [ ] Open a portal from the header. The palette's home lists it first under "Recent portals"
- [ ] Open a favorite from the sidebar. It's `aria-current="page"` in the sidebar, and the palette's "Recent" group lists it first on its next open
- [ ] Follow a palette result to the page you're already on. The palette closes, and the sidebar's current-page marking is unchanged

## §4 — Access drops out everywhere

- [ ] As the member, favorite Smoke Sales. It shows in the sidebar, the header menu and the palette's Favorites
- [ ] As the owner, unshare it. After the member's window refocuses (data over 60s old), it's gone from all three, and a palette search for "Smoke Sales" finds nothing
- [ ] Reshare it. After a refocus it returns on all three

## §5 — Shell layout and keyboard

- [ ] At 1280px the header holds the trigger, Open Portal and the theme switch on one row. The expanded sidebar stays 239px wide with favorites or with none
- [ ] At phone width (≈400px) the trigger and Open Portal are icons. The drawer's Favorites group navigates and closes the drawer
- [ ] With the palette's "New station" (`?create=station`) dialog open, ⌘K / Ctrl+K doesn't open the palette over it
- [ ] Tab order from the skip link: header trigger → Open Portal → its menu button → … → sidebar items → Favorites disclosure → favorites. Every one shows the focus ring — manual (visual judgment)

## §6 — Help

- [ ] Help search "find something quickly" lists the FAQ "How do I find something quickly?" in its top 3 (search ranks every kind together). "sidebar favorites" ranks the Favorite glossary entry first, which names the sidebar group, the palette and the header menu

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/station/portal ids):
