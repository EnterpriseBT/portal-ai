# trust-security-posture — Adversarial Review

Adversarial probes for [#613](https://github.com/EnterpriseBT/portal-ai/issues/613): the public `/security/` page, RFC 9116 `security.txt`, the `SECURITY_EMAIL` contact address, and the guards that keep the public subprocessor list and control claims in step with the code. **Branch under test:** `feat/613-trust-security-posture` (PR [#853](https://github.com/EnterpriseBT/portal-ai/pull/853)).

The attack surface is narrow: a static site with no login and no request-time input. The hostile actors this change has to withstand are:
- a hostile or careless value written to SSM, which becomes build-time input;
- a researcher or scanner probing the published file;
- a contributor whose code change makes a public claim false while CI stays green.

The probes are built around those three.

## Preflight

### Environment
- [ ] `git checkout feat/613-trust-security-posture && git pull --ff-only && npm install`
- [ ] `npm run build --workspace @portalai/core && npm run build --workspace @portalai/site`
- [ ] The site is served on `http://localhost:3002`, by `npm run dev --workspace @portalai/site` or by `npm run preview --workspace @portalai/site` after a build. Probes marked *(preview)* need the built output.

### Fixtures
- [ ] None. The site is public and static. `portalops` probes run with `--env local`, plus `--env app-dev` / `--env prod` only where the probe says so; those need AWS credentials and are tagged `— manual`.

### Reset between runs
- [ ] Revert every source edit a probe makes (`git checkout -- <file>`), then rebuild the site (`npm run build --workspace @portalai/site`) so `dist/` holds the branch's real output.

## §1 — Boundary & limit inputs

- [ ] **Whitespace-only contact.** `SECURITY_EMAIL="   " npm run build --workspace @portalai/site`. Safe behaviour: the build succeeds and `dist/.well-known/security.txt` reads `Contact: mailto:qa@portalsai.io`. There is never an empty `mailto:`, and the footer and disclosure links aren't dead. — backend
- [ ] **A contact that isn't an address.** `SECURITY_EMAIL="security team" npm run build --workspace @portalai/site`. Safe behaviour: the build **fails** at `verify-pages` with `needs exactly one Contact: mailto:<address>`, and nothing is published. — backend
- [ ] **`Expires` at the edge.** In a built `dist/.well-known/security.txt`, set `Expires:` to one minute in the past, then to one minute in the future, running `node apps/site/scripts/verify-pages.mjs` after each. Safe behaviour: the past value fails with `is not in the future`; the future value passes. — backend
- [ ] **Slashless and trailing-slash paths** *(preview)*. Request `http://localhost:3002/.well-known/security.txt/` (trailing slash) and `http://localhost:3002/security/index.html`. Safe behaviour: the trailing-slash path returns 404 and never serves the HTML 404 page as a `text/plain` security policy; `/security/index.html` serves the security page.

## §2 — Malformed & injection input

- [ ] **Markup in the contact.** `SECURITY_EMAIL='x"><script>alert(1)</script>@evil.io' npm run build --workspace @portalai/site`, then open `http://localhost:3002/security/#disclosure` *(preview)*. Safe behaviour: no script runs and no alert appears. The address renders as literal escaped text, and the `mailto:` `href` is attribute-escaped (`&quot;`, `&lt;`). Inspect the DOM: `#disclosure script` matches nothing. — manual (needs the hostile rebuild)
- [ ] **Field injection through a newline.** `SECURITY_EMAIL=$'security@portalsai.io\nPolicy: https://evil.example/' npm run build --workspace @portalai/site`. Safe behaviour: the build **fails** at `verify-pages`, because the file now carries two `Policy:` lines or one on a foreign origin. A second field can't be smuggled into the published file. — backend
- [ ] **Output injection in the deploy step.** Read `.github/workflows/deploy-static-site.yml` → "Resolve contact addresses". A `security-email` SSM value containing a newline would write extra `$GITHUB_OUTPUT` lines. Safe behaviour: only operators can write the value (SSM, with `portalops` guards), and the `security.txt` check above fails any build it corrupts. Record the observation in Findings; it's accepted risk, not a defect, if both hold. — backend

## §3 — Concurrency & races
- N/A. A static build has no runtime state or shared mutable objects. The two site-deploy triggers (release + monthly schedule) share `concurrency: deploy-site-prod` with `cancel-in-progress: false`, so they queue rather than interleave.

## §4 — Auth & permission boundaries

- [ ] **Unconfirmed prod write.** `npx portalops vars set SECURITY_EMAIL security@portalsai.io --env prod` (no `--yes --confirm-prod`). Safe behaviour: exit `5` (confirmation required), and the parameter is unchanged (`vars get` before and after). — manual (needs prod AWS credentials; a read-only credential is enough to see the refusal)
- [ ] **Unconfirmed staging write.** `npx portalops vars set SECURITY_EMAIL qa@portalsai.io --env app-dev` (no `--yes`). Safe behaviour: exit `5`, and nothing is written. — manual (AWS)
- [ ] **QA contact reaching prod.** Run the body of "Refuse to publish a QA security contact to prod" locally against a default build: `F=apps/site/dist/.well-known/security.txt; grep -q 'qa@portalsai.io' "$F" && echo REFUSED`. Safe behaviour: it prints `REFUSED`, which is the condition that exits `1` in the prod deploy. Confirm the step is gated `if: inputs.environment == 'prod'`, so app-dev's intended `qa@` still deploys. — backend

## §5 — Multi-tenant isolation
- N/A. The pages are public, built once for everyone, and read no org, user or customer data. The build reads only the public site-config tiers and build env. Nothing tenant-scoped exists to leak or cross.

## §6 — State & lifecycle abuse (the guards' honesty)

Each probe makes a change that would make a public statement false, and the guards must catch it:

- [ ] **A control removed under its claim.** In `apps/api/Dockerfile`, delete the `USER node` line, then run `npm run test:unit --workspace @portalai/site -- --testPathPattern security-controls`. Safe behaviour: it fails on `vulnerability-management: apps/api/Dockerfile still contains USER node`. Revert. — backend
- [ ] **An integration removed but still published.** Delete the `TAVILY_API_KEY` line from `apps/api/src/environment.ts`, then run `npm run test:unit --workspace @portalai/api -- --testPathPattern subprocessor-egress`. Safe behaviour: it fails twice, on a stale `TAVILY_API_KEY` classification and on `"tavily"` being published but unreached. Revert. — backend
- [ ] **A browser vendor removed but still published.** In `apps/web/src/modules/MapWidget/utils/map-config.util.ts`, change both CARTO URLs to `https://tiles.example-cdn.io/...`, then run `npm run test:unit --workspace @portalai/web -- --testPathPattern subprocessor-browser-egress`. Safe behaviour: it fails on the unclassified `tiles.example-cdn.io` **and** on `carto` being published but unreached. Revert. — backend
- [ ] **A fixed claim resurrected.** In `apps/site/src/pages/privacy.astro`, put the old sentence "We protect your data with encryption in transit and at rest" back into the Security section, then run the `security-controls` test. Safe behaviour: it fails on `privacy's Security section claims no blanket encryption`. Revert. — backend
- [ ] **An overclaim slipped into the page.** Append " We are SOC 2 certified." to any claim in `apps/site/src/lib/security-controls.ts`, then run the `security-controls` test. Safe behaviour: `FORBIDDEN_CLAIMS` fails, naming `"SOC 2"` and `"certified"`. Revert. — backend

## §7 — Misuse sequences

- [ ] **A researcher follows the file.** Open `http://localhost:3002/.well-known/security.txt`, take the `Policy:` URL's path and fragment (`/security/#disclosure`), and open it on the local site. Safe behaviour: it lands on the "Reporting a vulnerability" section, which shows the same address as the file's `Contact:`.
- [ ] **A reader treats the privacy list as complete.** Compare `/privacy/` → "Third parties we share it with" with `/security/#subprocessors`. Safe behaviour: the lists are identical (10 entries, same text). The browser-loaded map providers (CARTO, OpenStreetMap) appear in **both**, so neither page under-discloses.
- [ ] **A map spec names its own basemap URL.** Read `resolveBasemapStyle` in `apps/web/src/modules/MapWidget/utils/map-config.util.ts`: an explicit `{ url }` basemap is fetched by the viewer's browser from a host no guard classifies. Safe behaviour: the gap is acknowledged in `subprocessor-browser-egress.guard.test.ts`'s header (a runtime host, like a webhook endpoint), and the public webhook note states the same principle. Record in Findings whether you accept that or want a follow-up (e.g. an allowlist for basemap hosts). — backend

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | | |

## Sign-off
- [ ] Every probe walked; findings resolved or waived with a reason
- [ ] `<date + name>`: confirmed against my own local build

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Build env (`SITE_URL`, `SECURITY_EMAIL`): · Commit:
