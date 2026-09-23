# Review-chain merge gate — Plan

**TDD-sequenced implementation of the four-phase review chain: the anti-drift guard as the executable contract, the CLAUDE.md/copilot rewrite, the `/adversarial-review` skill, and the `/smoke-walk` generalization.**

Spec: `docs/REVIEW_CHAIN_MERGE_GATE.spec.md`. Discovery: `docs/REVIEW_CHAIN_MERGE_GATE.discovery.md`. Issue: #634. This ships **no runtime code** — one Node guard script, two skill files, and doc rewrites.

4 slices, each landing as a **commit on `feat/634-review-chain-merge-gate`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run the guard via its npm script (never invoke node/jest directly — `feedback_use_npm_test_scripts`):

```bash
npm run lint:review-chain        # self-tests (embedded fixtures) + real-tree rules
npm run lint && npm run type-check
npm run lint:doc-pointers
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

**Sequencing rationale — the guard is the contract, written first, greened by the doc/skill slices, wired into CI last:**

- **Slice 1** — the guard + its self-tests. Self-tests pass; the **real-tree rules are deliberately red** (the failing acceptance test the next slices green). The guard is **not** wired into CI yet, so **CI stays green at every boundary** — only the not-yet-gating `npm run lint:review-chain` is red by design. *(Judgment call — see hand-off; this is how "test-first" and "no red CI across a boundary" both hold for a real-tree guard.)*
- **Slice 2** — rewrite `CLAUDE.md` + the copilot mirror → guard rules 1, 2, 4 go green.
- **Slice 3** — the `/adversarial-review` skill **and** the `/smoke-walk` generalization together → guard rule 3 (which checks *both* skill files) goes green; the real tree is now fully green.
- **Slice 4** — wire `lint:review-chain` into `unit-test.yml` (safe now it's green) + adopt the PR gate checklist; final acceptance.

No migration, no seed, no dependency (spec: *Migration / Seed — None*).

---

## Slice 1 — Anti-drift guard `scripts/check-review-chain.mjs` (self-tests green, real-tree red by design)

The executable contract. Mirrors `scripts/check-ci-cache.mjs`: self-tests each rule against embedded fixtures, aborts on any self-test failure, then checks the real tree.

**Files**

- New: `scripts/check-review-chain.mjs` — the four rules (spec §E) + embedded pass/fail fixtures + a `--self-test`-then-real-tree run.
- Edit: `package.json` — `"lint:review-chain": "node scripts/check-review-chain.mjs"`.

**Steps**

1. **Self-tests (spec cases 1–5).** Author the embedded fixtures first: rule 1 passes when all four phases appear in both CLAUDE.md-shaped + copilot-shaped fixtures, fails when one is dropped; rule 2 passes when gate wording ↔ PR checklist agree, fails on a mismatch; rule 3 passes with both skill files present + cross-referencing, fails when `smoke-walk` names only `.smoke.md`; rule 4 passes with all ticket-kind rows, fails when one is missing; self-tests run **before** the real-tree check and abort on failure. Run `npm run lint:review-chain`; the **self-tests pass**.
2. **Implement** the four rules + the fixture-driven self-test harness. The **real-tree check fails** (rules 1–4 unmet — CLAUDE.md/skills not yet changed): expected, and the script exits non-zero.
3. Confirm the script lints clean: `npm run lint && npm run type-check`. **Do not** add it to `unit-test.yml` yet.

**Done when:** the guard's self-tests pass; `npm run lint:review-chain` exits non-zero on the real tree (the failing contract); the script is lint-clean and **absent from CI**. `npm run lint`, `type-check`, `lint:doc-pointers`, and the CI suites are green.

**Risk:** the real-tree red leaks into CI. Mitigated by *not* wiring it into `unit-test.yml` until slice 4 — CI never runs it while it's red.

---

## Slice 2 — `CLAUDE.md` + copilot mirror rewrite (greens guard rules 1, 2, 4)

The gate contract in prose. Turns the artifact table, gate section, coverage matrix, and PR checklist into the chain.

**Files**

- Edit: `CLAUDE.md` — artifact table → 8 phase rows (spec §C); phase-skill chain line; "The smoke gate" → "The merge gate" (5 conditions); new "### Coverage by ticket kind" matrix; PR `## Test plan` gate checklist; de-hardcode "five artifacts" at `:554`/`:570`/`:586`.
- Edit: `.github/copilot-instructions.md` — `:97` chain + five-condition gate + new skills + one-clause coverage rule; `:113` docs-sync surface list gains the new skills.

**Steps**

1. **Test = the guard.** Apply the spec §C/§D edits. Run `npm run lint:review-chain`: **rules 1, 2, 4 now pass** (all four phases named in both surfaces; gate wording ↔ PR checklist agree; every ticket-kind row present). **Rule 3 still fails** (skills not yet changed) — the script still exits non-zero, expected.
2. Verify `npm run lint:doc-pointers` stays green (new section cross-refs are valid).
3. `npm run lint && npm run type-check`.

**Done when:** guard rules 1/2/4 pass in isolation (rule 3 the only remaining red); CLAUDE.md carries the 8-row table, five-condition gate, coverage matrix, PR checklist, and no "five artifacts" literal; copilot mirror parity. CI green (guard still unwired).

**Risk:** gate wording ↔ PR-checklist wording drift within this very edit — rule 2 catches it immediately on the local run.

---

## Slice 3 — `/adversarial-review` skill + `/smoke-walk` generalization (greens guard rule 3 → real tree fully green)

