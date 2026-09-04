# Publish site Terms & Privacy — Condensed design (#506)

**Issue:** [EnterpriseBT/portal-ai#506](https://github.com/EnterpriseBT/portal-ai/issues/506) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `www.portalsai.io/terms/` and `/privacy/` are structure-only drafts: each is a `SECTIONS` array of `{ heading, prompt }` under a `Draft.` banner, marked `<!-- business copy pending: blocks prod tag -->`, published `noindex`, and filtered out of the sitemap. Prod (#83) is live and Stripe live-mode review expects a public site describing the product, so the placeholder is the last customer-facing gap. Its second half is in the app: the login screen asserts agreement to a Terms/Privacy it never links. This branch writes full product-accurate copy, flips both pages to indexable, and links the consent text. Packages touched: `apps/site`, `apps/web`, one comment fix in `apps/api`. **Nothing here is legal advice** — the copy is the maintainer's input (policy-generator output), reviewed by them before merge; the manual read-through is the smoke gate.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Terms stub | `apps/site/src/pages/terms.astro:12-43,53,59,63-66` | 9 `SECTIONS` prompts, marker, `noindex`, `Draft.` banner |
| Privacy stub | `apps/site/src/pages/privacy.astro:14-46,56,62,66-69` | 7 `SECTIONS` prompts, marker, `noindex`, `Draft.` banner |
| Sitemap filter | `apps/site/astro.config.mjs:29` | `filter: (page) => !/\/(privacy\|terms)\/$/.test(page)` |
| noindex↔sitemap guard | `apps/site/scripts/verify-pages.mjs:189-201` | fails on either inconsistency direction — passes once flip is consistent |
| Legal contact | `apps/site/src/lib/contact.ts:33` (`adminEmail`) | env `ADMIN_EMAIL` → SSM `admin-email`; QA fallback `qa@portalsai.io` |
| Site origin (default) | `apps/site/src/lib/site-context.ts:58` | prod deploy sets `SITE_URL`; prod site is `www.portalsai.io` |
| Retention windows | `apps/api/src/environment.ts:120,137,141` | ledger 24 mo; entity records 30 d; orphaned entity records 7 d |
| Product facts | `packages/core/src/registries/tier-catalog.ts` | credits metered per tier; webhook toolpacks org-hosted; owner can delete org |
| Consent copy (unlinked) | `apps/web/src/components/LoginForm.component.tsx:69-76` | plain text, no links |
| Consent test pin | `apps/web/src/__tests__/LoginForm.test.tsx:53-58` | asserts the text; no href assertion yet |
| Web contact pattern (precedent) | `apps/web/src/utils/contact.util.ts:31-40` | `resolveEmail(import.meta.env?.VITE_*)` — the "existing config path" for baked origins |
| Stale router comment | `apps/api/src/routes/public-site.router.ts:8-11` | still says payload carries "contact routes" — removed by #369, contract is `{ tiers, generatedAt }` |

## Decision — copy authored inline, effective date from a frontmatter constant

Full policy text replaces each `SECTIONS.prompt` (the array stays; `prompt` becomes the section body). Sections that name product facts must match the app: credits metered per tier, org-hosted webhook toolpacks, owner org-deletion; privacy third-parties name exactly the wired set — **AWS** (us-region hosting) · **Auth0** (identity) · **Stripe** (billing) · **Google** / **Microsoft** (OAuth connectors) · **Anthropic** (agent model) · **Tavily** (web search) · **Mapbox** (geocoding); retention states the real windows (entity records 30 d, orphaned 7 d, usage ledger 24 mo). Effective date is a single `EFFECTIVE_DATE` frontmatter constant per page, rendered as a "Last updated" line — `2026-09-04` at authoring.

## Decision — login links via an env-derived site origin (mirror `contact.util.ts`)

The issue requires the origin from "the existing env/config path, not a hardcoded string". There is no site-URL var in `apps/web` yet, so add one following the established `contact.util.ts` mechanism: a new `VITE_SITE_URL`, resolved by a small pure util defaulting to `https://www.portalsai.io` (prod origin). The jest env has no `import.meta.env`, so the default is what `LoginForm.test.tsx` asserts; deploy-dev sets `https://site-dev.portalsai.io`, deploy-prod `https://www.portalsai.io`. Links open in a new tab (`target="_blank" rel="noopener noreferrer"`) to preserve login context.

## Plan — 2 slices

**Slice 1 — site copy + publish flip + doc/comment fixes** (`apps/site`, `apps/api`)
- Edit `terms.astro`, `privacy.astro`: full body copy under each heading; drop the `<!-- business copy pending… -->` marker, the `Draft.` `.pending` banner (+ its `<style>`), and `noindex={true}`; add `EFFECTIVE_DATE` constant + "Last updated" line.
- Edit `astro.config.mjs`: remove the `/(privacy|terms)/` sitemap filter (drop the whole `filter` option — no other route is excluded).
- Edit `apps/site/README.md:139-143`: remove the "Not yet done" legal-pages entry.
- Edit `apps/api/src/routes/public-site.router.ts:8-11`: correct the comment to `{ tiers, generatedAt }` (no contact routes).
- **Tests:** `npm run build --workspace @portalai/site` (runs `verify-pages`: pages non-noindex ∧ in sitemap); `grep -r "business copy pending" apps/` returns nothing; `npm run type-check`, `npm run lint`.

**Slice 2 — app consent links** (`apps/web`, deploy workflows)
- New `apps/web/src/utils/site-origin.util.ts`: `SITE_ORIGIN = resolve(import.meta.env?.VITE_SITE_URL)` default `https://www.portalsai.io`; export `TERMS_URL`, `PRIVACY_URL`.
- Edit `LoginForm.component.tsx`: render "Terms of Service" / "Privacy Policy" as MUI `Link`s to those URLs inside the caption.
- Edit `apps/web/src/vite-env.d.ts`, `apps/web/.env`, `apps/web/.env.example`: add `VITE_SITE_URL`.
- Edit `.github/workflows/deploy-dev.yml` (+`deploy-prod.yml`) web build env: add `VITE_SITE_URL`.
- **Tests:** update `LoginForm.test.tsx:53-58` to assert both hrefs; new `apps/web/src/__tests__/site-origin.util.test.ts` (pure resolver, mirrors `contact.util.test.ts`); update the `LoginFormUI` snapshot; `npm run test:unit`, `type-check`, `lint` (web).

## Smoke (manual, against your dev stack)
1. `npm run build --workspace @portalai/site` → passes `verify-pages`; `dist/terms/index.html` and `dist/privacy/index.html` have **no** `<meta name="robots" … noindex>`, and both `/terms/` + `/privacy/` appear in a `sitemap-*.xml`.
2. Serve the built site (or `npm run dev --workspace @portalai/site`) → `/terms/` and `/privacy/` render full text under every heading, no "Draft" note, each shows a "Last updated" date; footer links still reach them.
3. `grep -r "business copy pending" apps/` → nothing.
4. On a prod-configured build, each page's "Questions about…" link is `mailto:admin@portalsai.io` (not the `qa@` fallback) — confirm `ADMIN_EMAIL` is set for the prod site build.
5. App login screen (`npm run dev`) → "Terms of Service" and "Privacy Policy" are links opening the two pages in a new tab.
6. **Human read-through (the gate):** both texts read end to end and confirmed to describe the product as shipped — credits/tiers, connectors, the vendor set, data + org deletion.

## Out of scope
- Cookie-consent banner (no client JS beyond the theme toggle; no third-party cookies) — revisit only if analytics land.
- DPA / sub-processor page for enterprise — sales-driven, separate ticket.
- Making the site build **fail** on a `qa@portalsai.io` contact fallback — real hardening, its own smoke; file separately.
- Versioned policy change-log — effective date suffices until a revision happens.
