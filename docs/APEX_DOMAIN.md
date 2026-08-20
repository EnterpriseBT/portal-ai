# Bare domain (apex) — Condensed design (#404)

**Issue:** [EnterpriseBT/portal-ai#404](https://github.com/EnterpriseBT/portal-ai/issues/404) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `portalsai.io` has no address record, so the bare domain people type, link, and print fails to resolve. The name itself exists — the zone holds apex `MX`/`TXT` and `_dmarc` — so an `A` query returns NODATA, not NXDOMAIN: this adds a record *type* to an existing record set. Production is live (`www`/`app`/`api` all serve; #83 and #386 closed 2026-08-17), which makes the apex the last address that doesn't work. Infrastructure only: one CloudFormation template, two workflow files, one guard test.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Single alias | `infra/cloudformation/site.yml:195-196` | `Aliases` holds exactly `${Subdomain}.${DomainName}` |
| Single record set | `site.yml:236-245` | one `A` alias → CloudFront. No `AAAA`, despite `IPV6Enabled: true` (`:230`) |
| Existing edge function | `site.yml:160-186` (`SiteIndexRewrite`) | already a `viewer-request` function on the default behavior — the pattern is established here |
| Certificate | `infra/cloudformation/dns-certs.yml:20-25` | `CN=portalsai.io` + SAN `*.portalsai.io`. **Verified live:** that is the cert `www` serves today (to 2026-10-24) |
| Apex mail records | `infra/cloudformation/dns-email.yml:82-127` | domain-level stack `portalai-dns-email` (no `Environment`) owns apex `MX` + `TXT` and `_dmarc` |
| Stack params | `.github/workflows/deploy-static-site.yml:102-110` | `Environment`, `Subdomain`, `CertificateArn`, `HostedZoneId` |
| Prod caller | `deploy-site-prod.yml:87-92` | `subdomain: www`, `site-url: https://www.portalsai.io` |
| Canonical host | `apps/site/src/layouts/Base.astro:34,59` | `<link rel="canonical">` from `Astro.site` = `SITE_URL` |

## Decision — the apex joins the existing distribution and the edge function 301s it

**Canonical host is `www`, and that is already settled** — not a preference. Every published page bakes `canonical`, `og:url`, and the sitemap from `SITE_URL` = `https://www.portalsai.io`. Making the apex canonical would mean rebuilding the site under a new origin and orphaning already-indexed `www` URLs. So: apex → `www`, permanently.

The ticket offered three mechanisms; a fourth dominates them:

| | Mechanism | Verdict |
|---|---|---|
| A | Second distribution + a function issuing the 301 | Works, but a whole second distribution to serve nothing but redirects |
| B | S3 website-redirect bucket behind CloudFront | **Worse than A.** S3 website endpoints are HTTP-only, so it still needs a distribution *and* a public bucket — against this template's private-bucket + OAC posture (`site.yml:66-70`, `:101-110`) |
| C | Apex alias → the `www` distribution, no redirect | Rejected by Deliverable 1 — identical content on two hosts |
| **D** | **Apex alias → the `www` distribution, `SiteIndexRewrite` returns the 301** | **Chosen** |

**D adds no distribution and no bucket.** The apex becomes a second entry in the existing distribution's `Aliases` (the cert already covers it) plus a conditional apex `A` alias record, and the existing viewer-request function gains a host check that returns a 301 before it does any index rewriting. C's duplicate-content problem disappears because the apex never reaches an origin.

Merging into `SiteIndexRewrite` rather than adding a second function is **forced, not stylistic**: CloudFront permits one function association per event type per cache behavior. Two consequences shape the code — the host check must come *first* (no point rewriting a URI about to be discarded), and function-generated responses are produced before the cache lookup, so the 301 is per-request and cannot be cached against the wrong host.

Two details the redirect must get right:

- **Query strings** — `request.querystring` is a map in `cloudfront-js-2.0`, not a raw string, so it is reassembled key-by-key including `multiValue` entries. Dropping duplicates would silently mangle campaign links.
- **A trailing `index.html` is stripped when building `Location`.** The interaction between `DefaultRootObject` (`site.yml:197`) and viewer-request functions decides whether `/` arrives as `/` or as `/index.html`; normalizing makes `curl -I https://portalsai.io` → `Location: https://www.portalsai.io/` true either way, rather than resting on that ordering. Smoke checks it explicitly.

**Ownership: `site.yml`, not `dns-email.yml`.** The mail stack is domain-level and deliberately environment-free (`dns-email.yml:6-14`); pointing it at a per-environment CloudFront distribution would invert that. And the apex is a prod-only concept — dev has no apex — so it belongs behind a condition in the per-environment stack that already owns the `www` record.

## Plan — one slice

**Files**

- Edit `infra/cloudformation/site.yml` — add `ApexDomain` parameter (default `""`); `Conditions: HasApex: !Not [!Equals [!Ref ApexDomain, ""]]`; make `Aliases` `!If [HasApex, [www, apex], [www]]`; extend `SiteIndexRewrite`'s code with the host check + 301 (canonical host `!Sub "${Subdomain}.${DomainName}"`); add `ApexDnsRecord` (`Type: A`, alias → the same distribution, `Condition: HasApex`).
- Edit `.github/workflows/deploy-static-site.yml` — new optional `apex-domain` input (default `""`), passed through as `ApexDomain=`.
- Edit `.github/workflows/deploy-site-prod.yml` — pass `apex-domain: portalsai.io`.
- `deploy-site-dev.yml` — **unchanged**, rides the empty default. That is the dev-unaffected guarantee.

**Tests** — extend `packages/devops-cli/src/__tests__/deploy-parity.test.ts`, following that file's comment-stripped-text convention (`:430`):

- the prod site caller passes `apex-domain: portalsai.io`;
- the dev caller passes no `apex-domain` (the apex is prod-only);
- `site.yml`'s apex alias entry and apex record set are both gated on `HasApex` — no unconditional apex resource;
- the existing "no prod cert stack" pins (`:437,445`) stay green — this ticket adds no certificate.

Then `npm run test:unit`, `npm run lint`, `npm run type-check`.

## Smoke (manual, against your dev stack)

1. `aws cloudformation validate-template --template-body file://infra/cloudformation/site.yml` passes.
2. Dev deploys first and is unchanged: `deploy-site-dev` green, `https://site-dev.portalsai.io/` still 200, and the dev stack gained no apex record.
3. Publish a release (or dispatch `deploy-site-prod`) → green.
4. `curl -sI https://portalsai.io` → **301**, `Location: https://www.portalsai.io/` — exactly that, no `/index.html`.
5. `curl -sI "https://portalsai.io/pricing/?x=1&x=2&y=3"` → `Location` keeps the path **and** every query pair, duplicates included.
6. `curl -sI http://portalsai.io` → redirects to HTTPS (two hops is expected: `redirect-to-https`, then the function's 301).
7. The apex presents the **existing** wildcard cert: `openssl s_client -connect portalsai.io:443 -servername portalsai.io` shows `CN=portalsai.io`, SANs `portalsai.io, *.portalsai.io`. No `portalai-prod-dns-certs` stack exists.
8. `https://www.portalsai.io/` still serves the site, and a deep page (`/pricing/`) still resolves through the index rewrite — the function's other job.
9. **Mail records intact**, by live query not inspection: apex `MX` lists all five Google hosts; apex `TXT` carries **both** the SPF string and the `google-site-verification` token; `_dmarc` reads `v=DMARC1; p=none; rua=mailto:admin@portalsai.io; fo=1`.

## Out of scope

- **`AAAA` alias records.** The distribution sets `IPV6Enabled: true` but the stack creates only an `A` record — so `www` is already IPv4-only in DNS. Matching that shape keeps this change minimal; closing the gap for both hosts is its own ticket.
- Moving the certificate to a domain-level stack — the right end state (`docs/PROD_MARKETING_SITE.md:33`), still its own ticket.
- Redirecting apex paths to the **app**; analytics, consent, or canonical-tag work in the site.
- HSTS preload or an apex-specific response-headers policy.
