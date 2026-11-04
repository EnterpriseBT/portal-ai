# Site deploy ref at approval — Condensed design (#959)

**Issue:** [EnterpriseBT/portal-ai#959](https://github.com/EnterpriseBT/portal-ai/issues/959) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** **Deploy Site (prod)** decides what to build when it starts, but its deploy job waits for the `prod` environment's reviewers. A scheduled or dispatched run started before a release and approved after it therefore builds the old release against the new API. Run 41322287092 did exactly that on 2026-11-04: it built `v1.1.2` against v1.2.0's site-config and failed. The fix re-picks the latest release inside the gated job, after approval. CI workflows only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Ref resolution | `.github/workflows/deploy-site-prod.yml:46-65` (`resolve` job) | a release run uses its tag; a schedule/dispatch run uses `gh release view` *now* |
| Handoff | `deploy-site-prod.yml:98` `build-ref: ${{ needs.resolve.outputs.ref }}` | fixed at start |
| The gate | `deploy-static-site.yml:89` `environment: ${{ inputs.gh-environment }}` | the job waits here; a reusable-workflow caller can't run a step after it |
| Checkout + summary | `deploy-static-site.yml:94-97`, `:288` | both read `inputs.build-ref` |
| Dev caller | `deploy-site-dev.yml:44` `build-ref: main` | no gate concerns; unchanged |
| Guards | `packages/devops-cli/src/__tests__/deploy-parity.test.ts` (site cases `:461-640`) | pins site workflow invariants by reading the YAML |

## Decision — re-resolve inside the gated job

Two options:
- **Re-resolve.** A new input, `follow-latest-release` (boolean, default false). When it's true, the gated job's first step looks up the latest release and builds that, with a notice when it differs from `build-ref`.
- **Stand down.** Skip the run when it's been superseded.

**Chosen: re-resolve.** The scheduled run exists to "publish whatever is currently released" (and renew `security.txt`), so building the current release keeps that job instead of skipping it.

- The prod caller passes `follow-latest-release: ${{ github.event_name != 'release' }}`. A release run keeps its own tag: it *is* the current release when it's published, and a later release starts its own run.
- The step runs after the environment gate (it's in the gated job), uses `gh release view --repo ${{ github.repository }}` with the job's `contents: read` token, and needs no checkout.
- Checkout and the summary read the resolved ref.
- `PublicSiteTierSchema` stays strict: strictness is what catches site/API drift.

## Plan — 1 slice

**Files:**
- `deploy-static-site.yml`:
  - the `follow-latest-release` input;
  - a `Resolve the ref to build` step (`id: ref`) before checkout;
  - checkout and summary use `steps.ref.outputs.ref`.
- `deploy-site-prod.yml`: pass the input, and update the header comment.

**Tests (first):** a new `describe` in `deploy-parity.test.ts`, red on today's YAML:
- the reusable workflow declares the input, default false;
- the resolve step comes before the checkout, inside the gated job;
- checkout and summary read `steps.ref.outputs.ref`, not `inputs.build-ref`;
- the prod caller passes `github.event_name != 'release'`;
- the dev caller doesn't pass it.

Run `npm run test:unit -- --testPathPattern deploy-parity` in `packages/devops-cli`, then `npm run lint:ci-cache` at the root.

## Smoke (manual, against your dev stack)

1. After merge, run **Deploy Site (prod)** by `workflow_dispatch` and approve it. The deploy job's "Resolve the ref to build" step logs `Building from release tag: v1.2.0`, and the summary says `Built from: v1.2.0`. The site stays healthy: `/`, `/security/` and `security.txt` all return 200.
2. **The race itself, on the next release:** start a dispatch run, leave it waiting, publish the release, then approve the dispatch. It logs a notice that it's building the newer tag instead, and succeeds. Record the result on #959 when it happens. — manual, post-release

## Out of scope

- Loosening the site-config schema (deliberately strict).
- The dev site deploy: it builds `main` with no reviewer gate, so it can't go stale this way.
