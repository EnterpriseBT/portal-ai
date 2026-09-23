---
name: adversarial-review
description: Phase 8 of the Issue → PR workflow — scaffold the adversarial probe checklist for a feature branch. Where /smoke verifies the acceptance criteria WORK, /adversarial-review tries to BREAK the change — boundary/malformed input, races, auth-boundary bypass, cross-tenant leakage, lifecycle abuse, and misuse sequences. Selects probe categories from the change's real surfaces, tags each agent-walkable / manual / backend, and writes docs/<SLUG>.adversarial.md. Automatable probes are then walked by /smoke-walk in a real browser for evidence; the human confirms. Invoke as /adversarial-review [issue-number] after /smoke.
---

# /adversarial-review — scaffold the adversarial probe checklist

You are scaffolding **phase 8** of the workflow in `CLAUDE.md` → "Issue → PR Workflow" — a gate before merge, alongside smoke. Where `/smoke` asks "do the acceptance criteria hold?", this asks the opposite: **"how does this break?"** It probes edge cases, boundary and malformed input, concurrency, auth and tenant boundaries, lifecycle abuse, and non-best-practice user actions — the ways an enterprise, multi-tenant, billing-facing product actually gets broken. Like `/smoke`, automatable probes are walked by the agent in a real browser via **`/smoke-walk`** (which walks a `docs/<SLUG>.adversarial.md` exactly as it walks a `.smoke.md`), producing a per-probe **evidence report** the human reviews. **You never check a box and never merge.** The PR merges only after CI is green and the human has confirmed each required review-chain phase (`CLAUDE.md` → "The merge gate").

## Arguments

Invoked as `/adversarial-review [issue-number]`. The number is optional — derive it from the spec (or condensed doc) on the current branch. If you can't resolve exactly one, ask once and stop.

## Steps

### 1. Check prerequisites on the current branch

```bash
git branch --show-current            # must be the feature branch, NOT main
ls docs/*.spec.md docs/*.condensed.md   # find the spec or condensed doc
git log --oneline main..HEAD         # implementation commits must exist
```

- **Implementation must be present.** Adversarial probes exercise built behavior; scaffolding them against docs-only commits produces fiction. If the branch has only docs commits, stop and tell the user to finish the plan's slices first.
- **A spec (or condensed doc) must be present** — the probes are derived from the change's real surfaces. No spec → stop with the right next command.
- **Coverage check.** Consult the coverage matrix (`CLAUDE.md` → "Coverage by ticket kind"). If the adversarial phase is *waivable* for this ticket kind and the change is genuinely low-risk, say so and offer to record the waiver on the PR's `## Merge gate` checklist instead of scaffolding — don't manufacture probes for a typo fix.
- **Condensed branch?** Append or refresh an `## Adversarial` section in `docs/<SLUG>.condensed.md` using the rules below, rather than a separate file.

### 2. Select the probe categories that apply

Read the change's surfaces from the spec + branch diff (`git diff main...HEAD --stat`), and select only the categories the change actually exposes. A pure-backend change drops the UI-only categories; a read-only view drops the mutation ones. **Never scaffold all seven by rote** — an empty category is noise. Mark the ones you skip `N/A — <reason>`.

1. **Boundary & limit inputs** — empty, max, off-by-one, oversized payloads, pagination edges.
2. **Malformed & injection input** — wrong types, bad encoding, prompt/SQL injection, hostile/oversized strings.
3. **Concurrency & races** — double-submit, parallel mutation of one entity, stale read-then-write, a job racing a user action.
4. **Auth & permission boundaries** — role escalation, a disabled affordance driven anyway, an action a lower role should not reach.
5. **Multi-tenant isolation** — a cross-org id in a request, cross-tenant read/write leakage.
6. **State & lifecycle abuse** — a deleted/locked/tombstoned entity, out-of-order actions, a stale privileged session outliving a revoked entitlement.
7. **Misuse sequences** — reachable but non-best-practice paths a real user could take that the happy path never anticipates.

### 3. Read one reference adversarial doc

Default to `.claude/skills/adversarial-review/EXAMPLE.adversarial.md` — preflight + selected `§` categories + Findings + sign-off + bug template. The exemplar is seeded from a real walk (#629); phase docs in `docs/` are ephemeral (swept by the next feature), so it lives beside the skill.

### 4. Write `docs/<SLUG>.adversarial.md`

```markdown
# <slug> — Adversarial Review

Adversarial probes for [#<N>](…) — <one line: what shipped>. **Branch under test:** `<branch>` (PR [#<P>](…)).

## Preflight            <!-- only when UI probes are present; same shape as smoke -->
### Environment
### Fixtures
### Reset between runs

## §1 — <selected category>
- [ ] <exact hostile action — the prompt / request / sequence, verbatim> — <expected SAFE behavior: rejected / clamped / clean error, nothing leaked or mutated>
## §<n> — <…more selected categories; mark skipped ones N/A — <reason>…>

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/job/entity ids):
```

**Hard rules:**

- **Probes name the hostile action AND the expected SAFE behavior.** "handles it" is not an expected result — say what safe looks like (the request is rejected, the value clamped, the batch atomically denied with nothing written, no cross-tenant row returned). In the walk, `verified` means *that safe behavior was observed*; a `mismatch` is a vulnerability.
- **Tag each probe** — agent-walkable (default; a browser can drive it), `— manual` (needs a human: a real third-party account, a timing the browser can't force), or `— backend` (an API/CLI/DB probe outside a browser walk). `/smoke-walk` reads these tags to know what to attempt versus report `could-not-automate`.
- **Every box scaffolds unchecked, and you never check one** — not you, not `/smoke-walk`. The agent produces evidence; **checking boxes is the human's act of confirmation**, and a pre-checked box — or a `verified` the agent didn't truly observe — forges the gate.
- **Probes are concrete and reachable** — a real prompt/request/sequence a real actor could send, not a hypothetical. Prefer probes this change's surfaces make plausible over a generic checklist.
- **A vulnerability found is a bug, filed** — use the bug-filing template; do not quietly fix it inside this scaffolding step.
- **No commit, no push** — the user reviews the checklist, walks it (agent-assisted via `/smoke-walk`), and confirms.

### 5. Hand off to the user

Stop. Report: the doc and its `§`-category count, which surfaces drove the selection, any category you marked `N/A`, and the gate statement — the PR merges after CI is green **and** the human has confirmed each required phase. Point them at `/smoke-walk docs/<SLUG>.adversarial.md` to walk the automatable probes.

## What this skill is not

- It is not `/smoke` — smoke verifies the acceptance criteria *work*; this probes how they *break*. Both are required phases for a full ticket (per the coverage matrix); neither replaces the other.
- It is not the executor — **`/smoke-walk`** drives the automatable probes in a browser and writes the evidence report. Run it after this scaffolds the doc.
- It does not *fix* what it finds, merge the PR, or confirm anything on the user's behalf.
