# Curate `docs/` by lifecycle — Discovery

**Issue:** [EnterpriseBT/portal-ai#419](https://github.com/EnterpriseBT/portal-ai/issues/419)

**Why this exists.** `docs/` is a single flat directory holding **335 files / 5.04 MB** across **144 ticket families**. `ls docs/` is no longer a navigable surface — not for a human looking for the current design of a subsystem, and not for an agent grepping for prior art before starting a ticket. The issue rules out the two usual justifications: it is not a disk problem (git keeps the objects either way) and it is not an age problem (the oldest doc is `2026-05`). The axis that does discriminate is **lifecycle** — an artifact the workflow consumed once (a `.smoke.md` merge gate that was walked, a `.plan.md` that drove an implementation to completion) versus a doc something still points at.

The survey sharpens that thesis and moves the numbers. The issue counted "referenced from somewhere" as 228/322 and "referenced by nothing" as 94. Both are true and both mislead, because **most referencing inside `docs/` is siblings citing siblings** — a `.spec.md` linking its own `.discovery.md` is not evidence that either is live. Measured against citations from *outside* `docs/`, only **38 docs** are cited at all, and **78** are reachable even transitively.

This is the pass that deletes what nothing points at — **222 files across 97 families**, computed as a fixpoint that provably leaves no surviving file citing a deleted one — and, because `docs/` took on 104 files in the last three weeks, the CI enforcement that keeps the boundary from re-blurring.

## The current shape

### The tree

| | |
|---|---|
| Files / bytes | 335 `.md`, 5.04 MB, **flat** (no subdirectories exist today) |
| Ticket families | 144 (a family = one slug's `.discovery` / `.spec` / `.plan` / `.smoke` set) |
| Added per month | 47 (`2026-05`) · 41 (`06`) · 143 (`07`) · 104 (`08`, three weeks in) |
| Kinds | 83 `.plan.md` · 79 `.spec.md` · 65 `.discovery.md` · 53 `.smoke.md` · 55 bare/`.runbook`/`.benchmark` |

### The citation graph

Three concentric sets, measured over every tracked `.ts/.tsx/.md/.mjs/.js/.json/.yml/.sh` file:

| Set | Count | Meaning |
|---|---|---|
| Cited from a **live root** | **38** | A pointer from source (`apps/*/src`, `packages/*/src`), `CLAUDE.md`, a `README.md`, `.claude/**`, `.github/**`, `infra/**`, `scripts/**`, `docker-compose.yml`, `drizzle.config.ts` |
| Reachable from a live root, transitively through doc-to-doc links | **78** | The 38 plus what they point at, following absolute *and* relative links |
| Reachable from **nothing** outside `docs/` | **257** | By kind: 67 `.plan` · 55 `.spec` · 48 `.discovery` · 48 `.smoke` · 40 bare · 1 `.runbook` |

At family granularity: **104 of 144 families have no live citation to any member** — the whole `[discovery, spec, plan, smoke]` set hangs free.

Load-bearing citations that constrain any deletion (a representative slice, not the full 38):

| Doc | Cited from | Why it can't go |
|---|---|---|
| `docs/SPREADSHEET_PARSER_ROW_ASYNC.spec.md` | 13 source sites | Heaviest source-cited doc |
| `docs/LARGE_FILE_PARSE_STREAMING.plan.md` | 13 source sites + `infra/cloudformation/backend.yml:45` | Also cited from infra |
| `docs/CLI_OPERATIONS_CHARTER.md` | `CLAUDE.md:483,488` · `.github/copilot-instructions.md:97` | Convention doc |
| `docs/CUSTOM_TOOLPACK_INTEGRATION.md` | `CLAUDE.md:254,678` · `apps/api/README.md:83` · 2 source sites | Contract doc |
| `docs/SPREADSHEET_PARSER_ROW_ASYNC.discovery.md` | `.claude/skills/discovery/SKILL.md:75` | **A skill reads it as its style exemplar** |
| `docs/PORTAL_MESSAGE_TIMESTAMPS.md` | `.claude/skills/discovery/SKILL.md:166` · `CLAUDE.md:551` | Condensed-path exemplar |
| `docs/SUBSCRIPTION_TIER_POLICY.{spec,plan}.md`, `docs/TOOL_COST_GATE.{spec,plan}.md` | `.claude/skills/{spec,plan}/SKILL.md:40,35` | Skill exemplars |
| `docs/BULK_AGGREGATE.smoke.md`, `docs/DEVOPS_CLI.smoke.md` | `.claude/skills/smoke/SKILL.md:36` | **Two `.smoke.md` files are live** — the kind is not uniformly spent |
| `docs/PORTALSAI_MAIL.runbook.md` | `.github/workflows/deploy-dev.yml:87,463` · `infra/cloudformation/dns-email.yml:19` | Cited from CI |
| `docs/PROD_PROVISIONING.runbook.md` | `.github/workflows/deploy-prod.yml:15,502` + 2 source sites | Cited from CI |
| `docs/POSTGIS_FOUNDATION.spec.md` | `docker-compose.yml:63` | Cited from compose |
| `docs/ENTITY_RECORDS_WIDE_TABLE_PHASE_1.spec.md` | `apps/api/drizzle.config.ts:14` | Cited from config |

### The check we're extending, and its blind spots

`scripts/check-doc-pointers.mjs` (#417, wired as `lint:doc-pointers` at `package.json:11`) walks `git ls-files -- apps packages`, keeps `^(apps|packages)/[^/]+/src/` `.ts|.tsx`, and fails on any `docs/*.md` pointer that doesn't resolve. Extending it to `docs/**` plus the guide surfaces is not a scope-widening one-liner:

1. **Relative doc-to-doc links are invisible.** 94 sites inside `docs/` cite siblings with no `docs/` prefix — 25 as markdown links (`](./FOO.discovery.md)`, e.g. `docs/LOCAL_DEVELOPMENT.md:3,14,24,35,55`, `docs/CLI_OPERATIONS_CHARTER.md:76,77,217`, `docs/PAGINATED_LIST_PERFORMANCE.spec.md:5`) and 69 as backticked bare names. A `docs/`-prefixed regex misses all of them, so they contribute neither to the reachability graph nor to the dead-pointer gate. Under deletion this is the load-bearing fix: a relative link is a citation, and a citation is what decides whether a doc lives.
2. **Guide files were never in scope, and 7 dead targets live there right now.** #417 fixed source comments only. Still unresolved on `main`: `README.md:167,168` → `DEV_DEPLOYMENT.spec.md`, `DEV_DEPLOYMENT.implementation.md`; `apps/api/README.md:189,198` → `SPREADSHEET_PARSING.backend.spec.md`, `FILE_UPLOAD_DEPRECATION.plan.md`; `packages/spreadsheet-parsing/README.md:5,82` → `SPREADSHEET_PARSING.{architecture.spec,backend.spec,backend.plan}.md`. The issue's acceptance criterion ("every doc cited from source, `CLAUDE.md`, a README, or a `.claude` skill still resolves") therefore **already fails today**, before anything is deleted.
3. **Two citation forms must be exempt, not fixed.** `docs/DEAD_DOC_POINTERS.md:15,17,76` names 7 deleted docs *as its subject matter* — it is #417's record of what was removed, and it predicted this exact collision ("extending the check to `docs/**` would fail on it immediately"). Separately, `.claude/settings.local.json:41` is `Bash(git -C /workspace show babd698:docs/GOOGLE_SHEETS_CONNECTOR.discovery.md)` — a `<sha>:docs/…` reference that is *correct precisely because* the doc is deleted. Both are true negatives for a file-existence check.

Two granularity facts that bound the check: citations carry `§Slice N` / `§Phase N` anchors no existence check can validate, and the 69 backticked bare names are prose, not paths.

## The design space

### Decision 1 — What predicate decides "live"

**A. Any citation anywhere** (the issue's 228/94 split). **B. Cited from a live root** — a non-`docs/` file. **C. Reachable from a live root**, following doc-to-doc links transitively. **D. Family-level C** — a family is live if any member is reachable; families go whole. **E. D as a fixpoint** — promote the family, then follow the *promoted* members' outbound links, and repeat until nothing new is promoted.

| | A: any citation | B: direct root | C: transitive | D: family pass | E: family fixpoint |
|---|---|---|---|---|---|
| Docs kept | 243 | 38 | 78 | 103 | **113** |
| Kills the sibling-citation illusion | No | Yes | Yes | Yes | Yes |
| Breaks a live doc's own outbound links | n/a | **Yes** | No | No | No |
| Splits a ticket family across live/deleted | Often | Often | Sometimes | Never | Never |
| **Surviving files left citing a deleted doc** | 0 | many | some | **7** | **0 — by construction** |

**Lean: E.** C is the correct *reachability* answer and D is C at the right granularity, but under deletion both are unsafe for the same reason: a family promoted *after* the traversal never has its own outbound links followed. Measured, D leaves exactly 7 such sites — `docs/PROD_AWS_INFRA.plan.md:85,114`, `docs/PROD_AWS_INFRA.spec.md:255`, `docs/LARGE_DATA_OPS_PHASE_1.plan.md:273`, `docs/PINNING_REFACTOR.plan.md:187`, `docs/BULK_AGGREGATE.discovery.md:7` — every one a surviving doc pointing into the void, which is #417's failure mode manufactured fresh. E closes that in 5 rounds and pulls 7 families back (`AWS_CLI_OPS`, `LARGE_DATA_OPS_GENERALIZATION`, `LARGE_DATA_OPS_PHASE_{2,3,4}`, `PIN_DIALOG_ERRORS`, `PROD_DEPLOY`) for 10 extra files. Ten files is a trivial price for the invariant "no surviving doc cites a deleted one," and it means the deletion needs **zero** hand-repair of its own making.

### Decision 2 — Delete or archive

**A. `git rm`.** **B. Move to `docs/archive/<FAMILY>/`.**

| | A: delete | B: archive |
|---|---|---|
| `ls docs/` shortens | Yes | Yes |
| Prior art recoverable | `git log --diff-filter=D` + `git show <sha>:<path>` | `grep docs/archive/` |
| Reclaims clone size | No (objects retained) | No |
| New convention to document | No | Yes |
| Risk if a citation is missed | **Dead end** | Longer path |
| Ends the recurrence | Yes | No — the archive becomes the next flat directory |

**Decision: A, delete.** Archive keeps the bytes reachable by grep, but it does not end the problem it is solving: at ~100 docs a month the archive is itself an unnavigable flat tree within a quarter, and "spent artifact, moved aside" is a state the workflow has no further use for. Git is the archive that already exists, and the repo demonstrates the recovery path working in the wild — `.claude/settings.local.json:41` is an allowlisted `git show babd698:docs/GOOGLE_SHEETS_CONNECTOR.discovery.md`, someone reading a deleted doc out of history. Decision 1's fixpoint is what makes this safe: the missed-citation risk that argues for archiving is measured at zero, not assumed away.

### Decision 3 — How the extended check handles relative links and the sites that must be exempt

The extension must resolve a relative link against the citing file's directory, and let two forms stand.

For the exemption: **A. A path allowlist in the script.** **B. An inline marker** (`<!-- doc-pointers-ignore-next-line: <reason> -->`). **C. Front-matter opt-out per file.**

| | A: allowlist | B: inline marker | C: front matter |
|---|---|---|---|
| Reason lives next to the exemption | No — one hop away | **Yes** | Yes |
| Survives a rename | No | Yes | Yes |
| Granularity | Whole file | Line | Whole file |
| Precedent in this repo | — | `CLAUDE.md` requires an `eslint-disable` to carry its reason in-file | None — no doc has front matter |

**Lean: B for prose, plus a narrow structural exclusion.** The marker covers `docs/DEAD_DOC_POINTERS.md`'s inventory, where the reason belongs on the line. `.claude/settings.local.json` is different in kind — a machine-written permission allowlist, not prose, that no one should be hand-annotating — so it is excluded by path, and any `<sha>:docs/…` form is excluded by shape since a git-object reference is not a filesystem claim. A whole-file allowlist for `DEAD_DOC_POINTERS.md` is rejected because it would also hide a *genuinely* dead pointer introduced into that same file later.

### Decision 4 — Ordering

**A. Delete → extend the check → fix the fallout.** **B. Extend the check → fix the pre-existing dead pointers → delete (green throughout).** **C. Fix pointers → delete → extend the check last.**

**Lean: B.** The check is the instrument that makes the deletion safe, so it lands first and the tree is made green *before* 222 files are removed; the deletion commit then has to keep a gate green that can already see relative links and guide surfaces. A inverts that — it deletes first and uses the fallout as the to-do, which is #417 re-run at 5× the blast radius and, unlike an archive, with no path back except history. C leaves the largest and least reversible commit in the series unverified at the moment it lands.

## Tradeoff comparison

| | E: family fixpoint | A: delete | B: inline marker + structural exclusion | B: check-first ordering |
|---|---|---|---|---|
| Spread to spec | Yes — the predicate is the spec's core contract | Yes | Yes | Yes — fixes slice order |
| Changes `CLAUDE.md` | Yes (retirement convention) | Yes | No | No |
| Touches `scripts/check-doc-pointers.mjs` | Shares its resolver | No | Yes | No |
| Reversible | Yes (recompute) | Via `git show <sha>:<path>` | Yes | n/a |

## Recommendation

1. **Retention predicate:** a family is live if any member is reachable from a live root (source, `CLAUDE.md`, any `README.md`, `.claude/**`, `.github/**`, `infra/**`, `scripts/**`, `docker-compose.yml`, `drizzle.config.ts`), computed as a **fixpoint**: promote the whole family, follow the promoted members' outbound links, repeat to closure. Absolute and relative links both count as citations. No file is judged by its date or its suffix.
2. **Spent families are deleted with `git rm`** — 222 files across 97 families on today's tree, recomputed at implementation time rather than hardcoded from this doc. The invariant the spec asserts: **zero surviving files cite a deleted doc**, verified by running the extended check after the deletion commit.
3. **`scripts/check-doc-pointers.mjs` grows to cover `docs/**` and the guide surfaces** (`CLAUDE.md`, every `README.md`, `.claude/**`, `.github/**`, `infra/**`, root config) in addition to source, and learns to resolve relative links against the citing file's directory. It gains an inline `<!-- doc-pointers-ignore-next-line: <reason> -->` escape, excludes `.claude/settings.local.json` by path, and never fires on a `<sha>:docs/…` git-object reference.
4. **The 19 pre-existing dead sites are fixed before anything is deleted** — 11 genuine repairs (`README.md:167,168`; `apps/api/README.md:189,198`; `packages/spreadsheet-parsing/README.md:5×3,82`; `docs/EDIT_LAYOUT_PLAN_FLOW.spec.md:290`; `docs/LARGE_DATA_OPS.discovery.md:565×2`), 7 marked in `docs/DEAD_DOC_POINTERS.md`, 1 excluded structurally. Repairs follow #417's playbook: repoint at the surviving doc, inline the rationale, or drop the pointer when the prose stands alone.
5. **Slice order is census → check → green → delete → document**, so the irreversible commit lands against a gate that can already see everything that cites a doc.
6. **`CLAUDE.md` records the convention** in "Issue → PR Workflow": doc artifacts are written to `docs/`, and a family is deleted once nothing outside `docs/` cites any member — git history is the archive. `.github/copilot-instructions.md` takes the mirrored edit in the same commit, and the four workflow skills (`discovery`, `spec`, `plan`, `smoke`) are read for hardcoded assumptions about what persists in `docs/`.
7. **The census script is committed** as `scripts/docs-census.mjs`, sharing the checker's pointer resolver so the two can never disagree about what a citation is. The next pass is `node scripts/docs-census.mjs`, not a re-derivation.

## Open questions

1. **Does the deletion leave a tombstone record?** #417's `DEAD_DOC_POINTERS.md` is precedent for writing down what was removed. **Lean: no separate doc.** The deletion commit's `git show --stat` *is* the record, `scripts/docs-census.mjs` reproduces the classification, and a hand-maintained tombstone list is the same staleness this ticket is clearing. The commit message names the 97 families.
2. **Do the two live `.smoke.md` files stay?** `BULK_AGGREGATE.smoke.md` and `DEVOPS_CLI.smoke.md` are cited by `.claude/skills/smoke/SKILL.md:36` as exemplars, so their families survive. **Lean: yes, they stay** — and that is the predicate working rather than a wart in it: a "spent by kind" rule would have deleted them and broken a skill.
3. **Should the check verify `§Slice N` anchors?** Citations carry them; nothing validates them. **Lean: out of scope** — file existence is the failure #417 actually observed, and anchor-checking needs a heading parser plus a `§` convention that doesn't exist. Record in the spec's non-goals.
4. **Do the 69 backticked bare names count as citations?** Under deletion the recovery for a stale one is `git log`, not a grep of the tree, so the stakes are higher than under archiving. **Lean: they count for *reachability* but not for the *gate*.** Feeding them into the census is free and strictly reduces false deletions (it is why the survivor set is 113 and not 103); firing the CI gate on any backticked `.md`-looking token would flag prose about hypothetical and deliberately-deleted docs, which is unfixable noise.
5. **Is `apps/api/dist/**` still excluded?** #417 excluded it as regenerated output. **Lean: keep excluded**, and confirm it isn't tracked — `git ls-files` decides, not the glob.

## Enterprise-scale considerations

Repo hygiene, no runtime surface — most dimensions are genuinely `N/A`, and are marked so rather than padded.

- **Concurrency & correctness** — `N/A because` nothing executes. The only race is a doc being deleted in this PR while another in-flight PR adds a citation to it; the check catches that at merge because `main` requires branches to be up to date (`CLAUDE.md` → Branch protection).
- **Accuracy & auditability** — **Lean: git is the ledger, and the recovery path is stated, not assumed.** Deletion costs the working-tree copy: recovery is `git log --diff-filter=D -- <path>` then `git show <sha>:<path>`, one step worse than an archive and demonstrably in use already (`.claude/settings.local.json:41`). What makes that acceptable is the fixpoint invariant — no surviving pointer sends anyone looking — plus committing the census script so the classification is reproducible rather than a claim in this doc.
- **Failure modes** — **Lean: fail closed, in CI.** `lint:doc-pointers` already gates the unit-test workflow; widening its scope means a dead pointer fails a PR instead of landing. The inline marker is the only fail-open path and must carry a reason, matching the repo's zero-warning `eslint-disable` rule.
- **Scale & unbounded growth** — **Lean: this is the dimension that matters, and it is why deletion beats archiving.** `docs/` took 143 files in `2026-07` and 104 in three weeks of `2026-08`; a one-time sweep is re-consumed within a quarter, and an archive directory would inherit the growth curve it was meant to relieve. The durable deliverable is the predicate + census script + CI gate; the 222 deletions are the smaller half of the work.
- **Multi-tenancy** — `N/A because` no tenant data or per-org surface is involved.
- **Contract stability** — **Lean: the retirement rule is a contract.** Once `CLAUDE.md` says a family is deleted when nothing outside `docs/` cites it, the `/discovery`, `/spec`, `/plan`, and `/smoke` skills all write against it — including the four that cite specific docs as exemplars, which the predicate must keep alive (open question 2). Those four files are read in the same slice that edits `CLAUDE.md`, not after.
- **Data lifecycle** — **Lean: lifecycle is the whole thesis.** Retention keys to "is it still cited," a semantic signal, not to a technical window like age or file count — the "not an arbitrary technical window" rule applied to docs instead of billing periods.

## What this doesn't decide

- **Doc content.** No rewriting, merging, or summarizing — curation only, per the issue's out-of-scope. A stale *claim* inside a surviving doc is a different ticket.
- **History rewriting** to reclaim the 5 MB. Explicitly excluded by the issue, and deletion makes it less appealing still: history is now the only copy.
- **The 43 source-comment pointers** — shipped in #417.
- **Anchor-level (`§Slice N`) verification** and gating on backticked bare names — open questions 3 and 4, deferred with reasons.
- **Whether `docs/` should gain structure later** (per-subsystem subdirectories for the surviving 113). Possible follow-up; it is a different question from retirement, and 113 flat files is navigable.

## Next step

`docs/DOCS_LIFECYCLE_CURATION.spec.md` pins the contract: the fixpoint predicate and its live-root set, the shared pointer resolver (absolute + relative), the extended checker's scope, marker syntax and two structural exclusions, and the acceptance criteria restated as assertions (`lint:doc-pointers` exits 0 over `docs/**` + guide surfaces; **zero** surviving files cite a deleted doc; no file judged by date). `docs/DOCS_LIFECYCLE_CURATION.plan.md` then slices it in the Decision-4 order — (1) `scripts/docs-census.mjs` + shared resolver, (2) checker extended with relative resolution, marker, and exclusions, (3) the 19 pre-existing dead sites fixed to green, (4) the 222-file deletion, (5) `CLAUDE.md` + `.github/copilot-instructions.md` + the four workflow skills reconciled — each slice a commit that leaves `lint:doc-pointers` green.
