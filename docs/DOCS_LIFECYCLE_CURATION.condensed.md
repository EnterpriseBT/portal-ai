# Docs lifecycle curation — Condensed design (#419)

**Issue:** [EnterpriseBT/portal-ai#419](https://github.com/EnterpriseBT/portal-ai/issues/419) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `docs/` holds 335 `.md` files / 5.04 MB in one flat directory, and it grew by 104 files in the last three weeks. 282 of them are per-ticket phase artifacts (`.discovery` / `.spec` / `.plan` / `.smoke`) whose work has shipped, plus ~40 bare-named condensed write-ups in the same state. They are not a disk problem — they are a navigability problem, for a human and for an agent grepping for prior art. This deletes the spent artifacts and puts the rule in the development lifecycle so they stop accumulating. Repo tooling + conventions only; no application code.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Phase artifacts | `docs/*.{discovery,spec,plan,smoke}.md` | 282 files — 66 / 80 / 83 / 53 |
| Condensed ticket docs | bare-named, e.g. `docs/MAP_WIDGET_FLICKER.md` | ~40, indistinguishable by name from a durable reference |
| Durable references | charter, integration contract, runbooks, CLI ops guides | 13 files, listed below |
| Pointer gate | `scripts/check-doc-pointers.mjs` + `package.json:11` + `.github/workflows/unit-test.yml:41` | #417; fails CI when a source comment cites a missing `docs/*.md` |
| Skill style exemplars | `.claude/skills/{discovery,spec,plan,smoke}/SKILL.md:75,166,40,35,36` | Cite 5 phase docs — the only load-bearing citations in the tree |

## Decision — phase docs are ephemeral, and the suffix says so

**Delete, don't archive.** Git history is the archive: `git log --diff-filter=D -- docs/` finds a deleted doc, and the ticket + branch + PR carry the context. An archive directory would just inherit the growth curve.

**The lifecycle rule (the durable half of this ticket).** Starting a **feature** ticket sweeps `docs/` clean of leftover phase artifacts as its first action; bugfixes don't sweep, so their write-ups live until the next feature. Executed by `/discovery` when the issue type is `Feature`, not left to memory.

**Condensed docs get a suffix.** The sweep has to be mechanical, and a bare `MAP_WIDGET_FLICKER.md` is indistinguishable from `CLI_OPERATIONS_CHARTER.md`. So the condensed convention becomes `docs/<SLUG>.condensed.md`, and the sweep is one glob: `docs/*.{discovery,spec,plan,smoke,condensed}.md`. Anything with no suffix is durable by definition — that is the whole rule, and it needs no judgment call at sweep time.

**Exemplars move out of `docs/`.** The four workflow skills cite phase docs as style anchors, which under this rule are guaranteed to be deleted. They relocate to `.claude/skills/<phase>/EXAMPLE.*.md`, where curation never reaches them. This is what makes the rule safe rather than self-destructive.

**The pointer gate narrows instead of widening.** Stale `docs/` citations in source comments are acceptable — the ticket is recoverable from git history — so #417's check no longer applies to phase docs. It keeps gating the 13 durable references, where a dead pointer is still a real defect, by skipping targets that carry an ephemeral suffix. One predicate, ~4 lines.

**The 13 durable references kept:** `CLI_OPERATIONS_CHARTER.md` · `CUSTOM_TOOLPACK_INTEGRATION.md` · `LOCAL_DEVELOPMENT.md` · `AWS_CLI_OPS.md` · `AUTH0_CLI_OPS.md` · `STRIPE_CLI_OPS.md` · `PORTALSAI_MAIL.runbook.md` · `PROD_PROVISIONING.runbook.md` · `PROD_DEPLOY.runbook.md` · `PROD_STRIPE_LIVE.runbook.md` · `DEPLOYED_ENV_CONFIG.md` · `DB_RESET.md` · `POSTGIS_FOUNDATION.benchmark.md`.

## Plan — 4 slices

**Slice 1 — this doc.** Replace the over-built `.discovery.md` + `.spec.md` with this single `.condensed.md`. *Files:* delete `docs/DOCS_LIFECYCLE_CURATION.{discovery,spec}.md`, add `docs/DOCS_LIFECYCLE_CURATION.condensed.md`. *Tests:* none.

**Slice 2 — exemplars out, gate narrowed.** `git mv` 5 exemplars to `.claude/skills/discovery/EXAMPLE.discovery.md`, `.../discovery/EXAMPLE.condensed.md`, `.../spec/EXAMPLE.spec.md`, `.../plan/EXAMPLE.plan.md`, `.../smoke/EXAMPLE.smoke.md`; repoint the citing lines in the four `SKILL.md` files. Narrow `scripts/check-doc-pointers.mjs` to skip ephemeral-suffixed targets. *Tests:* `npm run lint:doc-pointers` exits 0 (it must, before and after).

**Slice 3 — the deletion.** `git rm` 322 files: the 282 phase artifacts plus the ~40 spent condensed write-ups. *Tests:* `npm run lint:doc-pointers` exits 0; `npm run format:check`, `npm run lint`, `npm run type-check`, `npm run build` unaffected.

**Slice 4 — the rule.** `CLAUDE.md` ("Issue → PR Workflow", condensed-path section) + `.github/copilot-instructions.md:85` record the sweep rule and the `.condensed.md` suffix; `/discovery` gains the sweep step (features only) and the renamed condensed output; `/spec`, `/plan`, `/smoke` update their condensed-doc detection glob. *Tests:* none automated — the smoke walk covers it.

## Smoke (manual, against your dev stack)

1. `ls docs/` — 13 files plus this ticket's `DOCS_LIFECYCLE_CURATION.condensed.md`. Every one is a durable reference or the in-flight ticket.
2. `npm run lint:doc-pointers` — exits 0. Then break it on purpose: add `// see docs/CLI_OPERATIONS_CHARTER.md` to a source file, rename the charter, re-run, confirm it fails; restore.
3. Confirm the gate ignores ephemera: add `// see docs/NOPE.spec.md` to a source file, re-run, confirm it still exits 0. Remove it.
4. `git log --diff-filter=D --oneline -- docs/ | head` then `git show <sha>:docs/MAP_WIDGET_FLICKER.md` — a deleted write-up is still readable from history.
5. `grep -rn "docs/" .claude/skills/*/SKILL.md` — no skill cites a `docs/` phase doc; the exemplar lines point at `EXAMPLE.*.md` beside each skill.
6. Read `CLAUDE.md` → "Issue → PR Workflow": the sweep rule and the `.condensed.md` suffix are stated, and the artifact table matches.
7. `npm run build && npm run type-check && npm run lint && npm run format:check` — all green (Static Checks parity).

## Out of scope

- **Doc content** — no rewriting or consolidating; curation only.
- **History rewriting** to reclaim the 5 MB — git keeps the objects, and that is the point.
- **Fixing stale `docs/` citations in source comments** — explicitly acceptable now; the ticket and branch are findable in git history.
- **Retro-suffixing the surviving 13** — they have no suffix *because* they are durable.
