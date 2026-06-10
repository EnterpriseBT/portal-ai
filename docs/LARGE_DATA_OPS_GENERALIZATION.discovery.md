# Large-Data-Ops Generalization — Discovery

**Issue:** Follow-up to [#85](https://github.com/EnterpriseBT/portal-ai/issues/85) (Large Data Operations). Specific generalization tickets filed alongside this doc.

**Why this exists.** The Phase 1–4 work landed three concrete pieces of large-data infrastructure (`sql_query` handle path, `display_entity_records`, `bulk_transform_entity_records`). The smoke walk surfaced that this set is *narrow* — it covers reads and per-record-write-to-one-column, but leaves real-world data-analysis patterns (bulk delete, fold-to-value, multi-column writes, side-effects-only) without a primitive. This is the discovery that names the broader set, decides where the cuts live, and seeds the follow-up tickets.

The framing the rest of this doc rests on (recorded in session memory as `feedback_tool_purity`): **tools are pure functions whose output has no inherent relationship to entity shape; jobs are async-execution infrastructure that minimizes context-window usage; the agent is the orchestrator that picks the right tool + right job to perform the user's task.** Jobs and tools never know about each other's structure; the agent's *invocation* carries the linkage.

## The current shape

### Three large-data primitives ship today

| Primitive | Location | Iteration | Output |
|---|---|---|---|
| `sql_query` handle path | `apps/api/src/tools/sql-query.tool.ts:23-54` | none (one query) | live-hydrating table/chart via `QueryResultDataBlock` |
| `display_entity_records` | `apps/api/src/tools/display-entity-records.tool.ts:36-72` | none | same |
| `bulk_transform_entity_records` | `apps/api/src/tools/bulk-transform-entity-records.tool.ts` | per-record | UPSERT N rows into one target wide-column |

`bulk_transform` recently landed (`70a3393`) with `expression.tool.targetColumn: string` — the agent supplies a single target column; the tool returns a single value per call; the dispatcher writes that value to the column. That contract is correct as far as it goes, but the rest of the design space is unfilled.

### Shared job infrastructure already exists

Every job type today reuses:
- BullMQ queue + worker (`apps/api/src/queues/processors/`)
- Per-job SSE channel (`/api/sse/jobs/:id/events` — `apps/api/src/routes/job-events.router.ts`)
- Entity locking (`JobLockService.assertConnectorEntityUnlocked` — `apps/api/src/services/job-lock.service.ts`)
- Cancel-via-discard + terminal envelope persistence
- The `BulkJobProgressBlock` widget (`apps/web/src/components/BulkJobProgressBlock.component.tsx`)

That infrastructure is sound. The new primitives are about *specialized input/output shapes* on top of it — not new plumbing.

### What the smoke walk surfaced

§4a's path-to-green required four pre-flight checks + three rewrites of the dispatcher contract before the single-column primitive worked. The pattern is: when the input shape is too narrow, the agent compensates with creative misuses (passing field-name hints as `args`, projecting the key column under invented aliases, recreating target entities with doubled `c_` prefixes). Each misuse cost a debug round-trip. Broader primitives + clearer pre-flight messages prevent the entire class of misuse.

## The design space

### Decision 1 — Single general primitive vs. several named ones

| | A: One `bulk_job` with `{source, compute, output}` axes | B: Five named primitives, each narrow |
|---|---|---|
| Surface area | One tool with a complex schema (≥3 unions, each multi-variant) | Five small tools with clear names |
| Agent discoverability | Hard — agent must learn the DSL | Each tool's name *is* the question it answers |
| Composition | Every workflow happens inside one call | Workflows compose by chaining job calls |
| Backwards compat with today | Major break (replace existing tools) | Additive (extend transform, add three new) |

**Lean: B (five named primitives).** Matches the Unix philosophy already encoded in `feedback_tool_purity`. Each primitive's name *is* the user-prompt shape it serves. Agent discoverability is the key driver: the tool description for each primitive is the agent's contract with itself about what's appropriate. A single mega-job with a `kind` discriminator forces the agent to learn an internal DSL.

### Decision 2 — Where multi-write coverage lands

| | A: Generalize `bulk_transform` writes to an array | B: Add `bulk_multi_write` as a separate primitive |
|---|---|---|
| Schema impact | `targetColumn: string` → `writes: Array<{column, valueFrom: ...}>` (breaking) | New tool; today's transform stays single-column |
| Cases covered | Per-record into 1+ columns, same or different target entities | Same set, but agent picks between two tools |
| Agent decision burden | One tool for all per-record writes | Two tools; risk of confusion |

**Lean: A (generalize transform's writes).** The user's framing — "the agent decides what to do with the tool's output" — fits exactly here: the agent chooses how many target columns it wants and supplies a `writes[]`. Tool stays pure (returns one value or a record); the agent's `writes[]` is what bridges value → target columns. No separate primitive needed.

### Decision 3 — `bulk_apply` (side-effects only) vs. degenerate transform

| | A: Separate `bulk_apply` primitive | B: `bulk_transform` with `writes: []` |
|---|---|---|
| Clarity | "Apply" reads as "side effects" — no write expectation | Empty `writes` looks like a bug |
| Implementation | Skip the upsert step entirely | Existing code path with an array-length guard |
| Agent prompt fit | "For each X, do Y" — natural for `bulk_apply` | Forces awkward framing |

**Lean: A (separate `bulk_apply`).** The name carries semantic weight; pre-flight can validate side-effects-only invariants (e.g., the tool must declare it has no return shape OR the return is ignored). Cheaper than overloading transform.

### Decision 4 — Composite per-record work (multi-step pipeline)

| | A: Add `bulk_pipeline` with sequenced steps | B: Agent composes sequential `bulk_transform`s, writing intermediate state |
|---|---|---|
| Expressiveness | Full per-record DAG | Linear sequences only |
| Schema | Complex (steps with references between outputs) | None |
| Worker complexity | Significant (orchestrate sub-tool-calls per record) | None — just enqueue another job |

**Lean: B (agent composes).** The agent already has the ability to enqueue jobs sequentially. Writing intermediate state to a column between steps is mechanical. A dedicated pipeline primitive would essentially be a workflow DSL inside a tool — too much surface, and the agent's job is precisely this kind of orchestration.

### Decision 5 — Streaming-N-results (regression per group)

| | A: `bulk_aggregate` returns `array<T>` | B: `bulk_transform` writes results into a side entity; agent reads via `bulk_query` |
|---|---|---|
| Primitives | `bulk_aggregate` shape widens | No primitive change; composition of existing two |
| Persistence | Result in envelope (transient — TTL'd via Redis like other handles) | Persisted in target entity (durable) |
| Agent flow | One call, immediate read | Two calls, second is a normal read |

**Lean: B (compose, no aggregate widening).** Aggregate stays scalar-or-small-object. Many-result outputs become a side entity the agent queries afterward. Aligns with "each primitive has one shape."

## Tradeoff comparison

|  | B: five primitives | A: generalize transform writes | A: separate bulk_apply | B: agent composes pipelines | B: compose for streaming N |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | No — pure guidance | No — pure guidance |

## Recommendation

The full primitive set, post-generalization:

1. **`bulk_query`** — reads for live render. (Already shipped; see `sql_query` + `display_entity_records`.)
2. **`bulk_transform`** — per-record compute + write to N columns. **Generalize** today's narrow primitive: replace `expression.tool.targetColumn: string` with `writes: Array<{ targetConnectorEntityId, column, valueFrom }>`. The agent supplies how each tool/sql output binds to a target column.
3. **`bulk_aggregate`** — fold across all matching records to one scalar / small object. SQL aggregator OR a `fold_tool(acc, row) → acc` shape.
4. **`bulk_delete`** — remove records by criteria (SQL WHERE or explicit ID list). No per-record loop on the worker — the SQL DELETE runs in one shot; the job wrapper exists for progress, lock, and cancel.
5. **`bulk_apply`** — per-record side effects with no entity write. Tool dispatch over the source; return values are *discarded* (or surfaced in the terminal envelope's `partialFailures` if the tool throws). For "call X per record" use cases — notifications, external syncs, audit log fan-out.

Composition principles:
- **Multi-step per-record** ⇒ chain `bulk_transform`s with intermediate columns.
- **Streaming N results** ⇒ `bulk_transform` into a side entity, then `bulk_query` to consume.
- **Update by criteria, no compute** ⇒ degenerate `bulk_transform` (sql kind, constant projection) or a future `bulk_update` if "constant SQL transform" feels awkward.

## Open questions

1. **`valueFrom` shapes for `bulk_transform.writes[]`.** The clear ones: `{ kind: "tool_result" }`, `{ kind: "tool_path", path }`, `{ kind: "sql_alias", alias }`, `{ kind: "source_column", column }`, `{ kind: "constant", value }`. Is there a sixth I'm missing? **Lean: this is enough.** Source-column passthrough covers the agent-wants-to-copy-a-column case; constants cover "set field to literal."
2. **`bulk_delete` source spec.** Two shapes: SQL `whereSqlFragment` OR explicit `sourceIds: string[]`. Both are useful — the agent might receive an ID list from a prior tool call. **Lean: support both via a discriminated union.**
3. **Should `bulk_apply` allow agent to capture per-record return values in the terminal envelope?** Today's transform discards returns when writes is empty. **Lean: support `captureResults: boolean`; envelope carries an array of `{sourceKey, result}` up to a cap (say 10k rows × 1KB each = 10MB). Beyond the cap, the job warns and only includes counts.**
4. **Cross-primitive lock semantics.** Today bulk_transform locks the target entity. Should bulk_delete also lock? bulk_apply? **Lean: any primitive that writes locks its target(s); reads (bulk_query, bulk_aggregate) don't.**

## What this doesn't decide

- Implementation order beyond "transform's writes[] generalization is the most immediate." `bulk_aggregate` and `bulk_delete` are useful follow-ups; `bulk_apply` is the least urgent because side-effects-only flows aren't currently blocking anyone.
- The specific Zod schema for each `valueFrom` variant; that's a spec-time concern.
- Whether to file these as one umbrella issue ("Large-Data-Ops Generalization") with sub-issues, or independent issues each referencing this doc. **Lean: independent issues** — each primitive ships on its own PR + own smoke walk.
- Whether to keep `bulk_transform_entity_records`' current narrow `targetColumn` field as a shortcut alongside the new `writes[]` — or make the cut clean. **Per `[[project_no_production_data_yet]]`, lean clean cut.**

## Next step

This doc grounds five follow-up tickets (filed alongside the commit). The `docs/bulk-writes` branch ships the existing narrow primitives (Phase 1–4 of #85); the smoke walk completes against those. The generalizations land in separate PRs after the bulk-writes branch merges.
