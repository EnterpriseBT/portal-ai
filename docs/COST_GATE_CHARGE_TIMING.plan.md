# Cost-gate charge timing — Plan

**TDD-sequenced move from charge-on-admission to charge-on-success: split the gate into pre-flight admission + post-success commit, defer async-job tools to their processor, and document the "failed calls are free" contract.**

Spec: `docs/COST_GATE_CHARGE_TIMING.spec.md`. Discovery: `docs/COST_GATE_CHARGE_TIMING.discovery.md`. Issue: #183 (epic #177). Builds on shipped #169 (the gate + wrap + `chargeConditional`) and #172. Supersedes `TOOL_COST_GATE.spec.md:317`.

Three slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `chore/cost-gate-charge-timing`** — one ticket, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests per package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale:
- **Slice 1** reshapes the gate + sync wrap — the core behavior change (charge-on-success, no-charge-on-throw). It's self-contained in `cost-gate.service.ts` and its test file, and delivers the headline win for every sync tool on its own.
- **Slice 2** adds the async-job path (the `deferChargeToJob` flag + the processor commit). It depends on slice 1's `commitCharge` existing, so it sits second.
- **Slice 3** is docs-only (supersede note + user-facing copy) — no code, lands last so the prose matches the shipped behavior.

Note: slice 1 reworks the existing `cost-gate.resolve.test.ts` (the #169 meter-on-attempt cases). That's an intended clean cut, not breakage — the old `resolveCostGate` is replaced, not aliased (`feedback_no_compat_aliases`).

---

## Slice 1 — Split the gate + charge sync tools on success

Replace `resolveCostGate` with `checkAdmission` (pre-flight, no charge) + `commitCharge` (post-success), and rework `wrapWithCostGate` so a sync tool charges only after `original` resolves.

**Files**

- Edit: `apps/api/src/services/cost-gate.service.ts` — add `PendingCharge`, `AdmissionResult`; `checkAdmission` (free/org immune → estimate → rate split-fail → affordability via `getBalance` → deny/allow, no charge); `commitCharge` (recompute policy+period at `now` → `chargeConditional`, skip-if-over, never throws); rewrite the wrap (admission → `original` → commit-if-success-and-not-deferred). Add `deferChargeToJob` to `ToolCostMeta` (consumed here; set in slice 2).
- Edit: `apps/api/src/__tests__/services/cost-gate.resolve.test.ts` — rework to the split.

**Steps**

1. **Tests (spec Layer 1 + Layer 2 sync cases).** `checkAdmission`: free/org → `{allowed:true,charge:null}` no rate/balance calls; rate over → deny RATE_LIMITED no charge; estimate > available → deny QUOTA_EXCEEDED no charge; within alloc → `{allowed:true,charge:{units,costClass}}`; unlimited → allowed; Redis-down → still allowed (split-fail); infra error → fail-open `{allowed:true,charge:null}`. `commitCharge`: within alloc → `chargeConditional` called; over alloc → skipped no-throw; null → no-op; infra error → swallowed. Wrap: sync success → `commitCharge` once after `original`; sync **throws** → `original` ran, `commitCharge` NOT called; admission deny → `original` not called. Run; fail.
2. **Implement** the split + wrap rewrite. `deferChargeToJob` defaults false (slice 2 wires the true case). Green.
3. Lint + type-check `apps/api`.

**Done when:** the reworked gate suite passes; a thrown sync tool consumes 0 units; the wrap commits only on success. `metaFor` still compiles (adds `deferChargeToJob:false` literal until slice 2).

**Risk:** the affordability read (`getBalance`) + conditional commit are two steps — by design (spec Risks). Watch that `checkAdmission` never charges (assert `chargeConditional` not called on the admission path).

---

## Slice 2 — Defer async-job tools; charge on job success

Wire `deferChargeToJob` from the capability and commit the `bulk_transform` charge in the processor's success path.

**Files**

- Edit: `apps/api/src/services/tools.service.ts` — `metaFor` sets `deferChargeToJob = !isCustom && ALL_TOOL_CAPABILITIES[name]?.resultKind === "progress"`.
- Edit: `apps/api/src/queues/processors/bulk-transform.processor.ts` — on successful completion (after the loop returns, before the top-level `return`), `CostGateService.commitCharge({ organizationId, costClass: ALL_TOOL_CAPABILITIES.transform_entity_records.costHint, units: await resolveCallCost("transform_entity_records", undefined), actor: { userId } })`.
- Edit: `apps/api/src/__tests__/services/tools.service.test.ts` — `deferChargeToJob` cases.
- New: `apps/api/src/__tests__/queues/bulk-transform.processor.test.ts` (or extend an existing processor test) — commit-on-success cases with mocked `CostGateService`.

**Steps**

1. **Tests (spec Layer 2 defer + Layer 3).** `metaFor`: `deferChargeToJob` true only for `transform_entity_records`, false for sync built-ins. Wrap: a `resultKind:"progress"` tool success → admission ran, wrap `commitCharge` NOT called. Processor: job success → `commitCharge` called once with `{costClass:"expensive", units:1, organizationId, actor}`; job failure (loop throws) → `commitCharge` NOT called. Run; fail.
2. **Implement** the `metaFor` flag + the processor commit. Green.
3. Lint + type-check `apps/api`.

**Done when:** a `transform_entity_records` job charges 1 expensive unit only on completion; a failed job charges nothing; the wrap no longer charges the enqueue return.

**Risk:** the processor must commit exactly once across both the tool-kind and sql-kind branches — place the commit at the single top-level success point (after `runToolDispatchLoop`/`runSqlBatchLoop` returns), not inside each loop, to avoid double-charge. Confirm `userId` is present in job metadata (`transform-entity-records.tool.ts:723`).

---

## Slice 3 — Docs: charge-on-success contract

Make the prose match the shipped behavior.

**Files**

- Edit: `docs/TOOL_COST_GATE.spec.md` (~:317) — replace the meter-on-attempt acceptance with a pointer to charge-on-success (this ticket).
- Edit: the user-facing usage note — verify which of `apps/web/src/utils/faq.util.ts` / `glossary.util.ts` covers units/usage; add/adjust a line: metered/expensive tools are billed only when a call **succeeds**; failed calls are free; usage resets each billing period.

**Steps**

1. **Tests (doc-sync).** If the touched help surface has a pinning test (`faq.util.test.ts` / `glossary.util.test.ts`), update it to the new copy; run; fail then green. If no such test, note it — the change is prose.
2. **Implement** the doc edits. Green.
3. Lint + type-check (web, if the help util changed).

**Done when:** `TOOL_COST_GATE.spec.md` no longer claims meter-on-attempt; a user reading help learns failed calls are free.

**Risk:** none functional. Just ensure the help pinning test (if any) is updated in the same slice.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | gate split (`checkAdmission`/`commitCharge`) + sync charge-on-success | `apps/api` unit green; thrown sync tool charges 0 |
| 2 | `deferChargeToJob` + processor commit-on-job-success | `apps/api` unit (+integration) green; failed job charges 0 |
| 3 | supersede `spec.md:317` + user-facing "failed calls are free" | help pinning test (if any) green |

## Cross-slice notes

- **Clean cut, no alias:** slice 1 deletes `resolveCostGate`; the wrap and tests move to the split in the same slice (`feedback_no_compat_aliases`).
- **`ToolCostMeta.deferChargeToJob`** is introduced in slice 1 (consumed by the wrap) and *set* in slice 2 (`metaFor`) — slice 1 ships it defaulting false so the tree stays green between slices.
- **Single commit site in the processor** (slice 2) — top-level success, not per-loop — to avoid double-charge.
- **Doc-sync (per `CLAUDE.md` → "Keeping Documentation in Sync")** is slice 3, in this same PR — the charge-timing change alters documented behavior (`spec.md:317`) and a user-visible billing semantic (#182 made usage visible), so both dev + user surfaces update here.
- **No migration, no schema change, no refund/decrement path** anywhere.

## Next step

Once discovery + spec + plan are reviewed and confirmed, implementation begins on `chore/cost-gate-charge-timing` — slice 1 first (tests red-then-green), one commit per slice, PR (`Closes #183`) opened after the first commit lands.
