# Dead `docs/*.md` pointers in source comments — Condensed design (#417)

**Issue:** [EnterpriseBT/portal-ai#417](https://github.com/EnterpriseBT/portal-ai/issues/417) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** 43 source docblocks across `apps/api`, `apps/web`, `packages/core`, and `packages/spreadsheet-parsing` cite 12 per-phase design docs that were deleted from `docs/` after the work landed. They read as authoritative references, so a contributor (human or agent) chasing the rationale behind a non-obvious invariant follows the citation, finds nothing, and either re-derives the decision or assumes it was never written down — encountered live during #416. This fixes the pointers and adds a CI check so the next phase-doc cleanup can't reintroduce them. Comment-only; no behavior, no contract change.

## Current shape

The repro from the issue reproduces exactly on `main` (46 unresolved sites, of which 3 are the Microsoft subset already fixed on #416's branch, leaving 43).

| Piece | Location | Note |
|---|---|---|
| Unit-test CI job | `.github/workflows/unit-test.yml:24` | Runs `format:check` then `test:unit`; the natural home for a new repo-wide gate |
| Root scripts | `package.json:8-22` | All turbo passthroughs; no root-level `scripts/` dir exists yet |
| Heaviest family | `docs/GOOGLE_SHEETS_CONNECTOR.phase-{A,B,C,D,E}.plan.md` | 24 sites, all `§Slice N` coordinates |
| Load-bearing sites | `adapter.interface.ts:152,175` · `connector-instance.contract.ts:20,64` · `connector-entities.table.ts:15` · `reconcile.ts:300` · `sync-eligibility.util.ts:15` | Named in the issue as where rationale matters most |
| Stale in `CLAUDE.md` | `CLAUDE.md:318` | Module Pattern → Reference Implementation cites `docs/SPREADSHEET_PARSING.frontend.spec.md`. No mirror line exists in `.github/copilot-instructions.md` (checked) |

**Survey finding that closes the design space:** the issue's suggested repoints do not hold up.

- `docs/LARGE_FILE_PARSE_STREAMING.plan.md` has **no** `§Phase 0` or `§Phase 1–3b` anchor (its phases are 1–4), and it is a different subject — the chunked-Redis-cache streaming parse, not the presigned-S3-upload pipeline. **No doc in `docs/` mentions "presign" at all**, so `LARGE_WORKBOOK_STREAMING.plan.md`'s design is simply not written down anywhere.
- `docs/SPREADSHEET_PARSER_ROW_ASYNC.{spec,plan}.md` is the `loadRange` row-async refactor; it does not define `LayoutPlan`, the commit pipeline, or `connector_instance_layout_plans`, which is what the `SPREADSHEET_PARSING.backend.*` citations pointed at.
- Nothing survives for the `GOOGLE_SHEETS_CONNECTOR.phase-*`, `BINDING_OVERRIDES`, `RECORD_IDENTITY_REVIEW`, or `REGION_CONFIG.c*` families either (`GOOGLE_SHEETS_PICKER.*` is the later narrow #415 ticket, not a successor).

So **repoint (action 1) applies to zero of the 43 sites.**

## Decision — strip, with a local reword where the pointer was load-bearing

Reading all 43 docblocks: in every case the surrounding prose already states the invariant and its reason. The dead pointer adds a coordinate, not an argument. Two candidate shapes:

- **Inline fresh rationale at the ~7 load-bearing sites** (issue's action 2). Rejected as written — it invites inventing a "why" the docblock already contains, and re-deriving deleted-doc reasoning from the code is exactly the failure the ticket is about.
- **Strip the pointer; reword only where removing it breaks the sentence or orphans a doc-internal coordinate.** Chosen.

Concretely, the reword cases — everything else is a clean deletion of the `See docs/… §…` sentence:

| Site | Why a reword, not a plain strip |
|---|---|
| `connector-entities.table.ts:15`, `reconcile.ts:300`, `connector-instance-layout-plans.router.integration.test.ts:1224` | `C1` / `C2` are decision ids from the deleted `REGION_CONFIG.*` specs. Name the invariant ("`key` unique per organization", "one region per target entity") instead of the id |
| `sync-eligibility.util.ts:15` | "The hard gate moved to an advisory in Phase B of `<doc>`" — the clause is grammatically dependent on the citation |
| `s3.service.ts:24` | "Reinstated as part of `<doc>` Phase 0" — same |
| `file-uploads.table.ts:18` | "See `<doc>` §Phase 0 **for the full design**" — the status machine directly above *is* the design; drop the deferral |
| `reconcile.integration.test.ts:4` | "the binding-override surface **added by** `<doc>`" — same |
| `CLAUDE.md:318` | Drop the parenthetical; `modules/RegionEditor/` is its own reference implementation |

The `§Slice N` / `Phase A–E` coordinates are dropped wholesale — they address a deleted doc's internal structure and mean nothing without it.

**Prevention:** a root `scripts/check-doc-pointers.mjs` + `npm run lint:doc-pointers`, wired as a step in `unit-test.yml`. It greps `apps/*/src` and `packages/*/src` for `docs/…​.md` pointers and exits non-zero listing any that don't resolve, so the *deleting* commit is what fails next time. Brace forms (`phase-{B,C}`) are expanded before the existence test.

**Ordering dependency (resolved):** the 3 Microsoft pointers were out of scope here — #416 owned them. The check failed on this branch until #416 merged; after rebasing onto `main` (now `b25d966d`) it exits 0 across all 1698 source files.

## Plan — 2 slices

**Slice 1 — the check (fails first, by design).**
- **Files:** `scripts/check-doc-pointers.mjs` (new), `package.json` (add `lint:doc-pointers`), `.github/workflows/unit-test.yml` (add step before `test:unit`).
- **Tests:** the script *is* the test — `npm run lint:doc-pointers` must exit 1 and list all 46 sites on an unmodified tree. No jest test: a unit test asserting "the repo has no dead pointers" is the script itself, and duplicating it in `apps/api`'s suite would put a repo-wide gate inside one package's tests.

**Slice 2 — fix the 43 in-scope sites + `CLAUDE.md`.**
- **Files:** the 34 source files from the issue's Evidence list (excluding `microsoft-auth.service.ts`, `microsoft-excel-connector.router.ts`, and `environment.ts:83`'s Microsoft block), plus `CLAUDE.md:318`.
- **Tests:** `npm run lint:doc-pointers` → 3 remaining sites, all Microsoft. Then `npm run format:check`, `npm run lint`, `npm run type-check`, `npm run test:unit` — all must stay green (comment-only, so any failure means an edit escaped a comment).

## Smoke (manual, against your dev stack)

Comment-only, so there is no runtime behavior to exercise; the walk verifies the gate and that the docblocks still read correctly.

1. `npm run lint:doc-pointers` — exits **1**, listing exactly the 3 Microsoft sites and nothing else. Confirms the 43 are gone and the check actually detects a dead pointer.
2. Confirm the check isn't vacuously passing: `git stash push -u -m scratch-417` (then `git stash apply <sha>` to restore — never bare `git stash pop`, the stack is shared across worktrees), or point it at a scratch worktree of the pre-fix commit. It must exit **1** and list the sites.
3. `npm run format:check && npm run lint && npm run type-check && npm run test:unit` — all green.
4. Open three of the reworded docblocks — `apps/api/src/db/schema/connector-entities.table.ts`, `apps/api/src/services/sync-eligibility.util.ts`, `apps/api/src/adapters/adapter.interface.ts` — and read each top to bottom. Each should state its invariant and *why* without a dangling reference or an orphaned `C2` / `§Slice` coordinate.
5. `CLAUDE.md` → "Module Pattern → Reference Implementation" names `modules/RegionEditor/` with no dead `docs/` link.
6. Done: rebased onto `main` after #416 merged, and step 1 exits **0**. Also confirm no `MICROSOFT_EXCEL_CONNECTOR` pointer survived the replay in `environment.ts`, `microsoft-excel-connector.router.ts`, or `microsoft-auth.service.ts`.

## Out of scope

- **Recreating the 12 deleted design docs.** Removed deliberately; this fixes pointers, not history.
- **The 3 Microsoft pointers** (`environment.ts:83`, `microsoft-excel-connector.router.ts:10`, `microsoft-auth.service.ts:16`) — fixed on #416. Hence the ordering dependency above.
- **Doc-to-doc dead citations.** Source comments only. Known live example found while surveying: `docs/EDIT_LAYOUT_PLAN_FLOW.spec.md:290` cites `docs/SPREADSHEET_PARSING.backend.spec.md`. Worth its own ticket; extending the check to `docs/**` would fail on it immediately.
- **`apps/api/dist/**`** — build output, regenerates.
- **Non-`docs/` stale references** in comments (issue numbers, deleted symbols, branch names). Different problem, no cheap check.
