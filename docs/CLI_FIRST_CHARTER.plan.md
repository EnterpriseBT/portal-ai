# CLI-first operations charter — Plan

**Sequenced build of `docs/CLI_OPERATIONS_CHARTER.md`: the definitions block first, then the priority-surface tables (AWS + Auth0), then Stripe + native + overlap/gap sections, then the cross-surface workflows and computed coverage.**

Spec: `docs/CLI_FIRST_CHARTER.spec.md`. Discovery: `docs/CLI_FIRST_CHARTER.discovery.md`. Issue: #223 (epic #222). Builds on the shipped Portal CLIs (`cli-env`, `portalops`, `portalai`) now present on this branch after the epic fast-forwarded to `main`.

Four slices, each leaving `docs/CLI_OPERATIONS_CHARTER.md` internally coherent and committable. They land as **commits on `feat/cli-first-charter`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

**This is a documentation deliverable — there is no jest surface.** The TDD loop is adapted honestly: each slice's "test" is a **structural self-audit** (the slice's sections/rows satisfy the spec's schema + the relevant Acceptance-criteria items) followed, for the surface slices, by a **manual smoke** of a representative row against the user's own `local`/`app-dev` stack. Markdown under `docs/` is deliberately excluded from prettier/lint (CLAUDE.md → "Formatting enforcement"), so the slice boundary check is the self-audit, **not** `npm run lint`/`format`.

Each slice: (1) state the audit conditions (which spec cases/acceptance items the slice must satisfy); (2) write the section/rows; (3) re-read against those conditions (+ smoke the representative rows for surface slices); (4) next slice.

Sequencing rationale — definitions before the rows that use them; the high-value priority surfaces (AWS + Auth0) before the lighter Stripe/native; coverage last because it can only be computed once the whole table is enumerated:

- **Slice 1** — the doc skeleton + self-contained "How to read this" definitions block (predicate, coverage formula, binary rating, guard convention, compose-test). No rows yet — but every later row is rated/dispositioned against these definitions, so they come first.
- **Slice 2** — the **AWS + Auth0** operations tables (the priority surfaces where console time concentrates). Front-loaded so the highest-value content is in first and smoke-verified early.
- **Slice 3** — the **Stripe + native** tables, the overlap compose-test section (3 precedents), and the gap list + the two findings.
- **Slice 4** — the cross-surface **common-workflows** recipes, the **computed coverage** against the bar, and a full reconcile against Acceptance criteria.

---

## Slice 1 — Doc skeleton + "How to read this" definitions

Scaffold `docs/CLI_OPERATIONS_CHARTER.md` with the seven-section structure and the self-contained definitions block. No operation rows yet.

**Files**

- New: `docs/CLI_OPERATIONS_CHARTER.md` — title + purpose; the "How to read this" block (column legend; the CLI-operable predicate; the coverage-bar formula `N/D ≥ 0.90` + zero-unclassified + parity; the binary `Operable?` rule; the inline-guard convention; the overlap compose-test rule); empty `##` headers for AWS / Auth0 / Stripe / Native / Common-workflows / Overlap decisions / Gap list & findings / Coverage.

**Steps**

1. **Audit conditions (spec: Section structure, CLI-operable predicate, coverage-bar formula, binary rating & guard convention).** The skeleton must carry all seven sections and a definitions block that reproduces each rule verbatim from the spec, so the doc is self-contained.
2. **Write** the skeleton + definitions block.
3. **Self-audit:** all seven `##` sections present; the definitions block states the predicate (3 parts), the coverage formula (denominator = maint+config, `≥0.90`, parity clause), the binary rule, the guard-flag convention, and the compose-test rule — each matching the spec.

**Done when:** the doc opens with a definitions block a reader can apply to any row, and the per-surface section headers exist (empty). Acceptance item "seven-section structure + self-contained definitions block" is satisfied.

**Risk:** none — structure only.

---

## Slice 2 — AWS + Auth0 operations tables (priority surfaces)

Enumerate the two priority surfaces as task-phrased rows with all eight columns. This is the highest-value content (where console time concentrates).

**Files**

- Edit: `docs/CLI_OPERATIONS_CHARTER.md` — fill the **AWS** table (log inspection via `aws logs tail`, ECS exec, `run-task` migrate/seed, DB tunnel context, deploy/CFN) and the **Auth0** table (user/app/tenant directory reads + mutations, role/permission config, log tailing) with `Operation · Category · Envs · Owning CLI · Command · Operable? · Guide ref · Disposition`. `Guide ref` → #224 (AWS) / #226 (Auth0).

**Steps**

