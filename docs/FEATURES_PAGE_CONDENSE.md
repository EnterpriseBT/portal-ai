# Condense the marketing Features page — Condensed design (#360)

**Issue:** [EnterpriseBT/portal-ai#360](https://github.com/EnterpriseBT/portal-ai/issues/360) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `apps/site/src/pages/features.astro` reads like a domain-model reference: under each (good) section heading + lede it renders a `<dl>` that **dumps every glossary term + full definition** for that category, so the page enumerates internal data structures (Connector Definition, Connector Entity, Field Mapping, Normalized Data, Query Handle, Entity Record…). It should sell the product in plain language around the four pillars — **connectors, data normalization, portals, toolpacks** — not name every structure. Single package: `apps/site`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Section copy (headings + ledes) | `features.astro:12-42` (`CATEGORY_COPY`) | **Five** sections keyed to glossary categories: DataSources, DataModeling, Organization, Analytics, System. The **headings + ledes are already good, benefit-led copy** — keep them. |
| Per-category term dump | `features.astro:44-45, 80-87` (`byCategory` + `<dl class="terms">`) | The verbosity: renders **every** glossary term + definition in each category. This is what's cut. |
| JSON-LD | `features.astro:47-60` | `breadcrumbLd` + `definedTermSetLd` (all glossary terms, SEO structured data) + `faqPageLd`. The `DefinedTermSet` is invisible SEO, not user-facing copy. |

## Decision — four pillars, benefit copy, drop the term dump

1. **Restructure `CATEGORY_COPY` to the four pillars**, in the order a prospect meets them, keeping/adapting the existing (strong) ledes:
   - **Connect anything you already have** — connectors (spreadsheets, databases, REST APIs, Google Sheets, Excel), each staying live on a sync cadence. *(from DataSources)*
   - **Agree on what the fields mean** — normalize every source onto shared definitions with types + validation, so three systems spelling a date three ways stop being three problems. *(from DataModeling)*
   - **Ask, don't query** — portals answer in tables, charts, and prose from your live data; pin what's worth keeping. *(from Analytics)*
   - **Extend what the agent can do** — toolpacks add capabilities (statistics, maps/GIS, financial models, web search, custom webhooks) to a portal. *(promote toolpacks — today only a clause in the Analytics lede)*
2. **Drop the `<dl>` glossary dump entirely.** Replace it, per pillar, with **2–3 short hand-written benefit points** (plain outcomes, no internal nouns) — or nothing beyond the lede if the lede already lands.
3. **Fold the two secondary sections** (Organization "combine without merging", System "background jobs") — grouping becomes a one-line mention under normalization/portals if it earns its place; the jobs/locking detail is too internal for a marketing page and comes out.
4. **JSON-LD:** keep `breadcrumbLd` + `faqPageLd`. **Open question for confirmation:** keep the `definedTermSetLd` (invisible SEO, but it still enumerates every term in page source) or drop it to fully commit to "this page isn't a glossary"? *Lean: keep it* — it's invisible SEO value and doesn't affect the user-facing read.

**Sample tone (for the "toolpacks" pillar):** *"Start with a portal's built-in reasoning, then bolt on more: statistics and forecasting, interactive maps, financial models, live web search — or your own tools via a webhook. Turn packs on per station; the agent uses what's available."* Hand-written, no `ToolCapability`/`resultKind` nouns.

## Plan — 1 slice

**Files**
- Edit `apps/site/src/pages/features.astro` — collapse `CATEGORY_COPY` to the four pillars; remove `byCategory` + the `<dl class="terms">` block (`:80-87`) and the now-unused `.terms` styles; add the short per-pillar points; resolve the `definedTermSetLd` keep/drop per confirmation. Update the intro copy at `:69-73` ("Five things…" → the four pillars).

**Tests** (`cd apps/site && npm run build`)
- Astro build is the gate (no unit tests for marketing pages). The build must pass; if `GLOSSARY_ENTRIES` becomes unused after dropping the dump + DefinedTermSet, remove the import so the build/lint stays clean.

## Smoke (manual, against your dev stack)

1. `cd apps/site && npm run dev` (or the site dev server), open **/features**.
2. **Expected:** the page reads as marketing — the **four pillars** (connectors, normalization, portals, toolpacks) each with a heading + short benefit copy; **no wall of `term: definition` pairs**, no internal data-structure names.
3. Meaningfully **shorter / less dense** than before; scannable by a non-technical reader.
4. `npm run build` succeeds; no broken links; the pricing/nav still reach this page.

## Out of scope

- The shared glossary content (`GLOSSARY_ENTRIES`, #311) — powers in-app Help; **left unchanged**. This only changes how the marketing page consumes/summarizes it.
- Other marketing pages (pricing, use-cases, index) beyond incidental consistency.
