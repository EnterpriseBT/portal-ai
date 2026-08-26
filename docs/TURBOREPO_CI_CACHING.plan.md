# Turborepo remote caching in CI — Plan

**TDD-sequenced implementation of the remote cache: the guard harness first, then hash correctness, the deterministic build version, the credentials that make the cache live, the integration-suite flip, and the deploy opt-in.**

Spec: `docs/TURBOREPO_CI_CACHING.spec.md`. Discovery: `docs/TURBOREPO_CI_CACHING.discovery.md`. Issue: #454.

Six slices, each behind a green check and each leaving the repo compilable **and CI green at its boundary**. They land as **commits on `feat/turborepo-ci-caching`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/web && npm run test:unit
npm run lint:ci-cache          # from the repo root — the guard
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

## Sequencing rationale

CI configuration has no natural unit-test surface, so **the guard script is built first and becomes the test harness for every config slice that follows.** Each config slice adds a guard rule that fails, then the config that greens it — real red-then-green, no "verify by squinting at YAML".

- **Slice 1** — the guard, carrying only the two rules that already hold today (job names, concurrency literals). Establishes the harness and pins two pre-existing invariants nothing currently tests. Green on arrival.
- **Slice 2** — hash correctness in `turbo.json` + `apps/site/turbo.json`, driven by a new guard rule. No credentials yet, so nothing can be restored from anywhere — the safest possible place for the change that prevents the prod-bleed.
- **Slice 3** — deterministic `version.json`. Pure app-code bug fix with jest cases; independent of everything else.
- **Slice 4** — credentials + explicit `workflow_call` secrets, driven by the guard's remaining two rules. **The cache goes live for the three suites here** — the ticket's measured win.
- **Slice 5** — `test:integration` flipped to cacheable. Isolated deliberately: it is the highest-risk change in the ticket and earns its own reviewable commit and its own smoke proof.
- **Slice 6** — deploy workflows opt in, `turbo` on the devcontainer PATH, docs.

**Ordering constraint that drives everything:** the guard's rules 1–2 ("a workflow that runs turbo must declare `TURBO_TOKEN`/`TURBO_TEAM`") are **red against today's tree**. They therefore cannot land before the credentials do — so they arrive *with* slice 4, not in slice 1. Landing them earlier would leave `npm run lint:ci-cache` red at a slice boundary, which the plan's own rules forbid.

**No migration, no seed** — no schema change (spec §Migration/§Seed).

### Prerequisite before slice 4

Three repo settings must exist, and they are the user's to create — not a code change:

| Name | Kind | Status |
|---|---|---|
| `TURBO_TOKEN` | secret | **set** |
| `TURBO_TEAM` | variable | **set** |
| `TURBO_REMOTE_CACHE_SIGNATURE_KEY` | secret | **not yet — generate before slice 4** |

Slices 1–3 need none of them.

---

## Slice 1 — The guard harness (`lint:ci-cache`), rules 3–4 only

Stand up `scripts/check-ci-cache.mjs` with its fixture self-check, wired into CI beside `lint:doc-pointers`. It ships with only the two rules that pass against today's tree, so CI is green the moment it lands — and two invariants that were previously protected by comments alone become mechanically enforced.

**Files**

- New: `scripts/check-ci-cache.mjs` — the checker, exporting a pure `findViolations(workflows)` predicate plus embedded fixture cases; `--self-test` runs fixtures, default run does fixtures **then** the real `.github/` tree.
- Edit: `package.json` — `"lint:ci-cache": "node scripts/check-ci-cache.mjs"`; promote `yaml` from a transitive dep to an explicit root devDependency.
- Edit: `.github/workflows/unit-test.yml` — a step running `npm run lint:ci-cache`, beside the existing `lint:doc-pointers` step (`unit-test.yml:43`).

**Steps**

