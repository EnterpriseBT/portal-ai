# Stripe CLI operations guide — Plan

**Sequences the #225 contract into three doc/config slices: the charter row repoint, the `docs/STRIPE_CLI_OPS.md` runbook, and the read-only `stripe` allowlist.**

Spec: `docs/STRIPE_CLI_OPS_GUIDE.spec.md`. Discovery: `docs/STRIPE_CLI_OPS_GUIDE.discovery.md`. Issue: #225 (epic #222). Coordinates with #218 (`tier apply` lookup-key resolution); relocates the local webhook harness to #244.

Three slices, each leaving the tree valid and each landing as a **commit on `feat/stripe-cli-ops-guide` / PR #245** (base `epic/cli-first-ops`) — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

**Note on "TDD" for this ticket.** Docs + JSON-config change — no code to unit-test, and no pinning test covers `docs/*.md` or `settings.local.json` (spec's TDD test plan ≈ 0 automated cases). Each slice's "test" step is its concrete **verification gate**: `jq` validity + entry count for the config, `grep` for the repoint, doc-consistency for the guide, and the manual `/smoke 225` (merge gate) at the end. Inventing jest coverage here would be wrong (`feedback_smoke_test_is_manual_doc`, `feedback_use_npm_test_scripts`).

Sequencing rationale — smallest-and-independent first; the guide defines the canonical inspection commands, then the allowlist codifies the read subset (no forward dep):

- **Slice 1** — the charter row repoint (2 Guide-ref cells), independently valid; unblocks nothing but keeps the index honest as `listen`/`trigger` leave #225.
- **Slice 2** — `docs/STRIPE_CLI_OPS.md`, the full runbook. Depends only on the pinned surface.
- **Slice 3** — the read-only `stripe` allowlist + validity + acceptance reconcile. Last, because it allowlists the exact read verbs the guide (slice 2) canonicalizes.

---

## Slice 1 — Charter row repoint (`listen`/`trigger` → #244)

Move the two local-webhook rows' Guide-ref off #225 now that those ops belong to the local-dev runbook (#244).

**Files**

- Edit: `docs/CLI_OPERATIONS_CHARTER.md` (lines 105–106) — Guide-ref cell `[#225](…/225)` → `[#244](…/244)` on the `stripe listen` and `stripe trigger` rows. Command/Envs/Disposition unchanged.

**Steps**

1. **Verification.** `grep -nE 'stripe listen|stripe trigger' docs/CLI_OPERATIONS_CHARTER.md` shows both rows linking `#244`; `grep -c '#225' docs/CLI_OPERATIONS_CHARTER.md` on those two rows returns 0 (no `listen`/`trigger` row still points at #225).
2. Done — 2-cell edit.

**Done when:** both webhook rows link #244; the charter's other Stripe rows still link #225.

**Risk:** none — 2-cell link change; no command/behavior change.

---

## Slice 2 — `docs/STRIPE_CLI_OPS.md` runbook

The guide itself — one new file, in the section order spec Surface §A pins.

**Files**

- New: `docs/STRIPE_CLI_OPS.md` — purpose/boundary → auth (read-only restricted key, test-mode default, per-env separate accounts) → invariants (JSON, env-local price ids, lookup-key handle, `metadata.organizationId` scoping) → inspection ops (events/subscriptions/customers/prices/products) → events↔`stripe_events` correlation → price/lookup-key config (prompt-gated) → #218 tier price-identity procedure → gotchas → prod.

**Steps**

1. **Verification (doc-consistency).** Author, then confirm: every charter Stripe **non-webhook** row (7) appears as a documented command; the auth section names the read-only scope list + per-env separate accounts; the `POST /api/webhooks/stripe` endpoint and the `stripe_events.outcome` enum references match `webhook.router.ts` / `stripe-events.table.ts`; the #218 flow links the charter's "Add/Update a tier" recipe; mutating verbs sit only under the prompt-gated config section.
2. **Author** the sections. No code.
3. `npm run format` (markdown excluded from the hook; keep prose clean); confirm links resolve.

**Done when:** the guide covers the 7 non-webhook charter ops + the lookup-key procedure; a reader can authenticate (test-mode read-only key) and run an inspection read from the doc alone.

**Risk:** referencing the app's write key vs the CLI read key — mitigated by stating the distinction explicitly in the auth section.

---

## Slice 3 — read-only `stripe` allowlist + acceptance reconcile

Codify the safe read subset; config/mutation verbs stay gated.

**Files**

- Edit: `.claude/settings.local.json` — append the 9 read-only `stripe` matchers from spec Surface §B to `permissions.allow`.

**Steps**

1. **Tests / verification gate.**
   - `jq empty .claude/settings.local.json` parses clean.
   - `jq -r '.permissions.allow[] | select(startswith("Bash(stripe"))' .claude/settings.local.json | wc -l` returns `9`.
   - Excluded verbs absent: `prices create`, `subscriptions update`, `trigger`, `listen`, `login`.
2. **Implement** — append the 9 entries.
3. **Acceptance reconcile** — walk the spec's Acceptance criteria; every box maps to a landed artifact (guide, allowlist, charter repoint) or the smoke.

**Done when:** `jq` validates; 9 read verbs present, the 5 excluded verbs absent; acceptance criteria all mapped.

**Risk:** allowlist too broad — mitigated by read-only-only + fail-closed (unlisted verbs prompt); a read-only key cannot mutate regardless.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | charter `listen`/`trigger` Guide-ref → #244 | `grep` shows both rows link #244 |
| 2 | `docs/STRIPE_CLI_OPS.md` runbook | doc-consistency vs charter + `webhook.router`/`stripe-events` |
| 3 | 9 read-only `stripe` allow-entries | `jq empty` valid; 9 present / 5 excluded absent |
| gate | — | `/smoke 225` against app-dev test mode (merge gate) |

## Cross-slice notes

- **Depends on #244 existing** (filed) for the repoint target; #244's doc need not be *written* before this PR — the charter linking an open ticket matches how it links #224–#227 pre-build.
- **No migration / seed / code** — pure docs + config; no `db:generate`, no jest, no CI test additions.
- **Allowlist timing** — permission entries take effect at session start; a fresh session is needed for the no-prompt behavior (the smoke notes this).
- **Doc-sync:** the guide is a new surface; the charter's Stripe Guide-ref (non-webhook rows) stays pointing at #225 (uniform with the other surfaces linking issues) — flip to the doc when all guides land, same call as #224.

## Next step

Implementation begins on this branch — slice 1 (charter repoint) → slice 2 (runbook) → slice 3 (allowlist) — only after you've confirmed discovery + spec + plan. The `/smoke 225` checklist follows as the merge gate.
