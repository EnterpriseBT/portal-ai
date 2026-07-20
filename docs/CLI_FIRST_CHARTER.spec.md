# CLI-first operations charter — Spec

**Issue:** [EnterpriseBT/portal-ai#223](https://github.com/EnterpriseBT/portal-ai/issues/223) · **Epic:** #222 · **Discovery:** `docs/CLI_FIRST_CHARTER.discovery.md`

This spec pins the **contract of the charter document** the ticket produces — a new `docs/CLI_OPERATIONS_CHARTER.md`. The deliverable is a doc, not code, so the "Surface" below is the charter's required structure, its operations-table column schema (columns + allowed values), and the exact definitions the table is populated and audited against (CLI-operable predicate, coverage-bar formula, binary rating, overlap compose-test, gap routing, inline-guard convention, common-workflows recipe format). The per-surface runbook depth lives in #224–#227; this charter is the thin index they bind to.

## Key decisions (flag for review)

Lifted from the discovery Recommendation + resolved Open questions — confirm these are captured correctly before the plan:

1. **Thin index, not a runbook.** The charter carries the operations *index* + coverage + cross-surface workflows; exact commands/flags/examples live in the four guides. The `guide ref` column is the pointer.
2. **Binary `operable` / `not operable`** rating (no graded tier); operable = the 3-part CLI-operable predicate holds.
3. **Coverage bar** = 100% of ops classified (every row has a disposition) **and** ≥90% of maintenance+configuration ops operable across `local` **and** `app-dev` (functional parity); logging reported separately.
4. **Firm no-vendor-wrapping** overlap policy; native-over-vendor allowed only when it *composes* into a Portal-domain op (`vars`, `db`, `tier apply` are the recorded precedent).
5. **No native code gap** surfaced → #227 is docs + `.claude` wiring; audit-log reader **declined** (CloudTrail covers AWS audit); `stripe-secret-key` deploy-wiring is the one recorded finding.
6. **No actor tagging; unattended assumed** (auth configured per-env, human drives the session); guard flags (`--yes`, `--confirm-prod`) baked inline into each row's command.
7. **AWS + Auth0 are the priority surfaces** (where console time concentrates); Stripe lighter; native complete.
8. **Verification is a manual audit** (the smoke checklist) + the coverage computation embedded in the charter — there is no jest suite for a markdown deliverable (see TDD test plan).

## Scope

### In scope

1. **`docs/CLI_OPERATIONS_CHARTER.md`** — the new charter doc, structured per the Surface below.
2. The **operations index table** populated across all four surfaces (AWS, Stripe, Auth0, native), prioritizing AWS + Auth0.
3. The **coverage number**, computed and reported against the bar.
4. The **overlap decisions**, **gap list with dispositions**, and the **cross-surface common-workflows** section.
5. A back-pointer to the charter from the epic index (#222 body already links its children; the charter path is added to #223's issue index on commit, per the workflow).

### Out of scope

- **The per-surface runbooks** (#224 AWS, #225 Stripe, #226 Auth0, #227 native) — the charter's `guide ref` column points at them; they are written on their own branches.
- **Any command implementation** — no code gap surfaced; the charter writes no code.
- **The `stripe-secret-key` deploy wiring** (`backend.yml` `ValueFrom`) — recorded as a finding, routed to deploy-infra/#225; not fixed here.
- **`.claude` wiring / COMMANDS/README refresh** — #227.
- **An automated drift-guard test** (parse the charter, assert every CLI command is a row) — declined; staleness is covered by the manual audit + CLAUDE.md doc-sync convention. No jest surface for this markdown deliverable.
- **Live `prod` execution** — #83; prod guard behavior is documented, never exercised.

## Surface

The charter is `docs/CLI_OPERATIONS_CHARTER.md`. Its required structure:

### Section structure (top to bottom)

1. **Title + purpose** — one paragraph: this is the standing op→CLI index for `local`/`app-dev`/(future)`prod`, usable by a human or agent; the four guides carry depth.
2. **How to read this** — the column legend + the definitions block (predicate, rating, coverage, guard convention) so the doc is self-contained.
3. **Per-surface operations tables** — one `##` per surface in priority order: **AWS**, **Auth0**, **Stripe**, **Native (`portalops`/`portalai`)**. Each opens with a ≤3-line preamble (auth story for that surface, where its guide lives) then the operations table.
4. **Cross-surface common-workflows** — recipes that span CLIs (the one piece of substance the charter owns).
5. **Overlap decisions** — the compose-test + the three recorded precedent cases; the standing rule for future overlap.
6. **Gap list & findings** — every non-operable op + the recorded findings, each with a disposition.
7. **Coverage** — the computed numbers against the bar.

### Operations table — column schema

Every operations table (one per surface) has exactly these columns:

| Column | Allowed values | Notes |
|---|---|---|
| `Operation` | free text, **imperative task phrasing** | "Tail app-dev API logs for an error", not "log access". The agent's entry point. |
| `Category` | `maintenance` \| `logging` \| `configuration` | drives the coverage denominator (logging reported separately). |
| `Envs` | subset of `local` · `app-dev` · `prod` | which environments the op applies to. |
| `Owning CLI` | `aws` \| `stripe` \| `auth0` \| `portalops` \| `portalai` | exactly one. |
| `Command` | a canonical one-line invocation **incl. guard flags**, or `—` | e.g. `aws logs tail /ecs/portalai-api-dev --follow --format short`; native staging example `portalops vars set STRIPE_SECRET_KEY --env app-dev --yes`. Full runbook is in the guide; this is the copy-paste starting point. |
| `Operable?` | `yes` \| `no` | `yes` iff the CLI-operable predicate holds **in every env in `Envs`** (parity). |
| `Guide ref` | link to the `#224`–`#227` guide section, or `—` | where the exact command/flags/examples live. |
| `Disposition` | `covered` \| `gap → #<n>` \| `exception: <reason>` \| `deploy-infra: <reason>` | never blank — that is the "100% classified" bar. |

### The CLI-operable predicate

An operation is **operable** iff **all three** hold:

1. **A documented command exists** — native (`portalops`/`portalai`) **or** vendor-CLI (`aws`/`stripe`/`auth0`).
2. **Non-interactive or flag-guarded** — runnable without an interactive-only prompt; confirmations are explicit flags (`--yes`, `--confirm-prod`). A REPL/hold-open with a documented one-shot form (`portalops db psql -- <sql>`) counts as operable via that form.
3. **Machine-readable output** — the command emits JSON (`--json` / `--output json`) or the guide documents how to parse its output.

`Operable? = yes` requires the predicate to hold **in every environment listed in `Envs`** — an op operable in `local` but not `app-dev` is a **parity defect**, rated `no`, disposition naming the missing env.

### Coverage-bar formula

- **Denominator** `D` = count of `maintenance` + `configuration` ops (logging excluded).
- **Numerator** `N` = those rated `Operable? = yes`.
- **Bar passes** iff `N / D ≥ 0.90` **and** every op in the whole table (all categories) has a non-blank `Disposition`.
- **Reported in the Coverage section**: `N/D` as a fraction and percent; the logging sub-figure separately; and any parity defects called out. No rounding up to clear the bar — report the real number; if `< 0.90`, list what's missing and why it's acceptable or route it to a gap.

### Binary rating & inline-guard convention

The rating is the single `Operable?` bit above. Per-env guard expectations are **not** a separate column — they live inside the `Command` column as the flags the task actually needs (`--yes` for `app-dev`/staging mutations; `--yes --confirm-prod` for the future prod non-destructive case; destructive-prod ops are shown as blocked, not as a command). No actor/role tagging.

### Overlap decisions (compose-test)

State the rule verbatim: *native-over-vendor glue is allowed only when the native command composes vendor primitives into a Portal-domain operation; a thin passthrough of a vendor CLI is rejected.* Record the three shipped precedent cases (`vars` → env-config catalog; `db` → tunneled session; `tier apply` → tier-catalog convergence) and the standing rule that any new overlap must clear the same test in this doc or become a vendor-CLI runbook entry.

### Gap list & findings

Every `Operable? = no` row and every recorded finding appears here with its disposition. The two findings this charter must carry:

- **`stripe-secret-key` deploy wiring** — set-half operable (`portalops vars set …`), inject-half missing (`backend.yml` `ValueFrom`). Disposition `deploy-infra` + documented in #225.
- **Audit-log reader declined** — `~/.portalai/audit.log` stays write-only; AWS-side audit via CloudTrail. Recorded as a conscious exception, not a gap.

### Cross-surface common-workflows — recipe format

Each recipe: a task title, then a numbered list of steps, each step naming its **owning CLI** + the canonical command, with the surface guide carrying the detail. The charter ships at least the canonical one:

> **Add a subscription tier** — (1) *Stripe:* create the price + lookup key (no amounts in code; lookup keys only). (2) *core:* add the `TIER_CATALOG` entry referencing that lookup key. (3) *portalops:* `portalops tier apply --env <env>` to converge the DB.

## Migration / Seed

**None.** No schema change, no migration, no seed — the deliverable is a markdown document.

## TDD test plan

This is a **documentation deliverable with no runtime surface**, so there is no jest suite — asserting the prose of a markdown file with unit tests would be theatre. Verification is instead:

1. **Structural self-audit** — the charter satisfies every item in Acceptance criteria below (each op has all eight columns; every `Disposition` non-blank; coverage computed and reported; the three overlap precedents and two findings present; the "add a tier" recipe present).
2. **Coverage computation** — `N/D` is computed from the finished table and reported; the bar (`≥0.90` + zero-unclassified) is met or the shortfall is explained.
3. **Manual smoke** (the merge gate, `/smoke` → embedded checklist): against the user's own stack, pick representative rows — an AWS log-tail, an Auth0 directory read, a native `vars`/`org` op — and confirm the charter's canonical `Command` actually runs and returns machine-readable output in `local`/`app-dev`. This is where "the charter is *correct*, not just complete" is established.

**Totals ≈ 0 automated cases; ~6–8 manual smoke checks** (a representative operable row per surface + one findings/gap row + the common-workflow recipe end-to-end).

An automated drift-guard test (parsing the charter to assert every CLI command appears as a row) is **explicitly out of scope** — see Scope. Staleness is handled by the manual audit + CLAUDE.md's doc-sync convention.

## Acceptance criteria

- `docs/CLI_OPERATIONS_CHARTER.md` exists with the seven-section structure and the self-contained "How to read this" definitions block.
- Every inventoried operation appears as a row with all eight columns populated; **no `Disposition` is blank** (100% classified).
- Coverage is computed and reported: `N/D` for maintenance+config, the logging sub-figure, and any parity defects — meeting `≥90%` or explaining the shortfall.
- AWS and Auth0 surfaces are covered at least as thoroughly as native (priority surfaces); each surface names where its guide (#224–#227) lives via the `guide ref` column.
- The overlap compose-test rule + three precedent cases are stated; any operable native-over-vendor op is justified against the test.
- The gap list carries every `Operable? = no` row plus the two recorded findings (`stripe-secret-key` wiring; audit-log reader declined), each with a disposition.
- The "add a subscription tier" cross-surface recipe is present in the recipe format.
- A reader/agent can take any inventoried task, read its row, and either run the canonical `Command` or follow `guide ref` to the full runbook — or see it flagged as a gap/exception.

## Risks & rollback

- **Primary risk: staleness.** The charter is a point-in-time map; new CLI commands or vendor changes drift it. *Detection:* CLAUDE.md's "Keeping Documentation in Sync" standing check + the manual smoke on any epic-touching change; optionally the flagged drift-guard test. *Mitigation:* the thin-index shape minimizes what can drift (no duplicated command detail — that's in the guides).
- **Risk: over-claiming operability.** Rating an op `operable` that isn't (e.g. a vendor command that actually prompts). *Detection:* the manual smoke exercises representative rows. *Fail-mode:* documentation-only, no runtime blast radius — a wrong row misleads an operator/agent but breaks nothing; corrected by editing the row.
- **Rollback:** trivial — revert the doc commit. No schema, no code, no deploy.

## Files touched

- **New:** `docs/CLI_OPERATIONS_CHARTER.md` (the charter).
- **Edit (light):** none required in code. The four guides (#224–#227) add their cross-links back to the charter on *their* branches, not here.

## Next step

Write `docs/CLI_FIRST_CHARTER.plan.md`, carving the work into ~4 TDD-style slices (here "test" = the structural/coverage self-audit + the smoke check, since there is no jest surface): (1) scaffold the doc structure + "How to read this" definitions block; (2) enumerate the AWS + Auth0 operations tables (priority surfaces) with commands, operable ratings, guide refs, dispositions; (3) enumerate Stripe + native tables and the overlap decisions + gap list/findings; (4) write the cross-surface common-workflows, compute + report coverage, and reconcile against Acceptance criteria. Each slice is a reviewable commit on this same `feat/cli-first-charter` branch.
