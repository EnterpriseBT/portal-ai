# Agent SQL gate: validated text = executed text — Condensed design (#667)

**Issue:** [EnterpriseBT/portal-ai#667](https://github.com/EnterpriseBT/portal-ai/issues/667) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `validatePortalSql` strips comments with a hand-written state machine, then runs the regex pre-filter and the libpg-query AST gate over the **stripped** text (`cleaned`). The gate's guarantee holds only if Postgres executes that same text. `runSqlQuery` / `explainSqlQuery` do execute `cleaned`. But map tiles and dissolve validate a pinned pipeline and then embed the **raw** stored `pipelineSql` in their server-built wrappers. Where the stripper and Postgres's own lexer disagree about what is a comment, the text that ran is not the text that was checked. Separately, every wrapper splices the SQL in on the same line as its closing text (`(${sql}) _q LIMIT …`). A line comment Postgres honours at the end of the spliced text would swallow the rest of that line. The #662 reader role bounds relation reads at the database, but not a statement shape the gate never saw. Package: `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Strip → pre-filter → AST parse | `portal-sql-validation.util.ts:142–186` (`stripComments` at `:233`) | the parse and regexes run on `cleaned`; `cleaned` is returned |
| Agent SQL | `portal-sql.service.ts:899`, `:1030` | executes `cleaned` (via `applyImplicitLimit`, `portal-sql-limit.util.ts:37`) ✓ |
| Exact-total count | `portal-sql.service.ts:958` | `(${cleaned}) _c`: same-line splice |
| Tile gate | `portal-map-tile.service.ts:913–940` (`pipelineAllowed`, called at `:732`, `:975`) | validates `pipeline.sql`, returns a boolean; `cleaned` is discarded |
| Tile SQL builders | `portal-map-tile.service.ts:576`, `:616`, `:659` | embed the **raw** `pipelineSql`: `FROM (${pipelineSql}) src …` |
| Dissolve | `dissolve-precompute.processor.ts:207` (validate), `:271`, `:318`, `:380` (embed) | validates, then embeds the **raw** `pipelineSql` |
| Transform fragments | `bulk-transform.service.ts` (`assertTransformSql`) | re-parses the exact SQL it runs ✓ |

## Decision — make every call site run exactly `cleaned`, fenced

- **A. Execute `cleaned` everywhere, newline-fenced.** `pipelineAllowed` returns the validated `cleaned` (or `null` when rejected), and the tile builders and dissolve embed that. A single helper `fenceSql(cleaned)` returns `\n${cleaned}\n`. Every wrapper (implicit LIMIT, exact count, tile builders, dissolve CTEs) splices through it, so a line comment in the text ends at the newline before the wrapper's own text. Small and local, and no behaviour change for well-formed SQL.
- **B. Execute libpg-query's deparse of the AST.** Canonical SQL, comment-free by construction. But deparse fidelity across SQL-standard forms and PostGIS calls would change *every* executed statement, a wide regression surface for a narrow gap.
- **C. Drop the regex stripping and rely on the parser alone.** The pre-filter still carries the agent-facing error messages (`reserved verb: …`). Reworking it is scope creep, and under A its precision no longer affects safety, only messages.

**Decision: A.** It makes "validated = executed" true *by construction*: the regex pre-filter, the AST and Postgres all see `cleaned`, so any stripper imprecision can only produce a wrong error message, never an unchecked statement. The fence closes the same-line splice. **Review conclusion for the issue:** with A in place, `stripComments`' fidelity to Postgres's lexer is no longer security-relevant. The AST gate (on `cleaned`) plus the #662 reader role are the enforcement.

## Plan — one slice

**Files**
- Edit: `portal-sql-validation.util.ts`: export `fenceSql(cleaned)`. The header comment states the invariant ("callers execute `cleaned`, spliced through `fenceSql`").
- Edit: `portal-sql-limit.util.ts`, `portal-sql.service.ts:958`: splice through `fenceSql`.
- Edit: `portal-map-tile.service.ts`: `pipelineAllowed` → `validatedPipeline(): Promise<string | null>` (`cleaned` or null). The `:732` and `:975` call sites pass its result into the builders; the builders splice through `fenceSql`.
- Edit: `dissolve-precompute.processor.ts`: use the `cleaned` from `:207` in all three embeds, fenced.

**Tests** (failing first)
- `apps/api/src/__tests__/services/portal-sql-validation.util.test.ts`:
  - `fenceSql` wraps in newlines;
  - `applyImplicitLimit` on SQL ending in a line comment still yields a statement libpg-query parses as the LIMIT wrapper.
- `apps/api/src/__tests__/__integration__/routes/portal-map.router.integration.test.ts`: a pin whose stored pipeline carries comments (a trailing `-- note` and an inline block comment) renders the same tile as the comment-free pipeline, and the executed tile SQL contains `cleaned`, not the raw text (a transaction spy, as in the #660 tests).
- `apps/api/src/__tests__/__integration__/queues/dissolve-precompute.processor.integration.test.ts`: a commented pipeline dissolves to the same rows as its comment-free twin.
- `npm run test:unit` / `npm run test:integration -- --testPathPattern "portal-sql|portal-map|dissolve"`, `type-check`, `lint`.

**Code review addendum: every splice, not just tiles and dissolve.** The review found seven more places that wrap agent SQL unfenced:
- `geoInlineRows` (`tools/geo-delivery.util.ts`, used by inline map mint and pin refresh);
- `visualize-map.tool.ts`'s colour-stop, fit-extent and stored-pipeline wrappers;
- `portal-sql-handle.service.ts`'s `aggregateOverHandle` and keyset `streamHandle`.

A sweep found the same pattern in the transform path: `parsePortalSqlExpression`'s wrappers and `BulkTransformService`'s projection and WHERE splices. These paths already validate exactly the text they run (fail-closed). The gap was functional: a trailing comment broke the query. All are fenced now, so the rule is uniform: **every splice of agent SQL goes through `fenceSql`** (moved to `portal-sql-parse.util.ts`, re-exported from the validator). Tests per surface run the captured SQL through the real `validatePortalSql`, or reach Postgres.

## Smoke (manual, against your dev stack)

1. As a member, ask the agent to run `sql_query` on a granted view with a trailing `-- comment` and an inline `/* note */`. The rows come back as without them.
2. Pin a map from a commented query, then load its tiles (z14, and a dissolve zoom after a precompute). Both render. The API log for the tile transaction (with `log_statement = 'all'`) shows the pipeline text **without** its comments, on its own lines inside the wrapper.
3. The #660 smoke §2/§3 probes still reject exactly as before (spot-check three).

## Out of scope

- Rewriting `stripComments` or the regex pre-filter (C). Under A they affect only error messages.
- Executing a deparsed AST (B).