1. **Tests (spec guard cases 6, 7, 8).** Add fixtures: a job renamed from `Static Checks` → violation; a `concurrency.group` starting with `${{ github.workflow` → violation; the real `.github/` tree → clean. Run `npm run lint:ci-cache`; the fixture cases fail because the rules don't exist yet.
2. **Implement** `findViolations` with **rule 3** (the three required-check job names are exactly `Unit Tests`, `Integration Tests`, `Static Checks`) and **rule 4** (those three workflows' `concurrency.group` starts with a literal, not `${{ github.workflow`). Parse with `yaml`. Green — including case 8 against the real tree.
3. Wire the CI step. Lint + type-check.

**Done when:** `npm run lint:ci-cache` passes locally and in CI; renaming any of the three jobs, or swapping a concurrency literal for `github.workflow`, fails it. Rules 1–2 do not exist yet.

**Risk:** low. The one thing to watch is that `yaml` must be a real root devDependency — relying on it as a transitive dep is exactly the kind of thing that breaks on a clean `npm ci`.

---

## Slice 2 — Hash correctness: `turbo.json` + `apps/site/turbo.json`

Close the cache-poisoning path **before** any credential exists to exploit it. Adds the signature block, `globalDependencies`, and the package config that makes `apps/site#build` uncacheable with its env documented.

**Files**

- Edit: `turbo.json` — `remoteCache: { signature: true }`; `globalDependencies: ["docker-compose.yml"]`. (`test:integration` is **not** touched here — that is slice 5.)
- Edit: `apps/site/turbo.json` — **the file already exists** with `cache: false` and eight `passThroughEnv` names; this slice adds only the in-file rationale. The enforcement is rule 5.
- Edit: `scripts/check-ci-cache.mjs` — **new rule 5**.

**Steps**

1. **Tests (spec guard cases 8–9, rule 5).** Add the fixture pair plus the real-tree assertion (spec case 10): `apps/site`'s `build` task must resolve to `cache: false` **and** declare a non-empty `env`. Run; fail.
2. **Implement** the two config files. Green.
3. **Verify the poisoning path is closed** (manual, recorded in the smoke doc): `npx turbo run build --filter=@portalai/site --dry=json` reports `cache.local: false`; two dry runs with different `SITE_URL` no longer both report `0e93daf1a79163a4` as a *cacheable* hash.
4. Lint + type-check.

**Done when:** rule 5 passes; the site build reports uncacheable; `docker-compose.yml` appears in the global hash inputs.

**Risk:** `globalDependencies` means any `docker-compose.yml` edit invalidates every task (spec §2 note, accepted). Watch for a surprising full miss right after slice 6, which also touches the devcontainer — that is expected, not a bug.

---

## Slice 3 — Deterministic `version.json`

Replace the per-invocation UUID with a commit-derived value. Independent of the cache work; fixes the pre-existing bug where rebuilding an unchanged commit prompts every connected user to reload.

**Files**

- New: `apps/web/src/utils/build-version.util.ts` — `resolveBuildVersion(env) → string`.
- New: `apps/web/src/__tests__/build-version.util.test.ts` — the six cases.
- Edit: `apps/web/vite.config.ts:35` — `crypto.randomUUID()` → `resolveBuildVersion(process.env)`; drop the now-unused `crypto` import if nothing else needs it.

**Steps**

1. **Tests (spec `apps/web` cases 1–6).** `"abc123"` → `"abc123"`; `"  abc123  "` → trimmed; unset → `"dev"`; `""` → `"dev"`; `"   "` → `"dev"`; two calls with identical env → identical output. Run from `apps/web`; fail.
2. **Implement** the util. Green.
3. **Wire** `vite.config.ts`. Confirm by hand that two consecutive forced builds of the same commit now emit the **same** `version.json` — the inverse of the `c10a2478…` / `3d9c812e…` result recorded in the spec.
4. Lint + type-check.

**Done when:** all six cases pass; two builds of one commit agree; a local build reports `"dev"`.

**Risk:** the only slice that changes application behavior. The behavior it changes is a defect, and `SidebarNav.component.tsx:198-199` already displays the same SHA, so the app gains one consistent build identity rather than two disagreeing ones.

---

## Slice 4 — Credentials, explicit `workflow_call` secrets — **the cache goes live**

Attach the three env vars and make the reusable-workflow secret contract explicit. Guard rules 1–2 land here, in the same commit as the wiring that satisfies them.

**Files**

- Edit: `.github/workflows/unit-test.yml`, `integration-test.yml`, `static-checks.yml` — a workflow-level `env:` block (spec §5a) and an `on.workflow_call.secrets` declaration (spec §5b), with the comment recording that an absent token degrades to a silent no-op.
- Edit: `.github/workflows/deploy-dev.yml:29-39`, `deploy-prod.yml:51-61` — the explicit `secrets:` map at all six call sites.
- Edit: `scripts/check-ci-cache.mjs` — rules 1 and 2.

**Steps**

1. **Tests (spec guard cases 1–5).** Fixtures: `turbo run` without `TURBO_TOKEN` → violation; with both vars in workflow-level `env` → clean; `npm run build` without the vars → violation; a call site omitting a declared secret → violation; passing it → clean. Run; the fixtures fail, **and so does the real-tree case** — which is the point: the tree does not yet satisfy the rule.
2. **Implement** rules 1–2, then the three `env:` blocks, the three `workflow_call.secrets` declarations, and the six call-site maps — all in this slice, so the boundary is green.
3. Green: `npm run lint:ci-cache` passes fixtures **and** the real tree.
4. Lint + type-check.

**Sequencing detail resolved during implementation.** Rule 1 flags *every* workflow that runs turbo, and the three deploy workflows do not opt in until slice 6 — so a naive rule 1 would leave this slice's boundary red. Resolved with an explicit `PENDING_CACHE_OPT_IN` set in the guard listing those three files, which **slice 6 empties**. A dated, listed exemption beats a rule that quietly checks only a subset, because the list is visible in the diff and its removal is a deliverable.

**Done when:** all ten guard cases pass; the three suites report cache hits on a second push of an unchanged tree; removing `TURBO_TOKEN` leaves every suite passing (fail-open on availability).

**Risk:** the silent-no-op failure mode. `required: false` on the declared secrets is deliberate (a `push` run has no caller) and is exactly why this cannot be verified by reading the diff — a live `workflow_dispatch` of `deploy-dev` is required, and it is an acceptance criterion.

---

## Slice 5 — `test:integration` becomes cacheable

The biggest remaining win (~6 min, the most expensive job) and the highest risk of a false green. Isolated so it can be reviewed and reverted on its own.

**Files**

- Edit: `turbo.json` — `test:integration.cache: false` → `true`. Nothing else; `globalDependencies` already landed in slice 2 and the default inputs already cover `apps/api/drizzle/`.

**Steps**

1. **Test — the deliberate red-then-green** (spec acceptance; the walk itself is recorded in the smoke doc). Break an `apps/api` integration test, push, confirm **Integration Tests** fails. Fix it, push, confirm it passes. Push again unchanged, confirm a cache hit.
2. **Implement** the one-line flip.
3. Confirm the docs-only skip still reports **Integration Tests** as successful without running the suite — the skip and the cache are independent mechanisms and both must survive.
4. Lint + type-check.

**Done when:** an unchanged push hits cache; a genuine failure still fails; a docs-only push still reports success.

**Risk:** highest in the ticket. If the input declaration cannot be made airtight, the fallback is restoring `cache: false` with an in-file reason — a one-line revert, explicitly sanctioned by the spec.

---

## Slice 6 — Deploy opt-in, devcontainer `turbo`, docs

The remaining surfaces, none of which gate the measured win.

**Files**

- Edit: `.github/workflows/deploy-dev.yml:267-279`, `deploy-prod.yml:278-291` — the three cache vars alongside the existing ten `VITE_*`, plus the comment recording that `apps/web#build` misses on every new commit by design (the SHA is in the hash via inference).
- Edit: `.github/workflows/deploy-static-site.yml:154-163` — the three cache vars, plus the comment explaining that the site build itself stays uncached and this exists so its *dependency* builds can hit.
- Edit: `Dockerfile:76-77` — extend the symlink chain with `turbo`; extend the comment with why a global install is wrong (a CLI version differing from the lockfile computes different hashes).
- Edit: `docs/LOCAL_DEVELOPMENT.md` — developer posture: not linked by default, read-only if opting in, and why.
- Edit: `CLAUDE.md` → "CI gating", and its `.github/copilot-instructions.md` mirror.

**Steps**

1. **Tests.** Empty the guard's `PENDING_CACHE_OPT_IN` set **first** — that turns rule 1 red for the three deploy workflows — then add their env blocks to green it. No new rule, but a real red-then-green: after this slice rule 1 covers every turbo invocation in the repo with no exemptions.
2. **Implement** the workflow env blocks, the `Dockerfile` symlink, and the doc updates.
3. **Verify the devcontainer by hand** (recorded in the smoke doc — it cannot be checked in CI): rebuild the container, then `which turbo` resolves through `/workspace/node_modules/.bin` and `turbo --version` matches the lockfile.
4. Lint + type-check.

**Done when:** deploy workflows show hits for dependency builds; a rebuilt devcontainer has `turbo` on PATH at the lockfile version; every doc surface in spec §Files touched is updated.

**Risk:** the `Dockerfile` edit invalidates every cached task via slice 2's `globalDependencies`… only if it also touches `docker-compose.yml`, which it does not. The symlink is dangling at image-build time by design — the existing comment at `Dockerfile:70-77` already documents that, and `portalops`/`portalai` prove the pattern works.

---

## Sequence summary

| Slice | What lands | Gating check |
|---|---|---|
| 1 | Guard harness + rules 3–4, wired into CI | `npm run lint:ci-cache` green, incl. real tree |
| 2 | `remoteCache.signature`, `globalDependencies`, `apps/site` uncached | Guard rule 5; site build reports `cache: false` |
| 3 | Deterministic `version.json` | 6 jest cases; same commit → same version |
| 4 | Credentials + explicit `workflow_call` secrets | Guard rules 1–2; **suites hit cache**; live dispatch |
| 5 | `test:integration` cacheable | Deliberate red-then-green; docs-only skip intact |
| 6 | Deploy opt-in, devcontainer `turbo`, docs | Guard stays green; manual devcontainer check |

## Cross-slice notes

- **The guard grows across slices 1, 2 and 4.** This is the mechanism that makes config changes genuinely test-first. Rules only ever land in the slice whose implementation greens them — never earlier.
- **Nothing caches remotely until slice 4.** Slices 1–3 are safe by construction: without credentials in CI there is no shared cache to restore a wrong artifact from. This is why the hash-correctness fix (slice 2) is cheap to land and verify.
- **Two verifications are inherently manual** and belong to `docs/TURBOREPO_CI_CACHING.smoke.md`, not to any slice's test step: the live `workflow_dispatch` secret check (slice 4) and the devcontainer rebuild (slice 6). Neither can be exercised by CI on a branch.
- **Doc sync is slice 6, not a follow-up** (per `CLAUDE.md` → "Keeping Documentation in Sync with Capabilities"): `CLAUDE.md`'s CI-gating section, its `.github/copilot-instructions.md` mirror, and `docs/LOCAL_DEVELOPMENT.md`. Stale docs are a bug in this PR.
- **Expect one full cache invalidation** during slice 6 if `docker-compose.yml` is touched for any reason, per slice 2's `globalDependencies`. Performance event, not correctness.
- **`apps/web#build` never hits across commits on the deploy path.** Documented in-file in slice 6 so the next reader does not diagnose a working cache as broken.

## Next step

Implementation begins on this branch once discovery, spec and plan are reviewed and confirmed — slice 1 first, tests before implementation, one commit per slice.
