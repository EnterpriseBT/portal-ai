# Review-chain merge gate — Discovery

**Issue:** [EnterpriseBT/portal-ai#634](https://github.com/EnterpriseBT/portal-ai/issues/634)

**Why this exists.** The merge gate today is two conditions: **CI green + a human-confirmed smoke checklist** (`CLAUDE.md:664`). Smoke verifies the acceptance criteria *work as specified*; nothing else in the cycle is a required gate. Correctness review (`/code-review`), security review (`/security-review`), and adversarial edge-case probing all happen ad hoc or not at all — even though #629 already ran an adversarial browser walk by hand (`packages/e2e/test-results/smoke-walk-adversarial-629.md`) and found it valuable enough to want it every time.

This ticket formalizes a **review chain** — `implementation → review → security → smoke-walk → adversarial → merge on green` — as documented, proportionate phases of the Issue → PR workflow. This is the change that makes correctness, security, functional, and adversarial verification *required* (not optional) before a full-sized change can merge, while keeping every phase on the proven **agent-produces-evidence / human-confirms** model.

## The current shape

### The phase-skill pattern (what every new phase mirrors)

Every workflow phase is a skill directory of `SKILL.md` + an `EXAMPLE.*` exemplar (except `epic/` and `smoke-walk/`, which are `SKILL.md`-only). Each declares its phase, points back to `CLAUDE.md → "Issue → PR Workflow"`, and carries a **"Hard rules"** and a **"What this skill is not"** section. Branch naming `<type>/<issue-number>-<slug>` is owned by `discovery/SKILL.md:37-47` and reused everywhere (`spec/SKILL.md:30`, `plan/SKILL.md:29` both say "never create a new branch"). Hand-offs chain forward — `ticket → discovery → spec → plan → implementation → smoke` — each ending in a "do not commit/push/PR; the user confirms" discipline.

### The smoke → smoke-walk split (the exact template the adversarial phase copies)

| Skill | Role | Key citations |
|---|---|---|
| `/smoke` | Scaffolds `docs/<SLUG>.smoke.md` from the spec's acceptance criteria (every criterion → ≥1 step), tags each step agent-walkable or `— manual`, states the gate. | `smoke/SKILL.md:8`, `:39-81`; hard rules `:83-89` |
| `/smoke-walk` | Drives the Playwright MCP browser, produces a per-step **evidence report** to `packages/e2e/test-results/smoke-walk-<SLUG>.md` (never the `.smoke.md`), classifying each step. | `smoke-walk/SKILL.md:10`, `:45-58`, `:83-93` |

The evidence vocabulary is exact and load-bearing (`smoke-walk/SKILL.md:83-89`): **verified** ("you drove the step and read a real observed value that matches… 'looks right' is not an observation"), **mismatch** ("the observed value contradicts the expected result"), **could-not-automate: `<reason>`**. Tie-break: "When in doubt between `verified` and `could-not-automate`, choose `could-not-automate` — a false `verified` is the one outcome that corrupts the gate." The never-forge rule appears verbatim at `:10` and `:93` ("never check a box, never edit the `.smoke.md`, never merge. The human confirms.").

### The merge gate + workflow docs (what #634 rewrites)

`CLAUDE.md`: the **"Issue → PR Workflow"** header `:548`, the **artifact table** `:556-562` (5 rows: Ticket / Discovery / Spec+plan / Implementation / Smoke), the phase-skill chain line `:564`, sizing `:570-574`, **"Epic branches"** `:637-645`, **"The smoke gate"** `:662-664` (the current 2-condition gate), **"Agent-guided browser sessions"** `:666-668`, and **"Keeping Documentation in Sync with Capabilities"** `:698-726` — whose `:725` names the required mirror pair. The mirror, `.github/copilot-instructions.md`, compresses the same facts into one dense paragraph at **`:95-97`** (no separate smoke/epic headers) — so the gate rewrite is a localized edit to `:97` plus the docs-sync `:111-113` and enterprise-lens `:99-101`.

### The e2e / Playwright harness (reused wholesale by the adversarial phase)

`packages/e2e/README.md` documents the #304 harness. Auth fixtures: `packages/e2e/.auth/{storageState,owner,admin,member}.storageState.json` (setup `src/setup/auth.setup.ts`; `e2e:use <role>` swaps role mid-session, README `:55-60`). Seeded `e2e-fixture` org via `e2e:seed → db:seed:org --all-toolpacks` enables **every** built-in pack (README `:52-53`) — exactly what adversarial probes need. Repo-root `.mcp.json` registers the single Playwright MCP server (chromium, `--headless --isolated`, `--storage-state packages/e2e/.auth/storageState.json`), exposing `mcp__playwright__*`. **The precedent already exists on disk**: `packages/e2e/test-results/smoke-walk-adversarial-629.md` — an adversarial evidence report (prompt-injection escalation, cross-org isolation, batch smuggling, stale-session durability) in the same disclaimer/`§`/classification format as a smoke walk.

### The built-in review skills

`/code-review` and `/security-review` are **Claude Code built-ins** — confirmed absent under `.claude/skills/` (only discovery/epic/plan/smoke/smoke-walk/spec/ticket + stripe live there). They have no project source to cite. `/code-review` produces inline findings / `--comment` PR comments / `--fix`; `/security-review` reviews the branch diff for vulnerabilities. #634 decided to **rely on their native output**, not wrap them.

## The design space

### Decision 1 — How to formalize `review` and `security`

| | A. Thin wrapper skills | B. Document direct invocation | C. One orchestrator skill |
|---|---|---|---|
| New `.claude/skills/` dirs | 2 | 0 | 1 |
| Captures native output faithfully | risks re-wrapping | yes (untouched) | risks re-wrapping |
| Fits "native output, no phase doc" (#634) | awkwardly | cleanly | awkwardly |

**Lean: B.** #634 decided these two rely on the built-ins' native output with confirmation recorded on the PR — a wrapper would only add a surface to drift. The workflow docs name `/code-review` and `/security-review` as the required `review`/`security` phases and point at the built-ins directly. (If hand-off ergonomics later demand a one-line launcher, that's an additive follow-up, not this ticket.)

### Decision 2 — The `adversarial` phase's skill shape

| | A. New scaffolder + generalize `/smoke-walk` | B. Two new skills (`/adversarial-review` + `/adversarial-walk`) | C. One combined skill |
|---|---|---|---|
| New skill surface | 1 (+ generalize 1) | 2 | 1 |
| Reuses proven evidence engine | yes | duplicates it | duplicates it |
| Non-UI (backend/CLI) probes | walked inline, evidence same format | dedicated home | dedicated home |

**Lean: A.** Add one new `/adversarial-review` skill that scaffolds `docs/<SLUG>.adversarial.md` (same tag-and-checklist shape as `/smoke`, different probe taxonomy — boundary inputs, races, auth-boundary bypass, cross-org isolation, misuse sequences). Generalize `/smoke-walk`'s input from `.smoke.md` to *any* tagged checklist so it walks the adversarial doc too, writing `packages/e2e/test-results/adversarial-walk-<SLUG>.md` — the 629 report proves the engine already does this. Non-UI probes are walked by the agent inline and recorded in the same evidence vocabulary. Least new surface, one evidence engine, one never-forge rule.

### Decision 3 — Where each confirmation is recorded (the 5-condition gate)

The gate goes from 2 conditions to 5: **CI + review + security + smoke + adversarial**. smoke/adversarial confirmations live in their `.md` checkboxes; review/security have no phase doc (Decision 1).

**Lean:** extend the PR `## Test plan` convention (`CLAUDE.md:657-659`) with an explicit **merge-gate checklist** — `- [ ] code-review / - [ ] security / - [ ] smoke / - [ ] adversarial / - [ ] CI green` — all **human-checked**. GitHub required-status-checks are rejected for the human-confirmed rows (they're CI-only; the gate stays human, matching smoke today). The PR body becomes the durable record of *why it merged*.

### Decision 4 — Coverage matrix by ticket kind & sizing

#629 decided chores/bugs get proportionate, per-phase-waivable passes, *codified in docs, not improvised per PR*. Proposed matrix:

| Ticket kind | review | security | smoke | adversarial |
|---|---|---|---|---|
| Feature (full) | required | required | required | required |
| Bug (full) | required | required¹ | required | required |
| Condensed (feat/bug) | required | required¹ / else waivable | required (embedded) | waivable-w-reason |
| Chore / docs / test | required | waivable-w-reason | waivable-w-reason | waivable-w-reason |
| Trivial (no docs at all) | — | — | — | — |

¹ **security is required whenever the change touches auth, data access, multi-tenancy, secrets, or external egress** — waivable-with-reason otherwise. **Lean: adopt this matrix**; a waiver is a recorded reason in the PR gate checklist, never a silent skip.

### Decision 5 — Ordering & parallelism

**Lean:** keep the documented order `review → security → smoke → adversarial`. review/security are static (need code, run before the runtime phases); smoke proves it works, then adversarial tries to break it. review and security *may* run concurrently (both static passes over one diff) but are documented in order for a clean findings sequence.

## Tradeoff comparison

| | D1: document built-ins (B) | D2: scaffolder + generalize walk (A) | D3: PR gate checklist | D4: coverage matrix |
|---|---|---|---|---|
| New skill dirs | 0 | 1 | 0 | 0 |
| Spreads to spec | Yes (workflow wording) | Yes (SKILL.md contract) | Yes (PR template) | Yes (matrix table) |
| Touches CLAUDE.md + mirror | Yes | Yes | Yes | Yes |

## Recommendation

1. **Do not add wrapper skills for `review`/`security`** — document `/code-review` and `/security-review` as the required phases, native output, confirmation on the PR (D1-B).
2. **Add one `/adversarial-review` scaffolder skill** producing `docs/<SLUG>.adversarial.md` with agent-walkable/`— manual` tagged probes across the adversarial taxonomy; seed its `EXAMPLE.adversarial.md` from the 629 report (D2-A).
3. **Generalize `/smoke-walk`** to walk any tagged checklist (smoke *or* adversarial), preserving its evidence vocabulary and never-forge rule; adversarial evidence lands at `packages/e2e/test-results/adversarial-walk-<SLUG>.md`, with non-UI probes walked inline (D2-A).
4. **Rewrite the workflow docs**: `CLAUDE.md` artifact table → 6 rows (add `review`, `security`, `adversarial`; smoke stays), "The smoke gate" → "The merge gate" (5 conditions), the phase-skill chain line; mirror every edit into `.github/copilot-instructions.md:97` (+ `:99-113`).
5. **Extend the PR `## Test plan`** with the explicit 5-condition gate checklist (D3).
6. **Codify the coverage matrix** by ticket kind/sizing with the security-trigger rule (D4).
7. **Epic children run the full chain** on their own branch before merging to `epic/<slug>` — already the epic model (`epic/SKILL.md:10`); the edit is to make "the normal cycle" *be* the chain, not to add epic-specific gating.

## Open questions

1. **Generalize `/smoke-walk` vs. keep it smoke-only + add `/adversarial-walk`?** Generalizing risks blurring the skill's identity; a sibling duplicates the engine. **Lean: generalize, and rename its self-description to "walk a tagged verification checklist"** while keeping `/smoke-walk` as the invocation name (the 629 report already came out of it).
2. **Are `review`/`security` hard confirm-gates or run-and-surface?** #634's body currently treats all four as confirmed gates. **Lean: hard confirm-gates** — all five conditions are equal; the substance is "findings addressed," the PR checkbox is the confirmation. (User flagged this as the one to revisit — carry it to spec.)
3. **Does the adversarial phase get its own `EXAMPLE.adversarial.md`?** **Lean: yes** — reuse `smoke-walk-adversarial-629.md` as the seed so the exemplar is grounded in a real walk.
4. **Should the phase list live in one machine-readable place** (a constant some lint reads) or only in prose? **Lean: prose + the artifact table for now**; add a constant only if a guard test needs to assert the chain (contract-stability, below).

## Enterprise-scale considerations

This is a process/tooling change (skills + docs), so the runtime dimensions are mostly N/A — but the gate *is a control*, and controls have failure modes worth weighing.

- **Concurrency & correctness** — N/A because the gate is per-PR and human-driven; no shared runtime state.
- **Accuracy & auditability** — **RELEVANT.** The gate's confirmations *are* the audit record of why a change merged. **Lean:** PR gate checkboxes + git-ignored evidence reports form the trail; every waiver carries a recorded reason. This is the durable record-of-truth for the merge decision.
- **Failure modes** — **RELEVANT, fail-closed by design.** A false `verified` / pre-checked box forges the gate (smoke-walk's rule); the chain adds three more forge surfaces, mitigated by the *same* human-confirms + evidence rule extended to every phase. **Lean:** the agent never self-certifies any of the five conditions.
- **Scale & unbounded growth** — **RELEVANT (developer-time cost).** Five confirm steps per full PR is real overhead. **Lean:** the coverage matrix (D4) is the backpressure valve — cost scales to risk, chores stay cheap.
- **Multi-tenancy** — N/A because this is dev process, not a tenant-facing runtime path.
- **Contract stability** — **RELEVANT.** A future 6th phase (perf, a11y) should plug in without re-plumbing. **Lean:** represent the chain as an *ordered list* in the artifact table (and a constant only if a guard needs it), never as hardcoded 2-vs-5 branching.
- **Data lifecycle** — `.adversarial.md` is an ephemeral phase doc (swept like the others, `CLAUDE.md:574`); evidence reports are git-ignored `test-results`. **Lean:** consistent with existing lifecycle; nothing new to retain.

## What this doesn't decide

- **CI-automated review/adversarial runs** — out of scope (#634); this is the local/agent harness, like `/smoke-walk`. A CI tier is a possible follow-up.
- **Rebuilding `/code-review` / `/security-review`** — they're wired in as built-ins, not reimplemented.
- **Standing fuzzing / property-based-test infrastructure** — deferred; the phase probes a change, it doesn't stand up frameworks.
- **Retrofitting** the chain onto already-merged tickets.
- **The exact prose of every CLAUDE.md / copilot edit** — that's spec + implementation, not discovery.

## Next step

Write `docs/REVIEW_CHAIN_MERGE_GATE.spec.md` (the contract: the exact 6-row artifact table, the 5-condition "merge gate" wording, the coverage matrix with the security-trigger rule, the `/adversarial-review` SKILL.md contract, and the generalized `/smoke-walk` input contract) and `.plan.md`. The plan slices naturally: (1) `/adversarial-review` scaffolder + `EXAMPLE.adversarial.md`; (2) generalize `/smoke-walk` to any tagged checklist; (3) `CLAUDE.md` + `.github/copilot-instructions.md` merge-gate/artifact-table rewrite; (4) PR `## Test plan` gate checklist + coverage matrix. "Tests" here are the doc-sync guards (`lint:doc-pointers`, the mirror check) and a walk-through of the new skills against this very branch — noted because these slices are skills/docs, not runtime code.