Both skill changes land together because rule 3 asserts *both* files.

**Files**

- New: `.claude/skills/adversarial-review/SKILL.md` — sections per spec §A (purpose, args, prerequisites, probe taxonomy, tagging, hard rules, what-this-is-not).
- New: `.claude/skills/adversarial-review/EXAMPLE.adversarial.md` — seeded from `packages/e2e/test-results/smoke-walk-adversarial-629.md`.
- Edit: `.claude/skills/smoke-walk/SKILL.md` — args accept a path to `.smoke.md` **or** `.adversarial.md`; report naming `adversarial-walk-<SLUG>.md`; `— backend` → `could-not-automate: backend probe`; self-description generalized (spec §B). Evidence vocabulary + never-check-a-box rules unchanged.

**Steps**

1. **Test = the guard.** Author the skill files + the smoke-walk edits. Run `npm run lint:review-chain`: **rule 3 now passes** (adversarial-review `SKILL.md` declares its name; `smoke-walk` references both `.smoke.md` and `.adversarial.md`) → **all four rules green against the real tree**, script exits 0.
2. **Walk-through (spec case 9).** `/adversarial-review 634` scaffolds a real `docs/REVIEW_CHAIN_MERGE_GATE.adversarial.md` selecting process-appropriate `§` categories; `/smoke-walk <path-to-.adversarial.md>` resolves it and writes `adversarial-walk-REVIEW_CHAIN_MERGE_GATE.md` — thin UI surface means most probes classify `— manual`/`— backend`, which itself exercises the new tag handling. (Evidence, not jest; this *is* the ticket's own adversarial phase.)
3. `npm run lint && npm run type-check`; `lint:doc-pointers`.

**Done when:** `npm run lint:review-chain` exits 0 on the real tree; the walk-through scaffolds + walks an adversarial doc end-to-end without the agent checking a box.

**Risk:** generalizing `/smoke-walk` regresses smoke behavior. Mitigated: number-arg default stays `.smoke.md`; rule 3 asserts it still references `.smoke.md`; the #629 report proves the adversarial path already works.

---

## Slice 4 — Wire `lint:review-chain` into CI + adopt the PR gate checklist

The guard is green, so it can gate now.

**Files**

- Edit: `.github/workflows/unit-test.yml` — a `npm run lint:review-chain` step beside `lint:ci-cache`.
- Edit: the PR body (this ticket's own) — adopt the `## Merge gate` checklist from spec §C.

**Steps**

1. Add the CI step. Confirm the guard runs green in CI (it's green against the real tree after slice 3).
2. Confirm the whole suite: `npm run lint && npm run type-check && npm run lint:review-chain && npm run lint:doc-pointers`.
3. Update this PR's `## Test plan` to the merge-gate checklist (dogfood).

**Done when:** `lint:review-chain` gates CI and passes; this PR's body carries the gate checklist; all guards + suites green.

**Risk:** none — wiring a green check.

---

## Sequence summary

| Slice | Lands | Greens | Test |
|---|---|---|---|
| 1 | `check-review-chain.mjs` + `lint:review-chain` | self-tests (cases 1–5); real-tree red by design | `npm run lint:review-chain` (self-tests) |
| 2 | `CLAUDE.md` + copilot rewrite | guard rules 1, 2, 4 | `npm run lint:review-chain` |
| 3 | `/adversarial-review` + `/smoke-walk` generalization | guard rule 3 → real tree fully green | guard + walk-through (case 9) |
| 4 | wire `lint:review-chain` into `unit-test.yml` + PR checklist | CI gate | full suite green |

Total ≈ **6 guard self-test cases + 2 existing-guard checks + 1 walk-through** (spec cases 1–9). No migration. Commits on `feat/634-review-chain-merge-gate`.

## Cross-slice notes

- **The guard is a failing-test-first, wired-last artifact.** It is red on the real tree through slices 1–2 by design, but **never in CI** until slice 4 — so every slice boundary is CI-green. This is the one place the plan's "no red across a boundary" rule is read as *"no red CI across a boundary"*: an un-wired guard failing on `npm run lint:review-chain` is exactly the failing acceptance test TDD wants. Flagged in the hand-off.
- **Rule 3 forces the two skill changes into one slice.** The guard asserts both `adversarial-review/SKILL.md` and the `smoke-walk` cross-reference; splitting them would leave rule 3 red across a boundary. They co-land in slice 3.
- **Doc-sync is the whole ticket.** Every slice touches a documented convention; there is no separate doc-sync slice because the docs *are* the deliverable. CLAUDE.md ↔ copilot parity is mechanically enforced by guard rule 1 (spec Risks).
- **The walk-through is this ticket's own adversarial phase.** Scaffolding `docs/REVIEW_CHAIN_MERGE_GATE.adversarial.md` in slice 3 dogfoods the new skill — the ticket that adds the adversarial gate is itself walked through it.
- **CLAUDE.md compliance:** the guard follows the `scripts/check-*.mjs` + `lint:*` precedent (`lint:ci-cache`, `lint:doc-pointers`, `lint:migrations`); skills follow the `SKILL.md` + `EXAMPLE.*` layout; no SDK/env/infra change.

## Next step

Implement slice 1 on this branch — author `scripts/check-review-chain.mjs`'s embedded fixtures + self-tests first (they pass), then the four real-tree rules (red until slices 2–3), keeping it out of `unit-test.yml`. Begin only after discovery + spec + plan are reviewed and confirmed.
