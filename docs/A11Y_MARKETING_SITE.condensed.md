# Accessible marketing site — Condensed design (#798)

**Issue:** [EnterpriseBT/portal-ai#798](https://github.com/EnterpriseBT/portal-ai/issues/798) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic #791; branch `feat/798-a11y-marketing-site` → `epic/a11y-conformance`.

**Why.** `apps/site` is the first surface an enterprise accessibility reviewer opens, and the goal is WCAG 2.2 AA. Most of it is already there:
- **Already in place:** skip link, landmarks, `lang`, focus ring.
- **Contrast fixed:** the issue's 8 contrast rows (2026-11-05) are gone. The 2026-11-10 axe walk (`a11y:axe:site`, 12 pages × 2 themes, WCAG 2.2 AA tags) recorded **zero findings**; the fixes came through the core palettes the site's tokens bridge from.
- **What's left:** KB-10 (19px nav links, target size) and a theme toggle that doesn't say which theme is on. Single package: `apps/site`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Skip link → `main#main` | `apps/site/src/layouts/Page.astro:31-33` | First Tab stop (CLAUDE.md audit notes). |
| Primary / Footer nav | `src/components/SiteHeader.astro`, `src/components/SiteFooter.astro:12-20` | `nav` with `aria-label`; header links carry `aria-current="page"`. |
| Theme toggle | `SiteHeader.astro` (`button[data-theme-toggle]`, `aria-label="Toggle colour theme"`) | Name is fixed: no state, and it doesn't say which way it switches. |
| Toggle behaviour | `src/layouts/Base.astro:128-145` | Inline click handler flips `data-theme` and writes `portalai-theme`; the head script resolves the theme before paint. |
| Focus ring | `src/styles/global.css:69-73` | 2px `--color-primary-main` on `a`, `button`, the toggle. |
| Nav link size | `SiteHeader.astro` `.site-header__nav a`; footer `font-size: 0.9rem` | Text-only links ~19px tall (KB-10, `docs/A11Y_AUDIT.md:219`). |
| Site tests | `apps/site/src/lib/__tests__/*.test.ts` (jest, `npm run test:unit`) | Unit tests cover `src/lib` only; `.astro` markup is checked by the browser walk. |
| Browser walk | `packages/e2e/src/a11y/site.a11y.ts` (`npm run --workspace @portalai/e2e a11y:axe:site`) | Every `SITE_PAGES` entry × both themes, report-only until #799. |

## Decision — target size (KB-10)

- **Options:** (a) record that the 2.5.8 spacing exception holds (single-row links with 16px gaps, and axe's `target-size` passed); or (b) give every nav link a 24px minimum target.
- **Chosen: (b).** `padding-block` on the header and footer nav links so each is at least 24px tall, which also covers the wrapped rows on narrow screens. It's no harder than verifying the exception, and it stays true when the nav changes. There's no visual change beyond the slightly larger hit area.

## Decision — the theme toggle's name and state

- **Options:** (a) keep the fixed name; (b) a name that changes ("Switch to dark theme"); (c) an APG toggle button: a stable name, "Dark theme", plus `aria-pressed`.
- **Chosen: (c).** A screen reader announces "Dark theme, toggle button, pressed / not pressed", which is the APG pattern and keeps the `title` tooltip stable.
- **How it's built:**
  - The click handler moves from `is:inline` into a bundled Astro `<script>` that imports a pure `src/lib/theme-toggle.ts`: `nextTheme(current)` and `toThemeName(theme)` (the `portalai-theme` encoding).
  - On load and on every toggle, the script sets `aria-pressed` from the resolved `data-theme`.
  - The head script stays inline: it has to run before first paint.
- **With JS off:** the toggle can't work, so it renders `hidden` until the script un-hides it. A dead button isn't left in the tab order.

## Plan — 2 slices

**Slice 1: toggle semantics.**
- **New:**
  - `apps/site/src/lib/theme-toggle.ts`
  - `apps/site/src/lib/__tests__/theme-toggle.test.ts`: next theme from each state; the encoding round-trips with the head script's reading (`brand` / `brand.dark`); an unknown stored value resolves like the head script.
- **Edit:**
  - `SiteHeader.astro`: `aria-label="Dark theme"`, `aria-pressed`, `hidden`.
  - `Base.astro`: a bundled `<script>` replaces the inline click handler, sets `aria-pressed` and un-hides.

**Slice 2: target size and close-out.**
- **Edit:**
  - `SiteHeader.astro` and `SiteFooter.astro`: nav links get a ≥24px block size.
  - `docs/A11Y_AUDIT.md`: KB-10 marked **Closed:** with the measurement.
- **Checks:**
  - `cd apps/site && npm run test:unit && npm run lint`, plus the site build (`npm run build -w @portalai/site`).
  - Then `a11y:axe:site` against the preview.

## Smoke (manual, against your dev stack)

1. `npm run build -w @portalai/site && npm run preview -w @portalai/site` (:3002). Open `/`.
2. **First Tab:** focus lands on "Skip to content". Enter moves focus into the main content.
3. **Tab through the header:** the brand, Features, Use cases, Pricing, Contact, the theme toggle, then Sign in. Each shows the 2px focus ring.
4. **Toggle with a screen reader** (VoiceOver + Safari or NVDA + Firefox): it reads "Dark theme, toggle button, not pressed". Space switches to dark and it then reads "pressed". Reload: the state persists and the button still reads pressed.
5. **Toggle with JS disabled** (DevTools): it isn't shown and isn't in the tab order. The page renders in the resolved theme.
6. **Target size:** in DevTools, each header and footer nav link's box is ≥24px tall, at 1280px and at 400px (wrapped) widths.
7. **Every page:** walk each page in `SITE_PAGES` with the keyboard only: every link is reachable, and focus is never lost or hidden behind the header.
8. `npm run --workspace @portalai/e2e a11y:axe:site`, then `npm run a11y:inventory`: the #798 section stays empty, and KB-10 shows **Closed:** (the summary's #798 keyboard count is 0).

## Out of scope

- Content rewrites (per the PRD).
- The no-JS theme *choice*. With JS off, the site follows `prefers-color-scheme`, as today.
- Turning the walk into a CI gate (#799).
