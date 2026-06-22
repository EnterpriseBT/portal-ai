# Toolpack taxonomy + data-management redesign — Plan (slice map)

**This umbrella is too large for one PR — it splits into independently-shippable child tickets off `main`, each with its own discovery/spec/plan, each green on its own, each `Closes #<child>`. #121 stays open as the tracking umbrella and ships no code itself.** This doc is the **slice map**: the children, their dependency order, what each ships, and how the in-flight bulk tickets reconcile. The binding contract every child conforms to is `docs/TOOLPACK_TAXONOMY.spec.md`.

Spec: `docs/TOOLPACK_TAXONOMY.spec.md`. Discovery: `docs/TOOLPACK_TAXONOMY.discovery.md`. Issue: [#121](https://github.com/EnterpriseBT/portal-ai/issues/121).

Per-child loop (same as #114): write failing tests → red → smallest change → green → full unit (+ integration when touched) → `lint` + `type-check` → commit; each child's own plan sequences its internal slices.

## Dependency DAG

```
A foundation (capability schema + projections + role view)   ← blocks everything
├── B declarative enforcement (D5)
├── C record-source + mode-selection (D3)
│     └── D streamable cursor handle (unbounded, D6/Appendix)
│           └── E reduce-tier push (D4 spike)
│                 └── E2 streaming variants: mini-batch k-means, SGD logit (optional, exact-unbounded)
├── F bulk-collapse → job modes (D8)   [needs B + C]
├── G viz-consumer + resultKind routing (D6)   [fixes #120; needs A]
│     └── H web renderer registry (D7)   [needs G; web-side; #84/#92 consumers]
└── I custom-pack capability subset + registration validation   [needs A; feeds #124]
```

A is the spine. B, C, G, I can start in parallel once A merges. D→E is the unbounded-data spine. H waits on G.

**Sequencing realignment (2026-06-22):** A, B, C, D, G, H, I are merged (+ #124). The remaining two run **E → F, in that order**. E makes `sql_query` the reduce operation **and** introduces the **job cardinality tier** (D8a — auto-detected + cost-ack-gated async escalation; `sql_query@job` rehomes `bulk_aggregate`'s 120s off-thread scan). F then **shrinks** to removing the now-redundant `bulk_*` tools — `bulk_aggregate_records` is already absorbed by E's `sql_query@job`, leaving F = rename `bulk_transform_entity_records` → `transform_entity_records` + capability-driven cost/lock + close #101/#102/#112. So **F now depends on E**, not just B+C.

## The children

### A — Capability-metadata foundation *(blocks all)*
**Ships:** `ToolCapabilitySchema` (`packages/core/src/models/tool-capability.model.ts`); capability declared on `ToolpackTool` + `ToolpackToolDefinitionSchema`; **every built-in tool's capability declared** in `builtin-toolpacks.ts`; the coherence refinements; the three projections (pack/enablement/enforcement) + role view reading metadata; type-checks binding capability to the registry. **No behavior change** — enforcement still behaves as today, but now *derives* from metadata (e.g. `alwaysAvailable` reproduces `SYSTEM_TOOL_PACKS`).
**Done when:** all built-ins carry coherent capabilities; projections compute today's behavior from metadata; `#115/#116` consistency suite stays green.

### B — Declarative enforcement *(needs A)*
**Ships:** cost-ack reads `costHint`; `409` lock reads declared `locks` (+ enqueued jobs declare locks from capability); `alwaysAvailable` replaces `SYSTEM_TOOL_PACKS`; per-tool write-gate replaces the pack-level block. Removes the slug/name hardcodes (`tools.service.ts:173`, `job-lock.service.ts:83/122/149`).
**Done when:** every enforcement gate is config-only; a guard test proves no slug/name enforcement remains; per-gate integration tests green.

### C — Record-source + runtime mode-selection *(needs A)*
**Ships:** `record-source.ts` abstraction; runtime picks inline/handle/job by N bounded by `consumption`; `onOverflow` for `bounded`; generalizes the `sql_query` `INLINE_ROWS_THRESHOLD` auto-switch. Cursor path stubbed (delivered in D).
**Done when:** a tool's input mode is chosen from N + `consumption`; small-N is inline even for a `streaming` tool (ceiling, not mandate); `bounded` overflow surfaces in the result.

### D — Streamable cursor handle *(needs C)*
**Ships:** the handle becomes cursor-backed beyond `HANDLE_ROW_CAP` (engine cursor / re-runnable query — spec/spike detail); paged/streamed reads; read/viz/streaming-reduce consumers stream past 100k with no wall. The ≤100k Redis snapshot stays the cheap tier.
**Done when:** an unbounded read/scan and an unbounded streaming-reduce both complete without `COMPUTE_INPUT_TOO_LARGE`; memory stays bounded (integration test over > 100k rows).

### E — Reduce-tier push + the job tier *(needs C and D; precedes F)*
Realigned 2026-06-22 to also own the **job cardinality tier** (D8a), since establishing `sql_query` as the reduce operation is what a job mode attaches to. Suggested sub-slices, each green + smoke-walked on its own:
- **E1 — job tier (D8a):** the auto-detect + cost-ack-gated async escalation; `sql_query@job` for a long aggregate read (rehomes `bulk_aggregate`'s 120s off-thread scan as the read op's job mode). Generalizes the existing cost-ack reject→ack→retry flow into the escalation mechanism. This is the piece F depends on.
- **E2 — reduce-tier push:** remove the 10 SQL-pushed tools (prompt/description guidance → `sql_query`); convert `hypothesis_test`/`var_cvar`/`regression` to `engine-pushdown` (O(N) reduction in SQL, O(1) residue in-tool); confirm the `streaming`/`bounded` declarations from #129 (`forecast` done; `cluster`/`logistic_regression` `bounded`+`onOverflow`). §6-style smoke per pack before each removal.
- **E3 (optional, own ticket):** mini-batch k-means + SGD logistic as `streaming` variants — the only two that otherwise hit `onOverflow`. Makes 100% of the tier exact-unbounded.
**Done when:** the job tier escalates a long `sql_query` aggregate to a cost-ack-gated async job; the reduce tier is 8 tools; pushdown tools exact at any N; smoke confirms the agent does the removed work in SQL.

### F — Bulk-collapse → job modes (D8) *(needs B + C + E)*
With E's `sql_query@job` in place, F **shrinks**: `bulk_aggregate_records` is already absorbed (it's `sql_query` at job mode). F's remaining work:
- **Rename** `bulk_transform_entity_records` → `transform_entity_records` (the transform-over-source op is irreducible; drop the `bulk_` prefix, keep behavior, no compat alias); cost-ack reads `capability.costHint` not the slug; locks already capability-driven (gate-4, #142). `bulkDispatch` retained as the per-batch map capability.
- **Remove** `bulk_aggregate_records` (+ its now-unused service/processor/JobType, since E rehomed the scan).
- **Close #101/#102/#112** as reconciled job-modes — no code (delete/apply/materialize job-modes ship only when a concrete caller needs them).
**Done when:** no `bulk_*` agent-facing tool exists; the transform op + the `sql_query@job` aggregate both run as cost-ack-gated, lock-declaring jobs; #101/#102/#112 closed reconciled. Then close umbrella #121 and re-file E3 if not done.

### G — Visualization consumer + resultKind routing (D6) *(needs A)*
**Ships:** `resolveDisplayBlock` keys off `resultKind`, not `ROW_SET_TOOLS`/tool-name; aggregate-before-render for viz consumers. **Fixes #120** properly.
**Done when:** `cluster`/`detect_outliers` (or their SQL successors) no longer emit a spurious empty data-table; routing is `resultKind`-driven; an integration test covers each `resultKind`.

### H — Web renderer registry (D7) *(needs G; web-side)*
**Ships:** `apps/web` `resultKind → renderer` registry; portal/agent format-agnostic; a curated `d3` renderer (e.g. `force-graph`) + the `geo` renderer hook for #84. Stories + unit tests render the pure UI per the component policy.
**Done when:** adding a new `resultKind` is a registry entry + a tool declaration, with **no** portal/agent change; #84/#92 can build on it.

### I — Custom-pack capability subset + registration validation *(needs A; feeds #124)*
**Ships:** the pure-consumer subset on the wire schema; `fetchSchema` validates it with named errors; dialog reference + `CUSTOM_TOOLPACK_INTEGRATION.md` updated. Runtime record-feeding (`bounded`=#122 body, `streaming`=#124 pull) is **#124**, not here.
**Done when:** a custom pack declaring `engine-pushdown`/`writes`/`locks` is rejected at registration with a clear error; a valid pure-consumer pack registers and its capabilities surface read-only in the UI.

## In-flight ticket reconciliation

| Ticket | Was | Now |
|---|---|---|
| **#101 `bulk_delete`** | new bulk tool | **refashion** into child F (delete op's job mode). Close-or-refold when F's spec lands. |
| **#102 `bulk_apply`** | new bulk tool | **refashion** into child F (transform op's job mode; `bulkDispatch`). |
| **#112 `bulk_materialize`** | new bulk tool | **refashion** into child F (materialize op's job mode). |
| **#120** display bug | standalone fix | **subsumed** by child G (`resultKind` routing) — keep #120 open as G's acceptance, or ship a minimal independent fix first if it's urgent. |
| **#122** webhook records-in-body | closed not-planned | the `bounded` custom path; validated by I, fed by #124. |
| **#124** webhook scaling | blocked on #121 | **unblocked** when A+C+D+I land; consumes this contract. |
| **#84 GIS / #92 trace pins** | own tickets | downstream consumers of child H's registry. |

**Recommendation:** file children A–I as issues under #121 (A first; B/C/G/I can go to `Todo` immediately). Fold #101/#102/#112 into F's scope and close them as "superseded by #121/F" when F's spec is written — they stop being standalone tools. Keep #120 as G's acceptance criterion unless it needs an urgent independent patch.

## Sequencing notes

- **A must merge before any other child** — it is the schema + projection spine; everything imports `ToolCapabilitySchema`.
- **D is the heaviest child** (cursor infra) and the long pole for "unbounded seamless"; E's pushdown/streaming tools depend on it for the > 100k path (they work bounded without it, so E can land a bounded-only first cut if D slips).
- **B and G are the fastest wins** — B makes enforcement config-only; G fixes #120. Both unblock reviewer confidence early.
- **F is the most disruptive to agent behavior** (tool surface changes) — land it after B+C are proven and smoke-walked.
- Each child's PR body carries this slice map and its position in the DAG.
