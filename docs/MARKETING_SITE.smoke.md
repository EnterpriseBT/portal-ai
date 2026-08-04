# marketing_site — Smoke Suite

Manual smoke test for [#311](https://github.com/EnterpriseBT/portal-ai/issues/311) — the public marketing site. Covers the anonymous `GET /api/public/site-config` endpoint (fail-closed prices, per-IP rate limit, no tenant data), the `apps/site` Astro package (build-time snapshot, token bridge, theme protocol, SEO/JSON-LD, build self-check), the three-trigger rebuild loop, the glossary/FAQ move to `@portalai/core/content`, the WOFF2 pipeline, and the `site.yml` + workflow deploy path.

**Branch under test:** `feat/marketing-site` (PR [#317](https://github.com/EnterpriseBT/portal-ai/pull/317)).

Run **§Preflight** once before any section. After that, **§1–§6 are local** and independent; **§7–§9 need the dev stack deployed** (they exercise CloudFront, the workflows, and the live dispatch loop) — walk those after this branch reaches `main`/`app-dev`.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section in the issue body (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/marketing-site && git pull --ff-only`
- [ ] `npm install` — new workspace `@portalai/site` plus new deps (`astro`, `@astrojs/sitemap`, `ttf2woff2`, `@astrojs/check`, `eslint-plugin-astro`, `prettier-plugin-astro`).
- [ ] `npm run build` — required before anything else. `packages/core` gained a `./content` subpath and a `build:fonts` step; the API and site both resolve core from `dist`.
- [ ] `cd apps/api && npm run db:migrate && cd ../..` — migration `tier-public-display-order` adds `tiers.is_public` + `tiers.display_order` and the `tiers_public_org_check` CHECK. Confirm it applies cleanly.
- [ ] `npx portalops tier apply --env local` — **required.** The migration defaults every existing row to `is_public = false`; `tier apply` is what flips the catalog's rows public. Until you run it the pricing page is legitimately empty.
- [ ] Set the contact addresses in `apps/api/.env` — **required**, not optional:
      `SUPPORT_EMAIL=support@portalsai.io` and `SALES_EMAIL=sales@portalsai.io`.
      The endpoint fails closed (503) rather than publishing empty `mailto:`
      links, so an unset value now blocks the walk at §1 by design.
- [ ] `npm run dev` boots cleanly: API `:3001`, web `:3000`, **site `:3002`**.
- [ ] **Port 3002 must be published by your devcontainer.** `docker-compose.yml`
      maps it, but a container created before that line was added won't expose
      it — check with `docker inspect <dev-container> --format '{{json .HostConfig.PortBindings}}'`
      and rebuild/reopen the devcontainer if `3002` is absent. Only the browser
      steps (§3f, §4) need this; `curl` from inside the container works either way.

### Fixtures

| Alias | Shape | Used by |
|---|---|---|
| **catalog tiers** | The four `TIER_CATALOG` rows, made public by `tier apply` above. | §1, §2, §4 |
| **private tier** | One org-scoped tier: `npx portalops tier create --env local --slug acme-smoke --display-name "Acme" --visible-to-org <orgId>`, leaving `public` false (the CHECK forbids public + org-scoped together). Tier commands are on **`portalops`**. | §1 |
| **Stripe test mode** | `STRIPE_SECRET_KEY` in `apps/api/.env` pointing at your local test account, with prices matching the catalog's lookup keys — otherwise `tier apply` exits 8 naming the missing keys. See `project_local_stripe_smoke_gotchas`. | §1, §2 |

### Reset between runs

- [ ] The endpoint caches its snapshot for 60s in-process. After changing a tier or an env var, either wait a minute or restart the API — otherwise you'll be reading a stale snapshot and blame the wrong layer.
- [ ] The per-IP rate limit is a Redis fixed window (60/min by default). If §1e leaves you throttled, wait for the next wall-clock minute.
- [ ] `npm run db:studio` (from `apps/api/`) — for inspecting `tiers.is_public` / `display_order`.

---

## §1 — The public endpoint

> Acceptance: *"`GET /api/public/site-config` returns 200 with no `Authorization` header and exposes no org/user/usage data; a non-public or org-private tier is absent"*

### §1a — Anonymous 200

- [ ] `curl -s -i http://localhost:3001/api/public/site-config` — **no** `Authorization` header.
- [ ] Status is `200`. Body is `{ "success": true, "payload": { … } }`.
- [ ] `Cache-Control` response header is exactly `public, max-age=60, s-maxage=300`.

### §1b — Shape carries no tenant data

- [ ] `curl -s http://localhost:3001/api/public/site-config | jq 'keys'` → exactly `["contact","generatedAt","tiers"]`.
- [ ] `curl -s … | jq '.payload.tiers[0] | keys'` → exactly `["builtinToolpacks","credits","cta","customToolpacks","description","displayName","displayOrder","price","slug"]`.
- [ ] No `organizationId`, `perToolCaps`, `overage`, `periodKind`, `freeUnitsPerPeriod`, or usage/balance field appears anywhere in the response.
- [ ] `contact.supportEmail` / `contact.salesEmail` match your `apps/api/.env` `SUPPORT_EMAIL` / `SALES_EMAIL` (local dev has no SSM — the env fallback is the expected path), and **neither is empty**.
- [ ] Fail-closed check: comment out `SUPPORT_EMAIL` in `apps/api/.env`, restart the API, `curl -s -i …` → **503** with `code: "SITE_CONFIG_CONTACT_UNRESOLVED"` and a message naming `supportEmail`. Restore it. *(An empty address used to publish `<a href="mailto:"></a>` on every page with the build reporting success.)*

### §1c — Private and non-public tiers are absent

- [ ] `curl -s … | jq -r '.payload.tiers[].slug'` lists only the public catalog slugs.
- [ ] The org-private tier's slug from Preflight is **not** in that list.
- [ ] In `db:studio` → `tiers`, set one public row's `is_public` to `false` directly, restart the API (or wait 60s), re-`curl`: that slug is now absent, and `displayOrder` ordering of the rest is unchanged (ascending).
- [ ] Set it back to `true` (or re-run `tier apply`) before continuing.

### §1d — The contact card is legal; an unresolvable price is not

> Acceptance: *"A public tier without a Stripe price renders the contact card (CTA → Contact); the build does **not** fail on it."*

- [ ] The catalog's amountless tier(s) come back with `"price": null` and a non-`subscribe` `cta`. The request still returns **200** — a null price is a legitimate plan, not an error.
- [ ] Now break a priced one: in `db:studio`, set one public tier's `stripe_price_id` to `price_does_not_exist_xyz`. Restart the API (or wait 60s).
- [ ] `curl -s -i …` → **503**, and the body's `code` is `SITE_CONFIG_PRICE_UNRESOLVED`. This is the split rule: "has a price id that won't resolve" is an outage, never silently a contact card.
- [ ] Restore the real price id (or re-run `tier apply`) and confirm the endpoint returns 200 again.

### §1e — Per-IP rate limit

- [ ] `for i in $(seq 1 70); do curl -s -o /dev/null -w "%{http_code} " http://localhost:3001/api/public/site-config; done; echo`
- [ ] The first ~60 are `200`; later ones are `429`.
- [ ] A `429` body carries `code: "SITE_CONFIG_RATE_LIMITED"`.
- [ ] **Fail-open check:** stop Redis (`docker stop portalai-redis-1`), then
      `curl -s -m 20 -o /dev/null -w "%{http_code} in %{time_total}s\n" http://localhost:3001/api/public/site-config`
      → **200 in ≈1s**. Both halves matter: a marketing fetch must not 500 on a
      Redis blip, **and it must not hang** — `redis.util.ts` sets
      `maxRetriesPerRequest: null` for BullMQ, so an unbounded command is queued
      forever rather than rejected, and the caller's `catch` never runs.
      Time it, don't just check the status. Restart Redis afterwards.
- [ ] Re-verify limiting still works after Redis returns: wait for the next
      wall-clock minute, re-flood, and confirm 429s reappear.

### §1f — Swagger

- [ ] `http://localhost:3001/api/docs` → the **Public Site** tag lists `GET /api/public/site-config`.
- [ ] Its entry shows **no** padlock / no `bearerAuth` requirement, and documents the `429` and `503` responses.

---

## §2 — The site builds from the endpoint, not from code

> Acceptance: *"`grep` over `apps/site` finds no hardcoded amount or contact email"* and *"flipping `public` via `tier apply` + rebuild changes the site with no code change"*

### §2a — Nothing is hardcoded

Scope each grep to shipped page code — exclude tests, the offline fixture, and
the generated `tokens.css`, or you'll spend the step triaging false positives:

```bash
SHIP='apps/site/src/pages apps/site/src/components apps/site/src/layouts'
grep -rnE '\$[0-9]|[0-9]+ ?/ ?(mo|month|year)' $SHIP          # prices
grep -rniE '[a-z0-9._%+-]+@[a-z0-9.-]+\.(io|com)' $SHIP        # addresses
grep -rn '#[0-9a-fA-F]\{6\}' $SHIP                            # brand colours
```

- [ ] All three return **nothing**. Every amount, address, and colour on a
      shipped page comes from the snapshot or a CSS custom property.
- [ ] The deliberate exceptions, if you widen the scope: `site-config.fixture.json`
      (offline fixture, amounts are `0`, addresses are `*@example.invalid`),
      `src/lib/*.ts` doc comments and unit-test fixtures, and the generated
      `src/styles/tokens.css` (gitignored — it is where the palette *should* be).

### §2b — Offline (fixture) build

- [ ] `cd apps/site && npm run build` with `SITE_CONFIG_URL` **unset**. It succeeds — this is what lets root `npm run build` pass with no API running.
- [ ] `grep -o 'portal:build" content="[^"]*"' dist/index.html` → the value ends in `fixture`.
- [ ] The self-check line prints: `verify-pages — 11 pages OK …`.

### §2c — Live build against your API

- [ ] `SITE_CONFIG_URL=http://localhost:3001/api/public/site-config npm run build`
- [ ] The build stamp is now `<sha> <ISO timestamp>` with **no** `fixture`.
- [ ] `grep -o 'price__amount[^<]*<[^<]*' dist/pricing/index.html` shows your real catalog amounts and/or `Let's talk`, one per tier card.

### §2d — Publishing a tier change takes no code change

Use the **operator-owned** field, not a catalog-owned one. `description` and
`visibleToOrganizationId` are deliberately excluded from `CONVERGED_POLICY_FIELDS`;
everything else (including `displayName`, `cta`, `public`, `displayOrder`) is
catalog policy that the next `tier apply` would clobber. Tier commands live on
**`portalops`**, not `portalai`.

- [ ] `npx portalops tier description --env local --slug pro --set "Smoke walk: set from the CLI, no code change."`
      → `{"slug":"pro","description":"Smoke walk: …"}`
- [ ] Wait 60s (the snapshot cache TTL) or restart the API, then re-run the live build from §2c.
- [ ] `dist/pricing/index.html` contains that sentence, and `git status --porcelain apps/site` shows **no source change**.
- [ ] `npx portalops tier description --env local --slug pro --clear` to reset.
- [ ] The catalog-owned path, for contrast: flip a row's `is_public` in `db:studio`, then `npx portalops tier apply --env local` puts it back — convergence is the mechanism, and it is still not a code change.

### §2e — The endpoint going down fails the build

> Acceptance: *"Taking the endpoint down (or an unresolvable priced tier) **fails the build**."*

- [ ] Stop the API (or use a dead port): `SITE_CONFIG_URL=http://127.0.0.1:9/api/public/site-config npm run build`
- [ ] The build **fails** (non-zero exit) with a fetch error, and does **not** fall back to the fixture.
- [ ] Note that `dist/` is *emptied* — Astro clears `outDir` before generating, so a failed build leaves no output. That is fine and not a bug: the protection for the live site is that the failed **build step short-circuits the workflow before `s3 sync` runs**, so the previously deployed site stays up untouched. Don't expect the old `dist/` to survive locally.
- [ ] Re-break a priced tier as in §1d, restart the API, and run the live build: it fails on the 503 rather than publishing a contact card.

---

## §3 — Pages, copy, and SEO (no JS executed)

> Acceptance: *"Every page `curl`s to full HTML: copy, nav, JSON-LD, and real tier names + amounts on Pricing — no JS executed"* and the whole unique-title/sitemap/robots/llms criterion.

Do this against the **live-config** `dist/` from §2c. Serve it: `cd apps/site && npx astro preview --port 3002`.

### §3a — Every page is complete HTML

- [ ] For each of `/`, `/features/`, `/use-cases/`, `/use-cases/operations/`, `/use-cases/founders/`, `/use-cases/analysts/`, `/pricing/`, `/contact/`, `/privacy/`, `/terms/`: `curl -s http://localhost:3002<path>` returns real copy, the nav links, and the footer — with no JS run.
- [ ] `/pricing/` contains the actual tier names and amounts from your catalog.
- [ ] `/contact/` shows the addresses from the snapshot (your `.env` values), not a hardcoded pair.
- [ ] Disable JavaScript in your browser and load `/pricing/` — everything still renders (only the theme toggle stops working).

### §3b — Head contract

- [ ] Every page's `<title>` is unique and describes that page.
- [ ] Every page has a meta description and a `<link rel="canonical">` pointing at **its own** URL.
- [ ] Every page has exactly one `<h1>`.
- [ ] Every page carries `<meta name="portal:build" …>`.
- [ ] `/privacy/` and `/terms/` carry `<meta name="robots" content="noindex, follow">` (their copy is still a draft).

### §3c — Structured data

- [ ] `curl -s http://localhost:3002/ | grep -o 'application/ld+json'` → three blocks (Organization, WebSite, SoftwareApplication).
- [ ] The home page's `SoftwareApplication` `offers` carry your **real** amounts, and amountless tiers are omitted (not listed at `0`).
- [ ] `/pricing/` includes `BreadcrumbList` + `FAQPage`; `/features/` includes `DefinedTermSet` built from the shared glossary.
- [ ] Every `ld+json` block parses: `curl -s … | grep -oP '(?<=ld\+json">).*?(?=</script>)' | jq . > /dev/null`.

### §3d — Machine-readable files

- [ ] `curl -s http://localhost:3002/robots.txt` — names `GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`, `CCBot`, `Bingbot`, `Googlebot`, and ends with a `Sitemap:` line.
- [ ] `curl -s http://localhost:3002/llms.txt` — product summary + canonical page pointers.
- [ ] `curl -s http://localhost:3002/sitemap-0.xml` lists all **8 indexable** routes and **omits** `/privacy/` and `/terms/` (they're noindex — listing them would be a contradictory signal).

### §3e — The self-check actually guards this

- [ ] Break something on purpose: in `apps/site/src/pages/pricing.astro`, change the `title` to duplicate the features page's, then `npm run build`.
- [ ] The build **fails** with `✗ /pricing/: duplicate <title> …`. Revert.

### §3f — Third-party validators (browser)

- [ ] Slack: paste a deployed page URL into a DM and confirm the unfurl shows the title, description, and the share image (needs §7 — the page must be publicly reachable).
- [ ] [Rich Results Test](https://search.google.com/test/rich-results) passes on Home, Features, and Pricing (needs a public URL).
- [ ] Lighthouse (Chrome DevTools, against `astro preview`): **SEO 100**, **Accessibility ≥ 95**.
- [ ] At 375px width, no horizontal scroll on any page.

---

## §4 — Theme parity with the app

> Acceptance: *"Light + dark verified side-by-side against the app; toggle persists; no wrong-theme flash."*

- [ ] Open `http://localhost:3000` (app) and `http://localhost:3002` (site) side by side in light mode. Background, surface, primary accent, body font (Exo 2), and heading font (Fraunces) match.
- [ ] Switch the app to Brand Dark. Reload the site in the same browser — **the site is already dark** (it reads the app's `portalai-theme` localStorage key).
- [ ] Click the site's **Theme** button. It flips, and reloading keeps the new value.
- [ ] Go back to the app and reload: the app now reflects the choice the *site* wrote (same key, same JSON encoding).
- [ ] Hard-reload the site in dark mode several times with the network throttled to Slow 3G — **no white flash** before dark paints.
- [ ] In a fresh private window with no stored preference, the site follows the OS `prefers-color-scheme`.

---

## §5 — Glossary/FAQ move and fonts

> Covers the `@portalai/core/content` move and the WOFF2 pipeline (diff surfaces the acceptance criteria under-specify).

### §5a — In-app Help still works

- [ ] In the app, open **Help → Glossary**. Terms, categories, definitions, and examples all render as before.
- [ ] A term with a mapped route (e.g. **Station**, **Job**, **Tool Pack**) still shows its "go to page" route link. *This is the regression the move could cause silently — the shared dataset has no routes; `apps/web` re-attaches them.*
- [ ] **Help → FAQ** renders all entries and its category filter works.
- [ ] The site's `/features/` page shows the **same** definitions as the app's glossary.

### §5b — Fonts

- [ ] `ls packages/core/dist/fonts/*.woff2 | wc -l` → 11, each beside its `.ttf`.
- [ ] `grep -m1 -A3 'font-family: "Exo 2"' packages/core/dist/styles/fonts.css` — `woff2` appears **before** `truetype` in the `src` list.
- [ ] In the app, DevTools → Network → Font: the loaded files are `.woff2`, not `.ttf`.
- [ ] Same check on the site at `:3002`.

---

## §6 — Root tooling

> Acceptance: *"Root `build`/`lint`/`type-check`/`format:check`/`test:unit` pass with `apps/site`; `npm run dev` brings the site up on `:3002` beside web/api."*

- [ ] **Stop `npm run dev` first.** Root `test:unit` runs every package's jest
      concurrently under turbo; with three dev servers in watch mode also
      competing for CPU, `apps/web`'s `userEvent` tests blow their 5s timeout
      and fail spuriously (observed repeatedly during this walk — 3–9s
      timeouts, never assertion failures, all green once the servers stopped).
- [ ] From the repo root, each of these passes with `@portalai/site` in the task list: `npm run build`, `npm run lint`, `npm run type-check`, `npm run format:check`, `npm run test:unit`.
- [ ] `cd apps/api && npm run test:integration` — 106 suites green, including
      `public-site.router.integration.test.ts` (which now clears its own Redis
      rate-limit keys, so ambient traffic can't 429 it).
- [ ] `npm run dev` — all three servers come up; `http://localhost:3002` serves the site.
- [ ] Formatting hook: deliberately mangle whitespace in an `.astro` file, `git add` it, `git commit` — lint-staged reformats it (the root glob now covers `.astro`).

---

## §7 — Deployed dev site *(after merge to `main`)*

> Acceptance: the CloudFront/404 criterion and *"push to `main` → `site-dev` only"*.

- [ ] Merging to `main` runs **Deploy Dev** (which creates the `portalai-dev-site` stack) and **Deploy Site (dev)**. Both go green.
- [ ] `curl -sI https://site-dev.portalsai.io/` → `200`.
- [ ] `curl -sI https://site-dev.portalsai.io/features/` → `200`.
- [ ] `curl -sI https://site-dev.portalsai.io/features` (no trailing slash) → `200`, same page, **no 301 chain**.
- [ ] `curl -sI https://site-dev.portalsai.io/nope/` → **HTTP 404**, and the body is the branded 404 page — **not** S3 XML, and **not** a soft-404 `200`.
- [ ] `curl -sI https://site-dev.portalsai.io/robots.txt` → `200`, `content-type: text/plain`.
- [ ] Cache headers: a `/_astro/*.css` response carries `max-age=31536000, immutable`; `/index.html` carries `max-age=0, must-revalidate`.
- [ ] `curl -s https://site-dev.portalsai.io/pricing/ | grep -c 'portal:build'` → 1, and the stamp has **no** `fixture`.
- [ ] The deployed pricing amounts match `curl -s https://api-dev.portalsai.io/api/public/site-config | jq '.payload.tiers'`.
- [ ] Confirm **`app-dev.portalsai.io` is unaffected** — the site stack must not have touched the frontend distribution.

---

## §8 — The rebuild loop *(dev stack)*

> Acceptance: *"`portalops vars set` of a support email + the fired rebuild updates the site with no manual deploy."*

Requires `GITHUB_DISPATCH_TOKEN` minted and `GITHUB_TOKEN` in your shell.

- [ ] `npx portalops vars set SUPPORT_EMAIL smoke-test@portalsai.io --env app-dev --yes`
- [ ] stderr prints `site rebuild requested (vars set SUPPORT_EMAIL (app-dev))`, and the command exits **0**.
- [ ] A **Deploy Site (dev)** run appears in Actions, triggered by `repository_dispatch`.
- [ ] After it completes: `curl -s https://site-dev.portalsai.io/contact/ | grep smoke-test@portalsai.io` matches. **No manual deploy was performed.**
- [ ] Restore the real address with another `vars set`.
- [ ] **Never blocks the write:** `unset GITHUB_TOKEN`, run another `vars set`. It prints the "note: site rebuild not requested (GITHUB_TOKEN unset)" line and still exits **0** — the write succeeded.
- [ ] `npx portalops tier apply --env app-dev --yes` with at least one change → a dispatch fires. A no-change apply fires none.
- [ ] Stripe path: edit a price in your Stripe **test** dashboard so a `price.updated` webhook reaches the dev API. In `db:studio` → `stripe_events`, the row's `outcome` is still `ignored` (semantics unchanged), and a **Deploy Site (dev)** run appears.
- [ ] The nightly schedule exists: Actions → Deploy Site (dev) shows the `0 9 * * *` cron.

---

## §9 — Prod pipeline safety *(no prod deploy expected)*

> Acceptance: *"Release/tag publish → `site.portalsai.io` only; … prod job blocks on the `prod` Environment review and skips while the prod API input is unset."*

The prod API doesn't exist until #83, so the correct outcome here is **a clean skip**, not a deploy.

- [ ] Manual settings applied and recorded: `prod` GitHub Environment created **with required reviewers**; `PROD_AWS_ROLE_ARN` + `PROD_HOSTED_ZONE_ID` set as **repository** secrets (not environment secrets — the caller reads them); `PROD_SITE_CONFIG_URL` left **unset**.
- [ ] Actions → **Deploy Site (prod)** → *Run workflow*. The `resolve` job runs; the `deploy` job is **skipped** with a notice naming `PROD_SITE_CONFIG_URL`.
- [ ] Nothing was deployed: no `portalai-prod-site` stack, no `www.portalsai.io` DNS record.
- [ ] A push to `main` triggers **Deploy Site (dev)** only — never the prod workflow.
- [ ] Read the `resolve` job log and confirm the ref it would build is a **release tag**, never `main`.
- [ ] Once `PROD_SITE_CONFIG_URL` is set (post-#83), re-run and confirm the `deploy` job **waits for environment approval** before doing anything.

---

## §10 — Pre-launch blockers (confirm, don't fix here)

- [ ] `/privacy/` and `/terms/` still carry `<!-- business copy pending: blocks prod tag -->` and are `noindex`. **Business-reviewed copy must replace them before any production release.**
- [ ] `public/og-default.png` is the generated on-brand placeholder (no wordmark). Decide whether a designed card is required before launch.
- [ ] **Product name:** settled as **Portals AI** and applied repo-wide — site copy, JSON-LD, `llms.txt`, the shared glossary/FAQ, the app's layouts and OAuth consent copy, `CLAUDE.md`/`README.md`, and the CloudFormation stack descriptions. Spot-check nothing was missed: `grep -rn "Portals\?\.ai" apps packages infra CLAUDE.md README.md` returns nothing (domains like `portalsai.io` and the `@portalai/*` package names are correctly untouched).

---

## Sign-off checklist

After every section above is green:

- [ ] §1 (endpoint) — anonymous 200, no tenant data, private tiers absent, fail-closed 503, rate limit + fail-open, Swagger has no security key.
- [ ] §2 (config-driven) — nothing hardcoded; fixture and live builds both work; a tier rename reaches the site with no code change; a dead endpoint fails the build.
- [ ] §3 (pages/SEO) — full HTML with no JS, head contract, JSON-LD, robots/llms/sitemap, self-check guards it, validators pass.
- [ ] §4 (theme) — parity with the app both ways, persists, no flash.
- [ ] §5 (content/fonts) — in-app Help intact including route links; woff2 served.
- [ ] §6 (tooling) — every root task passes with the site; `:3002` in `npm run dev`.
- [ ] §7 (dev deploy) — URL matrix, real 404, cache headers, live prices, frontend untouched.
- [ ] §8 (rebuild loop) — `vars set` reaches the published site; dispatch never blocks a write; Stripe semantics unchanged.
- [ ] §9 (prod safety) — clean skip, tag-only refs, environment review gate.
- [ ] §10 (blockers) — acknowledged and tracked.

- [ ] <date + name> — confirmed against my own running stack.

After every box is ticked: report ready-to-merge in the PR thread, or file follow-up bugs against any failing case.

---

## Bug-filing template

```
**Section:** §<X> — <name>
**Step:** <which step>
**Expected:** <what the smoke doc says should happen>
**Got:** <curl output, screenshots, db row inspections, workflow run link>
**Repro:** <exact command or URL + any preconditions>
**Identifiers:** <org id / tier slug / workflow run id / build stamp>
```
