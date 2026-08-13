# help_url_addressable_sections — Smoke Suite

Manual smoke test for [#365](https://github.com/EnterpriseBT/portal-ai/issues/365) — Help sections are addressable by URL. Covers the `?tab=` / `?category=` search contract and its fail-open sanitization, `#<surface>-entry-<slug>` entry anchors, two-way URL sync (tabs push, chips replace, back button works), controlled accordion expansion, and the portal empty state's link landing on the portal FAQ instead of the onboarding checklist.

**Branch under test:** `feat/help-url-addressable-sections` (PR [#373](https://github.com/EnterpriseBT/portal-ai/pull/373)) — child of epic [#364](https://github.com/EnterpriseBT/portal-ai/issues/364), **PR base `epic/portal-guidance`, not `main`**.

Run **§Preflight** once before any section. The rest can be walked top-to-bottom; each section is independent after preflight. Most of this is address-bar work — keep the browser URL bar visible throughout, and use a **normal (non-incognito) window with history**, since §4 exercises the back button.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section in the issue body (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/help-url-addressable-sections && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core` — `@portalai/core` gained `contentEntrySlug` and the controlled `useTabs`; `apps/web` resolves core through `dist/`, so a stale build makes this walkthrough test the old code.
- [ ] **No migration.** This branch touches no DB schema, no seed, no API route — do not run `db:migrate`.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`).
- [ ] Auth0 dev tenant works — login lands on the dashboard.

### Fixtures

Nothing to seed for §1–§6: Help content is static and identical for every org.

| Needed | For | How |
|---|---|---|
| Any logged-in user | §1–§6 | your usual dev login |
| A **portal with no messages** | §5 | open any station → start a new portal session and don't send anything; the "Ready when you are" empty state is the surface under test |

### Reset between runs

- [ ] No reset needed — nothing is persisted. To re-run a section cleanly, just navigate to `/help` fresh.
- [ ] If you've been clicking around, open a new tab before §4 so the back-button steps start from a clean history.

---

## §1 — Deep links land where they say (AC 2, 4, 5)

Paste each URL directly into the address bar (a fresh navigation, not an in-app click).

- [ ] `http://localhost:3000/help?tab=faq&category=analytics` → the **FAQ** tab is active and the **Analytics & Portals** chip is highlighted. The FAQ list shows only Analytics & Portals entries, **ungrouped** (no category section headers).
- [ ] Watch that same load closely (or throttle the network in devtools): the **Getting Started tab never appears first**. There is no flash of onboarding content before the FAQ tab settles.
- [ ] `http://localhost:3000/help?tab=glossary&category=analytics` → the **Glossary** tab is active with the **Analytics** chip highlighted; entries are Analytics-only (Station, Portal, Tool Pack, …).
- [ ] `http://localhost:3000/help?tab=glossary` (no category) → Glossary tab, **All** chip highlighted, every glossary entry listed.
- [ ] `http://localhost:3000/help` → **Getting Started**, exactly as before this branch. The search box is hidden on this tab.

## §2 — Bad addresses degrade, never break (AC 6, 7)

The rule is fail-open: a stale or hand-mangled link opens a working Help page.

- [ ] `http://localhost:3000/help?tab=nonsense&category=nonsense` → Getting Started renders. **No error boundary, no blank page, no console exception.** (Keep the devtools console open for this one.)
- [ ] `http://localhost:3000/help?tab=faq&category=data-modeling` → the **FAQ** tab is active with **All** highlighted. `data-modeling` is a glossary-only category, so it is dropped while the tab survives.
- [ ] `http://localhost:3000/help?category=analytics` (category, no tab) → Getting Started, no filter applied.
- [ ] `http://localhost:3000/help?tab=faq&utm_source=email` → FAQ tab active, and `utm_source=email` is **still in the address bar** (foreign params ride along untouched).

## §3 — Entry anchors open one entry (AC 8)

- [ ] `http://localhost:3000/help#faq-entry-what-are-tool-packs` → the **FAQ** tab opens (the fragment alone selects the surface — note there is no `?tab=`), the "What are tool packs?" accordion is **already expanded**, and the page has scrolled it into view.
- [ ] `http://localhost:3000/help#glossary-entry-portal-result` → **Glossary** tab, the "Portal Result" entry expanded and scrolled to.
- [ ] `http://localhost:3000/help?tab=glossary&category=system#glossary-entry-portal` → the anchor wins: **Portal** is visible and expanded even though the System chip would have filtered it out. The category filter is not applied.
- [ ] `http://localhost:3000/help#faq-entry-this-entry-does-not-exist` → the FAQ tab opens normally, nothing is expanded, nothing scrolls, **no error**. (This is the case that protects readers from #366's content edits.)
- [ ] With an anchored entry open, click a *different* accordion in the list — it opens too, and the anchored one **stays open**. Your manual expansion is not stomped.
- [ ] Collapse the anchored entry by clicking its header — it closes and stays closed (the anchor does not re-open it on every render).

## §4 — Two-way sync and the back button (AC 9, 10)

This is the section that needs real browser history — do it in one continuous run.

- [ ] Start at `http://localhost:3000/help` (Getting Started).
- [ ] Click the **Glossary** tab → the address bar becomes `/help?tab=glossary`.
- [ ] Click the **FAQ** tab → `/help?tab=faq`.
- [ ] Press **Back** → you return to the **Glossary** tab (address and rendered tab both). Press Back again → Getting Started.
- [ ] Press **Forward** twice → Glossary, then FAQ. The rendered tab tracks the address every time.
- [ ] On the FAQ tab, click through **four or five different category chips** in a row, then press **Back once** → you land on the tab you were on *before* the chips (not four presses of chip history). Chips replace; tabs push.
- [ ] Copy the URL from any of the above and paste it into a **new browser tab** → the same view opens. That is the whole point of the ticket.
- [ ] **Cross-tab jump:** go to the FAQ tab, expand **"What's the difference between a portal and a portal result?"**, and click the **Portal Result** link under *Related terms* → the Glossary tab opens, the Portal Result entry is expanded and scrolled to, **and the address bar now reads `/help?tab=glossary#glossary-entry-portal-result`**. Press Back → you return to the FAQ tab.

## §5 — The portal empty state's link (AC 3)

The original complaint in the ticket.

- [ ] Open a portal session with no messages — the "Ready when you are" empty state.
- [ ] Hover **"Learn what portal sessions can do →"** and read the status-bar URL (or inspect the anchor): it is `/help?tab=faq&category=analytics`.
- [ ] Click it → you land on the **FAQ** tab with **Analytics & Portals** active. You do **not** land on the Getting Started checklist.
- [ ] Press Back → you return to the portal session.

## §6 — Nothing else moved (AC 11, 12, 13)

Regression sweep over the surfaces this branch touched indirectly.

- [ ] With `/help?tab=faq&category=analytics` open, the **sidebar's Help item is still highlighted** as the current page (selected state matches on pathname, so search params must not break it).
- [ ] The header menu's **Help** entry and the sidebar's **Help** entry both still go to plain `/help` → Getting Started. This is intended: a generic nav item carries no destination intent.
- [ ] **Settings tabs are unchanged** — open `/settings`, click through Profile / Organization / Billing. Tabs switch normally. (Settings is deliberately still read-once: its URL does *not* change when you click a tab. That is correct, not a bug.)
- [ ] `/settings?tab=billing` still opens the Billing tab directly, and an entitlement "Upgrade" link elsewhere in the app still lands there.
- [ ] Open a **Connector detail** page and click through its tabs — unrelated `useTabs` consumers behave exactly as before.
- [ ] **Help content is untouched:** spot-check three or four glossary entries and a few FAQ answers against what you remember — no wording changed on this branch. (Content is #366's job.)
- [ ] Help **search** still works on both tabs: type "station" on Glossary, "job" on FAQ; results filter. The search text **does not** appear in the URL — deliberate.
- [ ] Combine search with a category chip → both filters apply together, as before.

## §7 — The marketing site still builds (shared module)

`packages/core/src/content` is consumed by `apps/site` at build time, and this branch added an export to it.

- [ ] `npm run build --workspace=apps/site` completes without error.
- [ ] `npm run dev` (or preview the built site) on `:3002` → the site renders; the Features page and FAQ-derived JSON-LD are intact. No Help/glossary content changed, so nothing should look different.

## §8 — Not manually verifiable (recorded, not skipped)

AC 1 ("all cases pass; lint / type-check / format:check clean") is a **CI assertion**, not a walkthrough step — it's covered by the PR's checks rather than by anything you can click. Confirm CI is green on the PR before merging; that plus your sign-off below is the gate.

---

## Sign-off checklist

After every section above is green:

- [ ] §1 (deep links) — FAQ + Analytics, Glossary + Analytics, bare `/help`, no Getting Started flash.
- [ ] §2 (bad addresses) — nonsense, mismatched pair, orphan category, foreign params all degrade cleanly.
- [ ] §3 (anchors) — both surfaces open + scroll; anchor outranks the filter; unknown slug is silent; manual toggles survive.
- [ ] §4 (two-way sync) — address tracks the tab, back/forward work, chips don't spam history, cross-tab jump writes the URL.
- [ ] §5 (portal empty state) — the link lands on the portal FAQ.
- [ ] §6 (no regressions) — sidebar selection, bare nav links, Settings tabs, other `useTabs` consumers, unchanged content, search behavior.
- [ ] §7 (marketing site) — builds and renders.
- [ ] CI green on the PR (§8).
- [ ] `<date>` — `<name>` — walked against my own running stack.

After every box is ticked: report ready-to-merge in the PR thread (base `epic/portal-guidance`), or file follow-up bugs against any failing case.

---

## Bug-filing template

```
**Section:** §<X> — <name>
**Step:** <which step>
**Expected:** <what the smoke doc says should happen>
**Got:** <what happened — screenshot, address bar contents, console output>
**Repro:** <exact URL pasted or click path>
**Browser / window:** <chrome|firefox|safari, normal vs incognito>
```
