# Move CI actions off Node 20 and pin the runner image — Condensed design (#904)

**Issue:** [EnterpriseBT/portal-ai#904](https://github.com/EnterpriseBT/portal-ai/issues/904) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Every CI and deploy job carries two deprecation warnings. Our actions target Node 20, which the runner currently forces onto Node 24 and will eventually refuse. And `ubuntu-latest` is migrating to Ubuntu 26. The change bumps each action to its current Node 24 major and replaces the floating runner label with an explicit one. It's `.github/` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `actions/checkout@v4` ×20, `aws-actions/configure-aws-credentials@v4` ×9, `docker/build-push-action@v6` ×6 | `.github/workflows/*.yml`, `.github/actions/*` | Node 20 |
| `actions/setup-node@v4` ×3 | `.github/actions/setup/action.yml:39`, `npm-audit.yml:53`, `deploy-dev.yml:138` | The repo declares `"packageManager": "npm@10.9.2"` (`package.json:45`) |
| `actions/cache/restore@v4` + `save@v4` | `.github/actions/setup/action.yml:27`, `:59` | #857's exact-key node_modules cache; npm's download cache only on a miss (`cache: … 'npm' \|\| ''`) |
| `actions/cache@v4` | `.github/actions/playwright-browsers/action.yml:14` | Playwright browsers |
| `upload-artifact@v4` ×3, `download-artifact@v4` ×1 | `integration-test.yml:148`, `:188` (`pattern: integration-jest-*`), `e2e-test.yml:112`, `actions/verify-login/action.yml:63` | Shard reports feed the required Integration Tests summary |
| `setup-buildx@v3`, `setup-qemu@v3` ×2 each; `azure/setup-helm@v4` | deploy workflows; `static-checks.yml` | Node 20 |
| Runner | 20 × `runs-on: ubuntu-latest` | Static Checks' latest run already reports `Image: ubuntu-26.04` (20261025.179), and it was green |

## Decision — current majors, setup-node's auto-cache off, runner pinned to `ubuntu-26.04`

- **Action versions.** Use the latest major of each: checkout v7, setup-node v7, cache (and restore/save) v6, upload-artifact v7, download-artifact v8, configure-aws-credentials v6, build-push v7, setup-buildx v4, setup-qemu v4, setup-helm v5. The release notes list these breaking changes, and none needs an input change from us except setup-node:
  - **setup-node v5+ caches automatically** whenever `package.json` has `packageManager`, which ours does. That would restore npm's download cache in every job, including cache hits, undoing #857's miss-only choice. Set `package-manager-cache: false` on all three setup-node uses; the explicit `cache:` input keeps working.
  - **download-artifact v5** changed the path for a single artifact downloaded by ID. We download by `pattern`, so this doesn't apply. **v8** turns a hash mismatch into an error (it used to warn), which is the behavior we want for the shard reports.
  - The rest only switch the runtime to Node 24 (runner ≥ 2.327.1, which hosted runners have) or update dependencies; cache v6 is an ESM migration with the same inputs and outputs.
  - Majors only (`@v7`), not SHA pins: that matches the repo today. SHA pinning is a separate supply-chain decision.
- **Runner label.** Options: keep `ubuntu-latest` (it follows GitHub's schedule, warns during each migration, and moves the node_modules cache key and the toolchain under us without a commit), or pin an image. **Chosen: pin `ubuntu-26.04`.** Our jobs already run there and passed today, so pinning changes nothing now, removes the warning, and makes the next OS move a reviewed one-line change.
- `lint:ci-cache` keeps passing: no job names, required checks or concurrency literals change.

## Plan — 1 slice

**Files:** every `.github/workflows/*.yml` that uses one of these actions or `runs-on`, plus `.github/actions/{setup,playwright-browsers,verify-login}/action.yml`.

**Tests:**
- `npm run lint:ci-cache`. The `.github/` YAML stays parseable: the checker reads every workflow.
- No more Node 20 or `ubuntu-latest` references: `grep -rn "@v4\b\|ubuntu-latest" .github` lists only actions already current (`amazon-ecr-login@v2` and the like).
- CI on the branch runs every workflow except the deploys.

## Smoke (manual, against your dev stack)

1. CI on the PR is green: Static Checks, Unit Tests, Integration Tests (all shards plus the summary, which downloads every shard's report) and E2E Tests (which uploads artifacts). No "Node.js 20 is deprecated" or `ubuntu-latest` annotation on any job.
2. In one job's "Setup" log: a node_modules cache **hit** restores no npm download cache. setup-node's own cache is off, so there's no "Cache restored" line from it.
3. After merge: deploy-dev (deploy-infra, deploy-frontend, deploy-backend with Trivy, push and cosign) is green, with no deprecation annotations. — manual

## Out of scope

- **SHA-pinning actions** (supply-chain hardening): its own decision, with Dependabot to keep pins fresh.
- **Ubuntu 26's own package changes** beyond what CI exercises. CI and one deploy are the check.
- **The cosign 409** seen on 2026-10-28's deploy-dev re-run. It's tracked separately if it recurs.
