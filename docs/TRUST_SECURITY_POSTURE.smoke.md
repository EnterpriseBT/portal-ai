# trust-security-posture — Smoke Suite

Manual smoke test for [#613](https://github.com/EnterpriseBT/portal-ai/issues/613): the public `/security/` page, one shared subprocessor list checked against both server and browser egress, RFC 9116 `/.well-known/security.txt`, the `SECURITY_EMAIL` contact address, and the privacy, terms and review-doc corrections.

**Branch under test:** `feat/613-trust-security-posture` (PR [#853](https://github.com/EnterpriseBT/portal-ai/pull/853)).

Run **§Preflight** once. §1–§6 can be walked in any order after it, against a local build of the marketing site. **§7 runs after merge**: the dev site deploy always builds `main`, so the deployed checks can't happen before then. Steps tagged `— manual` need a human: visual judgment, a terminal, AWS, or GitHub. Every other step can be walked with `/smoke-walk`.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, and link this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/613-trust-security-posture && git pull --ff-only`
- [ ] `npm install`. Removing `@ai-sdk/groq` changed `package-lock.json`.
- [ ] `npm run build --workspace @portalai/core`. The site and web app read the new `SUBPROCESSORS` from core's `dist`. No migration.
- [ ] `npm run build --workspace @portalai/site`. The last line reads `verify-pages — 12 pages OK (… security.txt)`.
- [ ] `npm run preview --workspace @portalai/site`. The built site serves on `http://localhost:3002`.
  Use the trailing slash (`/security/`, not `/security`). The local server 404s every slashless page because the site builds with `trailingSlash: "always"`. Deployed, CloudFront rewrites slashless URLs (`cloudfront-rewrite.test.ts`), so this is local-only and not part of this change.

### Fixtures

- [ ] None. The site is static and needs no login, org or data. No API is needed either: the build uses the fixture site-config when `SITE_CONFIG_URL` is unset.

### Reset between runs

- [ ] No reset needed; everything here is read-only. Rebuild (`npm run build --workspace @portalai/site`) after changing an env var such as `SECURITY_EMAIL`.

---

## §1 — The `/security/` page

- [ ] Open `http://localhost:3002/security/`. The title is "Security — Portals AI", there is one `h1` "Security", and the page shows "Last updated: October 22, 2026".
- [ ] Four `h2` sections appear in this order: **Controls**, **Your data and AI**, **Subprocessors**, **Reporting a vulnerability**.
- [ ] **Controls** lists exactly ten `h3` items: Encryption in transit, Encryption at rest, Hosting, Backups, Sign-in and single sign-on, Access control, Tenant isolation, Audit log, Rate limiting, Vulnerability management.
- [ ] The Rate limiting text reads "Authenticated API requests are rate-limited per user." It says nothing per-organization.
- [ ] Each anchor scrolls to its section: `/security/#controls`, `#data-and-ai`, `#subprocessors`, `#disclosure`, and `#backups` for one control.
- [ ] Searching the page text (Ctrl-F) finds **none** of: "SOC 2", "ISO 27001", "certified", "zero retention", "zero-retention", "disaster recovery", "multi-AZ", "Redis".
- [ ] **Your data and AI** says customer content "is not used to train AI models", says Anthropic retains data "under its standard API data-retention policy", and links to `/privacy/`.
- [ ] **Reporting a vulnerability** shows `qa@portalsai.io` (no `SECURITY_EMAIL` set locally), "within 5 business days", "within 7 days", "within 30 days", the good-faith safe-harbor paragraph and "We don't run a paid bug bounty program." It has a `mailto:` link and a link to `/.well-known/security.txt`.
- [ ] Set the viewport to 375px wide. There is no horizontal scrollbar (`document.documentElement.scrollWidth === 375`), and long subprocessor lines wrap.
- [ ] Toggle the theme in the header to dark, then back. The page follows both themes and the text stays readable. — manual (visual judgment)

## §2 — Discoverability

- [ ] From `http://localhost:3002/`, the footer shows a **Security** link after Terms, and it goes to `/security/`. Spot-check the footer on `/pricing/` and `/privacy/` too.
- [ ] `http://localhost:3002/sitemap-0.xml` contains `<loc>…/security/</loc>`.
- [ ] `http://localhost:3002/llms.txt` lists Security, Privacy and Terms under "Canonical pages".

## §3 — One subprocessor list

- [ ] `/security/#subprocessors` lists **ten** entries in this order: Amazon Web Services (AWS), Auth0, Stripe, Google, Microsoft, Anthropic, Tavily, Mapbox, CARTO, OpenStreetMap Foundation. Under them is the residency note ("This list covers the hosted service…").
- [ ] CARTO reads "…loaded by your browser; it receives your IP address and the map area on screen, never your records. Used when you view a map in a portal."
- [ ] `/privacy/` → "Third parties we share it with" lists the same ten lines, word for word, followed by the webhook note ("Any custom webhook tool you register…").

## §4 — `/.well-known/security.txt`

- [ ] `curl -sS -D - http://localhost:3002/.well-known/security.txt` returns `200`, with exactly these lines in order:
  - `Contact: mailto:qa@portalsai.io`
  - `Expires: <about 180 days from now, e.g. 2027-04-20T…Z>`
  - `Preferred-Languages: en`
  - `Canonical: https://site-dev.portalsai.io/.well-known/security.txt`
  - `Policy: https://site-dev.portalsai.io/security/#disclosure`
- [ ] Rebuild with a contact set: `SECURITY_EMAIL=security@portalsai.io npm run build --workspace @portalai/site`. Then `apps/site/dist/.well-known/security.txt` reads `Contact: mailto:security@portalsai.io`, and `/security/#disclosure` shows that address after re-running `preview`. — manual (terminal)
- [ ] The build fails on an invalid file. In `apps/site/dist/.well-known/security.txt`, change the `Expires` line to `Expires: 2020-01-01T00:00:00Z` and run `node apps/site/scripts/verify-pages.mjs`. It exits `1` with `✗ security.txt: Expires … is not in the future`. Delete the `Policy:` line instead and it fails with `needs exactly one Policy`. Rebuild afterwards to restore the file. — manual (terminal)
- [ ] `apps/site/dist/.well-known/microsoft-identity-association.json` is still emitted next to `security.txt`. — manual (terminal)

## §5 — The egress guards

- [ ] **Server guard.** Add `const x = process.env.NEWVENDOR_API_KEY;` to any file under `apps/api/src/services/`, then run `npm run test:unit --workspace @portalai/api -- --testPathPattern subprocessor-egress`. It fails with `NEWVENDOR_API_KEY (read at src/services/…) is unclassified: does it reach a subprocessor?`. Revert. — manual (terminal)
- [ ] **Browser guard.** Add `const u = "https://cdn.newvendor.io/x.js";` to any non-test file under `apps/web/src/`, then run `npm run test:unit --workspace @portalai/web -- --testPathPattern subprocessor-browser-egress`. It fails naming `cdn.newvendor.io`. Revert. — manual (terminal)
- [ ] **Claim evidence.** In `.github/workflows/deploy-prod.yml`, change `BackupRetentionPeriod=14` to `BackupRetentionPeriod=7`, then run `npm run test:unit --workspace @portalai/site -- --testPathPattern security-controls`. It fails on `backups: .github/workflows/deploy-prod.yml still contains BackupRetentionPeriod=14`. Revert. — manual (terminal)

## §6 — Consistency with the existing copy

- [ ] `/privacy/` → **Security** reads "Traffic to the Service is encrypted in transit with TLS, and our database, file storage, and logs are encrypted at rest…" It doesn't say "encryption in transit and at rest", and "security page" is a working link to `/security/`. "Last updated" reads October 22, 2026.
- [ ] `/terms/` → **Your account** reads "You sign in through our identity provider, Auth0 — with your Google account, or with your organization's own single sign-on where it has been set up…" "Last updated" reads October 22, 2026.
- [ ] `docs/DEPLOYMENT_SECURITY_REVIEW.md` contains no "zero-retention" (`grep -ci zero-retention` → `0`), and its SaaS baseline §2 names the same ten subprocessors. — manual (terminal)
- [ ] `grep groq apps/api/package.json` prints nothing. — manual (terminal)
- [ ] `npx portalops vars describe --env local` (after `npm run build --workspace @portalai/devops-cli`) lists `SECURITY_EMAIL` as an SSM key marked site-config. — manual (terminal)
- [ ] Issue [#852](https://github.com/EnterpriseBT/portal-ai/issues/852) (ElastiCache encryption) exists, is typed Feature, and appears as a sub-issue of #578 with a row in its Status table. — manual (GitHub)

## §7 — After merge (app-dev)

These need the merged `main` deployed by `deploy-site-dev`. They aren't part of the pre-merge gate; record them on the PR once they're walked.

- [ ] `portalops vars get SECURITY_EMAIL --env app-dev` returns `qa@portalsai.io`, seeded by `deploy-dev`. — manual (AWS)
- [ ] `curl -sS -D - https://site-dev.portalsai.io/.well-known/security.txt` returns `200` and `content-type: text/plain; charset=utf-8`, with `Contact: mailto:qa@portalsai.io` and an `Expires` about 180 days after the deploy. — manual
- [ ] `https://site-dev.portalsai.io/security/` renders like §1, with the footer link present. — manual
- [ ] Before the first prod release: `SECURITY_EMAIL` is set on prod and the `security@` Workspace alias delivers. Otherwise the deploy's "Refuse to publish a QA security contact to prod" step stops the prod site deploy, as designed. — manual

## Error & edge cases

- [ ] With `SECURITY_EMAIL` blank (`SECURITY_EMAIL=" " npm run build --workspace @portalai/site`), the build still succeeds and `security.txt` shows `qa@portalsai.io`, never an empty `mailto:`. — manual (terminal)
- [ ] `/security/` has no client-side JavaScript beyond the header theme toggle: the Network panel shows no new script requests compared with `/privacy/`. — manual (visual)

## Sign-off

- [ ] §1–§6 and Error & edge cases verified against my own local build
- [ ] §7 verified on app-dev after merge
- [ ] `<date + name>` — confirmed

## Bug-filing template

Section: · Expected: · Got: · Repro: · Build env (`SITE_URL`, `SECURITY_EMAIL`): · Commit:
