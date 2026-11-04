# Self-hosted deployment on the marketing site — Condensed design (#961)

**Issue:** [EnterpriseBT/portal-ai#961](https://github.com/EnterpriseBT/portal-ai/issues/961) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Enterprise customers can install Portals AI as one Helm release on their own Kubernetes cluster (#566). The marketing site mentions this only in passing, so a prospect with residency or security requirements can't tell the option exists. This ticket adds short, plain marketing copy saying what that install offers, as it ships today. Only `apps/site` changes.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Feature pillars | `apps/site/src/pages/features.astro:13` (`PILLARS`) | `{id, heading, lede, points[]}`, each rendered as an `h2` section |
| Existing passing mention | `apps/site/src/pages/features.astro:56` | "…and deployment in your own cloud — see Pricing or talk to us." |
| Pricing cards | `apps/site/src/pages/pricing.astro:47` | entirely data-driven from the site-config snapshot; nothing is keyed on a tier slug |
| Plan feature list | `apps/site/src/lib/pack-label.ts:21` (`planFeatures`) | derived from tier flags (`customRbac`, etc.); no residency flag exists |
| Pricing footer line | `apps/site/src/pages/pricing.astro:124` | "Need something that isn't listed…? Get in touch." |
| What the chart ships | `deploy/helm/portalai/README.md` | one release; bundled or managed Postgres/Redis/S3; OIDC (`values.yaml:96`); `ANTHROPIC_BASE_URL` (README:309); pre-upgrade migrate job (`templates/upgrade-job.yaml`) |
| Image gate | `docs/SUPPLY_CHAIN.md` | Trivy-scanned, cosign-signed, SBOM + provenance |

## Decision — where the Pricing line lives

- **A. Tier description via site-config** (`portalops tier apply`). This is data rather than code, but the copy would then live in tier rows across envs, invisible to review, and it would describe a deployment model rather than a plan's allowance.
- **B. Hard-code it on the Enterprise card** (`tier.slug === "enterprise"`). This breaks the page's rule that it never keys on tier data ("nothing is hardcoded").
- **C. Extend the footer line** under the cards. This is static, reviewed copy that sits next to the Enterprise card and doesn't touch the data-driven grid.

**Decision: C.** The footer is already where custom arrangements are mentioned, and residency is one of those arrangements, not a plan allowance.

## Decision — Features placement and copy

Add a sixth pillar, `id: "self-hosted"`, after `share` and before `extend`, so it follows the sentence that already points at it. Change the `share` bullet's tail to "and deployment in your own cloud (see below)", which keeps one mention plus the section rather than two competing descriptions. Update the doc comment's pillar count. Draft copy (refine in review):

- **Heading:** Run it in your own cloud
- **Lede:** Enterprise teams can run Portals AI on their own Kubernetes cluster, so the data, the database and the people who can reach them all stay inside their own environment.
- **Points:**
  - Installs with a single Helm chart, so it fits the way you already run software.
  - Runs on your managed PostgreSQL, Redis and S3-compatible storage, or bundled ones for a quick evaluation.
  - Sign-in goes through your own identity provider, and the AI calls go to the endpoint you choose.
  - Images are signed and vulnerability-scanned, and upgrades apply database changes as part of the install.

**Pricing footer:** "Need something that isn't listed — higher allowances, a private toolpack, an invoice instead of a card, or a deployment in your own cloud? Get in touch."

Every point maps to a row in the Current shape table. There's no roadmap item, vendor certification or cloud-provider name.

## Plan — one slice

**Files**
- Edit: `apps/site/src/pages/features.astro`: new pillar, the `share` bullet tail, the comment count.
- Edit: `apps/site/src/pages/pricing.astro`: the footer sentence.

**Tests**
- No logic changes, so no new unit test (the site's tests cover `lib/` helpers, not page copy). Run `npm run build`, `npm run lint`, `npm run format:check` and `npm run test:unit` in `apps/site`.

## Smoke (manual, against your dev stack)

1. `npm run dev` in `apps/site` and open http://localhost:3002/features/. "Run it in your own cloud" appears between the sharing and extend sections, with its lede and four points, and the sharing bullet now says "(see below)".
2. Open http://localhost:3002/pricing/. The line under the cards mentions a deployment in your own cloud, and "Get in touch" goes to `/contact/`.
3. Toggle dark theme and narrow the window to phone width (~375px). Both pages read cleanly, with no horizontal scroll.
4. Read the new copy against `deploy/helm/portalai/README.md`. Every claim is something the chart does today.

## Out of scope

- A `/security/` residency paragraph, which needs code evidence in `security-controls.test.ts`.
- A dedicated self-hosted page, install docs, or a public link to the chart README.
- A residency tier flag or pricing change.
