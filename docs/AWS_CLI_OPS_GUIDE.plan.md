# AWS CLI operations guide — Plan

**Sequences the #224 contract into three doc/config slices: the charter stack-name fix, the `docs/AWS_CLI_OPS.md` runbook, and the read-only `aws` allowlist.**

Spec: `docs/AWS_CLI_OPS_GUIDE.spec.md`. Discovery: `docs/AWS_CLI_OPS_GUIDE.discovery.md`. Issue: #224 (epic #222). Grounded in the #223 charter's AWS table + live-verified app-dev identifiers.

Three slices, each leaving the tree valid and each landing as a **commit on `feat/aws-cli-ops-guide` / PR #243** (base `epic/cli-first-ops`) — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

**Note on "TDD" for this ticket.** This is a docs + JSON-config change — there is no code to unit-test and no pinning test covers `docs/*.md` or `settings.local.json` (spec's TDD test plan ≈ 0 automated cases). So each slice's "test" step is its concrete **verification gate**: `jq` validity for the config, doc-consistency for the guide, and the manual `/smoke 224` (the merge gate) at the end. Where a jest test would normally go, the honest gate is named instead — inventing jest coverage here would be wrong (`feedback_smoke_test_is_manual_doc`, `feedback_use_npm_test_scripts`).

Sequencing rationale — smallest-and-independent first; the guide defines the canonical commands, then the allowlist codifies the safe subset of them (no forward dep):

- **Slice 1** — the charter correctness fix (2 lines), independently valid. **Already landed** (`dbed687c`) since you asked to fix it during the spec review.
- **Slice 2** — `docs/AWS_CLI_OPS.md`, the full runbook. Depends on nothing but the pinned identifiers.
- **Slice 3** — the `.claude/settings.local.json` allowlist + validity check + acceptance reconcile. Comes last because it allowlists the exact read verbs the guide (slice 2) canonicalizes.

---

## Slice 1 — Charter CloudFormation stack-name fix ✅ landed

Correct the charter's two `cloudformation` rows so the guide it points at is internally consistent.

**Files**

- Edit: `docs/CLI_OPERATIONS_CHARTER.md` (lines 63–64) — `portalai-backend-dev` → `portalai-dev-backend`.

**Steps**

1. **Verification.** `grep -n 'portalai-backend-dev' docs/CLI_OPERATIONS_CHARTER.md` returns nothing; the two rows read `portalai-dev-backend`. (Live: `aws cloudformation describe-stacks --stack-name portalai-dev-backend` resolves — confirmed in discovery.)
2. Done.

**Done when:** no `portalai-backend-dev` remains in the charter. ✅ **Committed as `dbed687c`.**

**Risk:** none — 2-line literal correction, verified against live stacks.

---

## Slice 2 — `docs/AWS_CLI_OPS.md` runbook

The guide itself — one new file, authored in the section order the spec's Surface §A pins.

**Files**

- New: `docs/AWS_CLI_OPS.md` — purpose/boundary → auth (ambient + agent `aws login --remote` bridge) → invariants (JSON, naming formula, envName map) → identifier reference table → logging ops → maintenance/diagnostic ops → operator actions (prompt-gated) → CloudTrail pointer → gotchas → prod notes.

**Steps**

1. **Verification (doc-consistency).** Author the file, then confirm: every identifier in the reference table matches the charter's AWS rows and the `infra/cloudformation/*.yml` logical names; every read command shows a JSON form (`--output json` / `--query`); every mutating op sits under "Operator actions" flagged not-agent-auto; the auth section carries both paths + the `ExpiredToken` re-login note. Cross-check the operation list against the charter's 14 AWS rows — each is documented or explicitly deferred.
2. **Author** the sections. No code.
3. `npm run format` (markdown is excluded from the hook, but keep prose clean); confirm links resolve.

**Done when:** the guide covers every charter AWS operation (documented or deferred), both auth paths, and the verified identifier table; a reader can authenticate to app-dev and run a logging + a maintenance read from the doc alone.

**Risk:** identifier drift over time — mitigated by pairing each literal with the naming formula and citing `infra/cloudformation/*.yml`.

---

## Slice 3 — `.claude/settings.local.json` allowlist + acceptance reconcile

Codify the safe read-only subset so an agent runs the guide's reads without prompts; mutations stay gated.

**Files**

- Edit: `.claude/settings.local.json` — append the 12 read-only `aws` matchers from spec Surface §B to `permissions.allow`.

**Steps**

1. **Tests / verification gate.**
   - `jq empty .claude/settings.local.json` parses clean (a malformed permissions file breaks Claude Code).
   - `jq -r '.permissions.allow[]' .claude/settings.local.json | grep -c '^Bash(aws '` returns `12`.
   - Confirm the excluded verbs (`update-service`, `run-task`, `execute-command`, `cloudformation deploy`, `configure export-credentials`) are **absent**.
2. **Implement** — append the 12 entries.
3. **Acceptance reconcile** — walk the spec's Acceptance criteria; every box maps to a landed artifact (guide, allowlist, charter fix) or the smoke.

**Done when:** `jq` validates; the 12 read verbs are present and the 5 excluded verbs absent; acceptance criteria are all mapped.

**Risk:** allowlist too broad — mitigated by read-only-only + fail-closed (unlisted verbs prompt). Effect takes hold next session (permissions load at session start) — note in the smoke.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 ✅ | charter stack-name fix (`dbed687c`) | `grep` finds no `portalai-backend-dev` |
| 2 | `docs/AWS_CLI_OPS.md` runbook | doc-consistency vs charter + infra; both auth paths |
| 3 | 12 read-only `aws` allow-entries | `jq empty` valid; 12 present / 5 excluded absent |
| gate | — | `/smoke 224` against app-dev (merge gate) |

## Cross-slice notes

- **Doc-sync (decide):** the charter's AWS Guide-ref currently links to the **issue** #224 (uniform with the other surfaces). Once `docs/AWS_CLI_OPS.md` exists, it *could* point at the doc — but the other surfaces still link to issues, so **leave it as the issue link for uniformity until #225/#226/#227 also have docs**; flip them together. (The AWS preamble's "pinned in #224" phrasing is fine as-is.)
- **No migration / seed / code** — pure docs + config; no `db:generate`, no jest, no CI test additions.
- **Allowlist timing** — permission entries take effect at session start, so a fresh session is needed for the no-prompt behavior; the smoke notes this.

## Next step

Implementation begins on this branch — slice 2 next (slice 1 already landed), then slice 3 — only after you've confirmed discovery + spec + plan. The `/smoke 224` checklist follows as the merge gate.
