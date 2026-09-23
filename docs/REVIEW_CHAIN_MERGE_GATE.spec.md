# Review-chain merge gate — Spec

Pins the contract for formalizing a four-phase review chain (`code-review → security → smoke → adversarial`) as the merge gate. **Discovery:** `docs/REVIEW_CHAIN_MERGE_GATE.discovery.md` · **Issue:** [EnterpriseBT/portal-ai#634](https://github.com/EnterpriseBT/portal-ai/issues/634).

This ticket ships **no runtime code** — it adds one skill, generalizes one skill, rewrites the workflow docs + their mirror, and adds a self-testing anti-drift guard. There is no Zod schema, DB migration, endpoint, or React surface.

## Key decisions (ratified from discovery)

- **D-gate — five equal conditions.** The gate is CI green + human-confirmed `code-review` + `security` + `smoke` + `adversarial`. All four human rows are checkboxes on the PR; review/security are confirmed on the PR (no phase doc), smoke/adversarial via their `.md` checklists. (Resolved Q: hard confirm-gates.)
- **D-walk — one walk engine.** `/smoke-walk` generalizes to walk any tagged checklist (`.smoke.md` **or** `.adversarial.md`); no second walk skill. (Resolved Q: generalize.)
- **D-review — built-ins, native output.** `code-review` and `security-review` are the Claude Code built-ins, invoked directly; no project wrapper skill, no phase doc. (Discovery D1-B.)
- **D-adversarial — one scaffolder.** A new `/adversarial-review` skill scaffolds `docs/<SLUG>.adversarial.md`, mirroring `/smoke`. (Discovery D2-A.)
- **D-coverage — conditional matrix.** Security is required whenever a change touches auth, data access, multi-tenancy, secrets, or external egress; proportionate per-kind rows otherwise. (Resolved Q: conditional trigger.)
- **D-contract-stability — no hardcoded count.** The chain is an ordered list in the artifact table + a guard-readable source of truth, never a hardcoded "five artifacts". (Discovery Enterprise → Contract stability.)

## Scope

### In scope

1. New skill `.claude/skills/adversarial-review/` (`SKILL.md` + `EXAMPLE.adversarial.md`).
2. Generalize `.claude/skills/smoke-walk/SKILL.md` to walk `.adversarial.md` as well as `.smoke.md`.
3. Rewrite `CLAUDE.md` "Issue → PR Workflow": artifact table, phase-skill chain, "The smoke gate" → "The merge gate", a coverage-matrix subsection, the PR `## Test plan` gate checklist, and de-hardcode "five artifacts".
4. Mirror every gate/workflow change into `.github/copilot-instructions.md:97` (+ `:113` docs-sync surface list).
5. New anti-drift guard `scripts/check-review-chain.mjs` + `lint:review-chain` npm script, wired into `unit-test.yml` beside `lint:ci-cache`; self-tests against embedded fixtures.

### Out of scope

- CI-automated review/adversarial *runs* (no PR-triggered browser workflow) — local/agent harness only, like `/smoke-walk`.
- Rebuilding `/code-review` / `/security-review` — built-ins used as-is.
- Standing fuzzing / property-based-test infrastructure.
- Backend/CLI adversarial probe *execution inside `/smoke-walk`* — it stays browser-only (see D-walk boundary in Surface §C); non-UI probes are walked by the agent inline or by the human and recorded in the adversarial doc's Findings.
- Retrofitting the chain onto already-merged tickets.

## Surface

### A. New skill — `.claude/skills/adversarial-review/`

**`SKILL.md`** (frontmatter `name: adversarial-review` + one-line `description`). Structurally mirrors `smoke/SKILL.md`; required sections:

- **Purpose** — phase between `/smoke` and merge; scaffolds `docs/<SLUG>.adversarial.md` that deliberately probes edge cases, misuse, and non-best-practice actions. It is *not* acceptance verification (that's smoke) — it tries to *break* the change.
- **Arguments** — `/adversarial-review [issue-number]`; derive the issue from the spec on the branch if omitted; resolve exactly one or ask.
- **Prerequisites** — implementation present (`git log main..HEAD`), a spec (or condensed doc) present. Same "no implementation → stop" rule as `/smoke`.
- **Probe taxonomy** — the scaffolder selects the `§` categories that apply to the change's surfaces (a pure-backend change drops UI-only categories), from:
  1. Boundary & limit inputs (empty, max, off-by-one, oversized payloads)
  2. Malformed & injection input (wrong types, encoding, prompt/SQL injection)
  3. Concurrency & races (double-submit, parallel mutation, stale read/write)
  4. Auth & permission boundaries (role escalation, disabled-affordance bypass)
  5. Multi-tenant isolation (cross-org read/write leakage)
  6. State & lifecycle abuse (deleted/locked entity, out-of-order actions, stale session)
  7. Misuse sequences (non-best-practice but reachable user paths)
- **Tagging** — each probe tagged agent-walkable (default, browser), `— manual` (human-only), or `— backend` (non-browser API/CLI probe). This is the tag `/smoke-walk` reads.
- **Hard rules** — every box scaffolds unchecked; **the agent never checks a box or merges**; probes are concrete (exact hostile action + exact expected *safe* behavior — "handles it" is not an expected result); a found vulnerability goes through the bug-filing template, not an ad-hoc fix.
- **What this skill is not** — not `/smoke` (acceptance) and not the executor (`/smoke-walk` walks it).

**`EXAMPLE.adversarial.md`** — the exemplar, **seeded from the real #629 walk** (`packages/e2e/test-results/smoke-walk-adversarial-629.md`: prompt-injection escalation, cross-org isolation, batch smuggling, stale-session durability, set-semantics). Lives beside the skill (phase docs are swept).

**`docs/<SLUG>.adversarial.md` skeleton the skill emits:**

```markdown
# <slug> — Adversarial Review

Adversarial probes for [#<N>](…) — <what shipped>. **Branch:** `<branch>` (PR [#<P>](…)).

## Preflight            <!-- only when UI probes are present; same shape as smoke -->
### Environment / Fixtures / Reset

## §1 — Boundary & limit inputs
- [ ] <exact hostile action> — <expected SAFE behavior: rejected / clamped / clean error, no leak>
## §2 — Malformed & injection input
## §<n> — <selected categories…>          <!-- each probe tagged, — manual / — backend as needed -->

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| … | … | low/med/high | fixed-in-PR / waived: <reason> |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers:
```

### B. Generalized `/smoke-walk` — `.claude/skills/smoke-walk/SKILL.md`

Minimal, back-compatible edits (it already produced the #629 adversarial report):

- **Arguments** — `<issue-number | path-to-checklist-doc>`. A number resolves `docs/<SLUG>.smoke.md` (unchanged default). **A path walks whatever tagged checklist it points at — `.smoke.md` or `.adversarial.md`.**
- **Report path** — derive from the doc: `smoke-walk-<SLUG>.md` for `.smoke.md`, **`adversarial-walk-<SLUG>.md` for `.adversarial.md`**, both under `packages/e2e/test-results/` (git-ignored). Never edits the source `.md`.
- **Tag handling** — `— manual` → `could-not-automate: manual` (unchanged). **New:** `— backend` → `could-not-automate: backend probe` (smoke-walk stays browser-only — the **D-walk boundary**; it does not shell out).
- **Self-description** — generalize the `name`/`description`/lead from "smoke checklist" to "a tagged verification checklist (smoke or adversarial)". The evidence vocabulary (`verified` / `mismatch` / `could-not-automate`), the tie-break rule, and the never-check-a-box / never-merge hard rules are **unchanged**.

### C. `CLAUDE.md` rewrite

**Artifact table (`:556-562`)** — becomes the phase set (renumbered); each row states what lands:

| # | Phase | What lands |
|---|---|---|
| 1 | Ticket | GitHub issue (unchanged) |
| 2 | Discovery | `docs/<SLUG>.discovery.md` (unchanged) |
| 3 | Spec + plan | `.spec.md` + `.plan.md` (unchanged) |
| 4 | Implementation | Code + tests (unchanged) |
| 5 | Code review | `/code-review` — native output; confirmed on the PR (per coverage matrix) |
| 6 | Security review | `/security-review` — native output; confirmed on the PR (per coverage matrix) |
| 7 | Smoke | `docs/<SLUG>.smoke.md`; walked via `/smoke-walk` |
| 8 | Adversarial | `docs/<SLUG>.adversarial.md`; walked via `/smoke-walk` |

**Phase-skill chain line (`:564`)** — `/ticket → /discovery → /spec → /plan` → implementation → `/code-review → /security-review → /smoke → /adversarial-review` (built-ins `/code-review` and `/security-review`; `/smoke-walk` runs both smoke and adversarial), `/epic` coordinating parents.

**De-hardcode the count** — `:554` "The five artifacts —" → "The artifacts —"; `:570` "produces all five artifacts" → "produces the full artifact set"; `:586` "**`full`** (all five artifacts)" → "**`full`** (the full artifact set)". (D-contract-stability.)

**"The smoke gate" (`:662-664`) → "The merge gate"** — rewrite to the five conditions:
> A PR merges only when **all** hold: CI green, and the human has confirmed each required review-chain phase — **code-review**, **security**, **smoke**, and **adversarial**. `/code-review` and `/security-review` run over the branch diff and surface findings via their native output; `/smoke` and `/adversarial-review` scaffold `.md` checklists that `/smoke-walk` walks in a real browser for a per-step evidence report. Findings in any phase are **fixed in-PR or waived-with-reason** on the PR; an unresolved, unwaived finding blocks merge. The agent produces evidence and never checks a box or merges — a false `verified` or pre-checked box forges the gate. Which phases are required is set by the **coverage matrix** below.

**New subsection "### Coverage by ticket kind"** — the matrix:

| Ticket kind | code-review | security | smoke | adversarial |
|---|---|---|---|---|
| Feature (full) | required | required | required | required |
| Bug (full) | required | required¹ | required | required |
| Condensed (feat/bug) | required | required¹ / else waivable | required (embedded `## Smoke`) | waivable-w-reason |
| Chore / docs / test | required | waivable-w-reason | waivable-w-reason | waivable-w-reason |
| Trivial (no docs at all) | — | — | — | — |

> ¹ **security is required whenever the change touches auth, data access, multi-tenancy, secrets, or external egress** — waivable-with-reason otherwise. Epic **children run the full chain independently** on their own branch before merging to `epic/<slug>` (`epic/SKILL.md:10`), never deferred to close-out. A waiver is a recorded reason in the PR gate checklist, never a silent skip.

**PR `## Test plan` (`:659`)** — the body's `## Test plan` carries the gate checklist:
```
## Merge gate
- [ ] CI green
- [ ] code-review confirmed (or waived: <reason>)
- [ ] security confirmed (or waived: <reason>)
- [ ] smoke confirmed
- [ ] adversarial confirmed (or waived: <reason>)
```

### D. `.github/copilot-instructions.md` mirror

- **`:97`** — replace "Five artifacts … smoke checklist … merge requires green CI and that human confirmation" with the chain + the five-condition gate + the new skills (`/code-review`, `/security-review`, `/adversarial-review`, `/smoke-walk` walking both). Compress the coverage matrix to one clause (security required on auth/data/tenancy/secrets/egress).
- **`:113`** — add the new skill surfaces to the developer-doc sync list.

### E. Anti-drift guard — `scripts/check-review-chain.mjs` + `lint:review-chain`

Mirrors `scripts/check-ci-cache.mjs` (self-tests its rules against embedded fixtures, then checks the real tree). **Rules:**

1. Each of the four gate phases (`code-review`, `security`, `smoke`, `adversarial`) is named in `CLAUDE.md`'s "The merge gate" section **and** the copilot-instructions `:97` paragraph.
2. The five conditions in the "The merge gate" gate wording match the PR `## Test plan` checklist template rows (order + set).
3. `.claude/skills/adversarial-review/SKILL.md` exists and declares its `name`; `.claude/skills/smoke-walk/SKILL.md` references both `.smoke.md` and `.adversarial.md`.
4. The coverage matrix contains a row for each documented ticket kind (feature/bug/condensed/chore/trivial).

Add root `package.json` script `"lint:review-chain": "node scripts/check-review-chain.mjs"` and a step in `.github/workflows/unit-test.yml` beside `lint:ci-cache`.

## Migration / Seed

**None.** No DB schema change — say so explicitly.

## TDD test plan

This is a docs/skills change; "tests" are guard self-tests + existing doc guards + the walk-through. Run via npm scripts (never raw node/jest ad hoc):

### Guard self-tests — `scripts/check-review-chain.mjs` (via `npm run lint:review-chain`)

1. **Rule 1 passes** on a fixture whose CLAUDE.md + copilot text names all four phases; **fails** when one phase is dropped from either surface.
2. **Rule 2 passes** when gate wording and PR checklist agree; **fails** on a condition present in one but not the other.
3. **Rule 3 passes** with both skill files present + cross-referencing; **fails** when `smoke-walk` names only `.smoke.md`.
4. **Rule 4 passes** with all ticket-kind rows; **fails** when a kind row is missing.
5. Self-tests run **before** the real-tree check and abort the script on any self-test failure (the `check-ci-cache.mjs` pattern).
6. **Against the real tree** (post-implementation): all four rules pass.

### Existing guards

7. `npm run lint:doc-pointers` stays green — the new skills cite CLAUDE.md sections, no durable-doc pointer breaks.
8. `npm run lint` (root, zero-warning) + `npm run type-check` clean — no code touched, but the guard script must lint clean.

### Walk-through (evidence, not jest)

9. On this branch, `/adversarial-review 634` scaffolds a real `docs/REVIEW_CHAIN_MERGE_GATE.adversarial.md` selecting the process-appropriate `§` categories — the meta-proof the skill works. `/smoke-walk <path-to-.adversarial.md>` resolves it and writes `adversarial-walk-REVIEW_CHAIN_MERGE_GATE.md` (this ticket has thin UI surface, so most probes classify `— manual`/`— backend` — that itself validates the tag handling).

**Totals ≈ 6 guard self-test cases + 2 existing-guard checks + 1 walk-through ≈ 9 verifications.**

## Acceptance criteria

- [ ] `npm run lint:review-chain` passes against the real tree and its embedded self-tests; it is wired into `unit-test.yml`.
- [ ] `CLAUDE.md`'s "The merge gate" names five conditions; the artifact table has the 8 phase rows; no "five artifacts" literal remains.
- [ ] The coverage matrix is present with the security-trigger rule and a row per ticket kind.
- [ ] The PR `## Test plan` gate checklist is documented and this PR's own body uses it.
- [ ] `.github/copilot-instructions.md:97` mirrors the chain + five-condition gate; `lint:review-chain` rule 1 confirms parity.
- [ ] `/adversarial-review` scaffolds `docs/<SLUG>.adversarial.md` with tagged, category-selected probes; the agent never checks a box.
- [ ] `/smoke-walk` walks a `.adversarial.md` by path and writes `adversarial-walk-<SLUG>.md`; `— backend`/`— manual` probes classify `could-not-automate`; its never-check-a-box rule is unchanged.
- [ ] `npm run lint`, `type-check`, `lint:doc-pointers` all green.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Gate wording in CLAUDE.md and copilot mirror silently drift. | `lint:review-chain` rule 1/2 fails CI on divergence — the whole reason for the guard (fail-closed on doc integrity, like `lint:ci-cache`). |
| Generalizing `/smoke-walk` breaks its smoke behavior. | Number-arg default (`.smoke.md`) and evidence vocabulary are unchanged; rule 3 asserts it still references `.smoke.md`; the #629 report proves the adversarial path already works. |
| The heavier gate (4 confirm steps) slows small tickets. | The coverage matrix waives phases proportionately for chore/docs/test and condensed; trivial tickets skip the chain entirely. |
| A false `verified`/pre-checked box forges the now-larger gate. | Fail-closed by design: the never-check-a-box + evidence rules extend unchanged to all four phases; the agent self-certifies none. |

**Rollback:** `git revert` the doc/skill commits — no runtime code, no data, no migration to unwind.

## Files touched

- **New:** `.claude/skills/adversarial-review/SKILL.md`, `.claude/skills/adversarial-review/EXAMPLE.adversarial.md`, `scripts/check-review-chain.mjs`.
- **Edit:** `.claude/skills/smoke-walk/SKILL.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `package.json` (`lint:review-chain`), `.github/workflows/unit-test.yml`.
- No `apps/*`, `packages/*` source, no dependency, no env var, no infra.

## Next step

`docs/REVIEW_CHAIN_MERGE_GATE.plan.md` — ~4 TDD slices, each a testable commit on this branch: (1) `scripts/check-review-chain.mjs` + `lint:review-chain` with self-tests (test-first: the guard exists before the docs it checks, so slices 2–3 turn it green); (2) `CLAUDE.md` + copilot mirror rewrite (turns guard rules 1/2/4 green); (3) `/adversarial-review` skill + `EXAMPLE.adversarial.md` (turns rule 3 green); (4) generalize `/smoke-walk` + wire `lint:review-chain` into `unit-test.yml`. Slice 1 lands the guard red-then-green as the contract; the walk-through (test 9) is the smoke/adversarial phase of this very ticket.