1. **Audit conditions (spec: Operations table column schema; Acceptance "AWS and Auth0 covered at least as thoroughly as native").** Every row has all eight columns; every `Disposition` non-blank; `Operable? = yes` only if the predicate holds across every env in `Envs`; canonical `Command` includes any guard flags.
2. **Write** the AWS + Auth0 rows.
3. **Self-audit** the two tables against the schema, then **smoke** two representative rows against your stack: an AWS log-tail (`aws logs tail /ecs/portalai-api-dev --follow --format short --format json`-capable) and an Auth0 directory read (`auth0 …` returning JSON), confirming each canonical `Command` runs non-interactively and returns machine-readable output.

**Done when:** the AWS and Auth0 tables are complete and schema-valid, and the two smoked rows actually run.

**Risk:** a vendor command that turns out to prompt or lack JSON → rate it `no` with a disposition, don't over-claim. This is exactly what the smoke catches.

---

## Slice 3 — Stripe + native tables, overlap decisions, gap list & findings

The lighter surfaces plus the two analytical sections.

**Files**

- Edit: `docs/CLI_OPERATIONS_CHARTER.md` — fill the **Stripe** table (event/subscription inspection via the landed billing runtime + `stripe` CLI; price changes as a Stripe-side act; `guide ref` → #225) and the **Native** table (`portalops vars`/`db`/`tier apply`, `portalai org`/`user`/`member`/`seed`; `guide ref` → #227); write the **Overlap decisions** section (compose-test + the `vars`/`db`/`tier apply` precedents + the standing rule); write **Gap list & findings** (every `Operable? = no` row + the `stripe-secret-key` deploy-wiring finding + the audit-log-reader-declined exception).

**Steps**

1. **Audit conditions (spec: Overlap decisions, Gap list & findings; Acceptance "overlap compose-test + 3 precedents stated", "gap list carries the two findings").** Overlap section states the rule + 3 precedents; gap list has no blank disposition and carries both findings with their routes (`deploy-infra`/#225; declined-exception).
2. **Write** the Stripe + native tables and the two sections.
3. **Self-audit** against those conditions, then **smoke** one native row (`portalops vars list --env app-dev --json` or `portalai org list --env app-dev --json`) end-to-end.

**Done when:** all four surface tables exist, the overlap section states the rule + three precedents, and the gap list carries every non-operable row + both findings.

**Risk:** none beyond over-claiming (same mitigation as slice 2).

---

## Slice 4 — Common-workflows, coverage computation, reconcile

The charter's owned substance + the measured result + the final audit.

**Files**

- Edit: `docs/CLI_OPERATIONS_CHARTER.md` — write the **Common-workflows** section (the "add a subscription tier" recipe in the spec's format, plus any other cross-surface task surfaced during enumeration); compute and write the **Coverage** section (`N/D` for maint+config, logging sub-figure, parity defects); final reconcile against every Acceptance-criteria item.

**Steps**

1. **Audit conditions (spec: Coverage-bar formula, Common-workflows recipe format, full Acceptance criteria).** Coverage computed from the enumerated table (no rounding-up); "add a tier" recipe present in the numbered CLI-per-step format; every Acceptance item satisfied.
2. **Write** the workflows + coverage sections; walk the full Acceptance checklist and fix any gap.
3. **Self-audit:** `N/D ≥ 0.90` (or the shortfall is explained + routed); every op classified; the recipe present; **full smoke pass** — the representative rows from slices 2–3 plus the "add a tier" recipe traced end-to-end.

**Done when:** coverage is reported against the bar, the common-workflow recipe is present, and all Acceptance criteria hold.

**Risk:** if computed coverage lands `< 0.90`, that's a real signal — enumerate the shortfall and either route each missing op to a disposition or record a justified exception; do not adjust the bar to pass.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | Skeleton + definitions block | self-audit: 7 sections + definitions match spec |
| 2 | AWS + Auth0 tables | schema-valid rows + smoke an AWS log-tail & Auth0 read |
| 3 | Stripe + native tables, overlap, gap list/findings | schema-valid rows + overlap rule/precedents + both findings; smoke a native op |
| 4 | Common-workflows, coverage, reconcile | coverage vs bar + full Acceptance checklist + full smoke |

## Cross-slice notes

- **Definitions are load-bearing across slices 2–4** — every row's `Operable?`/`Disposition` is judged against slice 1's definitions block; if a definition needs to change while enumerating, fix it in slice 1's block (and re-audit prior rows), don't diverge silently.
- **No jest, no lint/format for the doc** — markdown under `docs/` is prettier-excluded; the slice boundary is the structural self-audit, and the merge gate is the manual smoke (`/smoke 223`).
- **Smoke is the correctness gate, not just completeness** — the surface slices smoke representative rows so a shipped charter is *verified*, not merely *filled in*. Live `prod` rows are documented, never exercised (#83).
- **Doc-sync:** the four guides (#224–#227) add their cross-links *back* to the charter on their own branches — not in this PR. The charter path is appended to #223's issue index when the first commit lands (workflow bookkeeping, not a slice).

## Next step

Once discovery + spec + plan are confirmed, implementation starts on `feat/cli-first-charter` — slice 1 first (skeleton + definitions), one commit per slice.
