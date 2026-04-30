# Phase A — Identity Provenance Schema + Interpret User-Lock + Mapping Plumbing

Foundation phase for `docs/RECORD_IDENTITY_REVIEW.spec.md`. Adds the `source: "heuristic" | "user"` discriminator to `IdentityStrategy`, makes `detectIdentity` honor the user-lock, and round-trips the field through draft/hint/plan mapping. Strictly invisible to end users — every default keeps current behavior intact. Gates Phase D (the UI override).

## A.1 Goals

1. `IdentityStrategySchema` accepts `source: "heuristic" | "user"` on every variant; default `"heuristic"`.
2. `detectIdentity` returns the input strategy unchanged (single candidate) when `region.identityStrategy.source === "user"`.
3. `regionDraftsToHints` and `planRegionsToDrafts` (apps/web file-upload mapping helpers) round-trip the new field.
4. All pre-existing persisted plans parse with no migration step (default fills in `"heuristic"`).
5. No user-visible change. The new option is dormant until Phase D wires UI.

## A.2 Non-goals

- UI surface for the override (Phase D).
- Drift / sync semantics (Phase B).
- Banner / button copy (Phase C).
- Composite-locator override (post-spec).

## A.3 TDD plan — write these tests first, watch them fail, then implement

Run all tests via the package scripts (never raw `jest`/`npx`): `npm run test:unit` from each affected package directory. Type-check via `npm run type-check`.

### A.3.1 Schema parse tests
File: `packages/spreadsheet-parsing/src/plan/__tests__/schemas.test.ts`

1. **Default fills in.** A column-locator strategy persisted without `source` parses cleanly and yields `source === "heuristic"`. Mirror for composite and rowPosition variants.
2. **User value round-trips.** Each variant accepts `source: "user"` and re-serializes it.
3. **Rejects unknown values.** `source: "ai"` (or any string outside the enum) fails parse.

These three cases land in a new sub-describe `IdentityStrategySchema — source field`.

### A.3.2 detectIdentity user-lock tests
File: `packages/spreadsheet-parsing/src/interpret/stages/__tests__/detect-identity.test.ts`

1. **User-locked column-locator survives.** Input region with `identityStrategy: { kind: "column", sourceLocator: { kind: "column", sheet, col: 2 }, confidence: 0.7, source: "user" }`. Expect candidates list of length 1; the candidate's strategy is deeply equal to the input's; rationale matches `/user-locked/i`.
2. **User-locked rowPosition survives.** Input with `identityStrategy: { kind: "rowPosition", confidence: 0.0, source: "user" }`. Expect single candidate, kind = rowPosition, source remains `"user"`.
3. **Heuristic source still gets re-detected.** Input with `source: "heuristic"` plus a workbook that has a unique column. Expect the existing behavior: the unique column wins regardless of any prior heuristic strategy.

### A.3.3 Mapping round-trip tests
File: `apps/web/src/workflows/FileUploadConnector/__tests__/layout-plan-mapping.util.test.ts`

1. **regionDraftsToHints writes source.** Draft with `identityStrategy: { kind: "column", sourceLocator: "...", source: "user" }` produces a hint whose `identityStrategy.source === "user"`.
2. **planRegionsToDrafts reads source.** Region from a plan with `identityStrategy.source === "user"` produces a draft carrying the same field.
3. **Backward-compat read.** Region without a `source` field on `identityStrategy` produces a draft with `identityStrategy.source === "heuristic"`.

### A.3.4 Type-check / linter
- `npm run type-check` in `packages/spreadsheet-parsing` and `apps/web` clean.
- `npm run lint` clean — no new warnings.

## A.4 Implementation steps

Each step lands in dependency order. Run the failing tests added in A.3 after each step; the relevant subset should pass.

### Step 1 — Extend `IdentityStrategySchema`
File: `packages/spreadsheet-parsing/src/plan/strategies.schema.ts`

Add to all three variants:

```ts
source: z.enum(["heuristic", "user"]).default("heuristic"),
```

The Zod default fires on parse, so existing persisted plans (no `source` key) read as `"heuristic"`. Re-export through `packages/spreadsheet-parsing/src/plan/index.ts` is automatic.

Ensure `propose-bindings.ts:pickIdentity` propagates `source` faithfully — it already returns the candidate's strategy verbatim, so no change required, but verify with a focused test.

### Step 2 — `detectIdentity` user-lock branch
File: `packages/spreadsheet-parsing/src/interpret/stages/detect-identity.ts`

At the top of `candidatesForRegion`, before the heuristic walks, short-circuit:

```ts
if (region.identityStrategy?.source === "user") {
  return [
    {
      strategy: region.identityStrategy,
      score: region.identityStrategy.confidence,
      rationale: "User-locked identity; heuristic skipped.",
    },
  ];
}
```

Note: `region.identityStrategy` is non-optional on `Region` post-`proposeBindings`, but on the *input* region (re-interpreting an already-committed plan) it has been populated by the prior run. The optional-chaining defends against tests that hand-roll partial inputs.

### Step 3 — Frontend draft type extension
File: `apps/web/src/modules/RegionEditor/utils/region-editor.types.ts`

Extend the inline `identityStrategy?` shape on `RegionDraft`:

```ts
identityStrategy?: {
  kind: IdentityStrategyKind;
  sourceLocator?: string;
  source?: "heuristic" | "user";
  confidence?: number;
};
```

The default-region helper at `apps/web/src/modules/RegionEditor/utils/default-region.util.ts:65` keeps emitting `{ kind: "rowPosition", confidence: 0.6 }` (no `source`) — the absent field is treated as `"heuristic"` everywhere. No edit needed there.

### Step 4 — Mapping plumbing
File: `apps/web/src/workflows/FileUploadConnector/utils/layout-plan-mapping.util.ts`

In `regionDraftsToHints`, when copying `draft.identityStrategy` into the hint, propagate `source` if present:

```ts
hint.identityStrategy = {
  kind: draft.identityStrategy.kind,
  sourceLocator: ...,
  ...(draft.identityStrategy.source ? { source: draft.identityStrategy.source } : {}),
};
```

In `planRegionsToDrafts`, when copying `region.identityStrategy` into the draft, copy `source` through with a default of `"heuristic"`.

The same helpers serve the gsheets workflow (no separate edit).

## A.5 Files touched

```
packages/spreadsheet-parsing/src/plan/strategies.schema.ts
packages/spreadsheet-parsing/src/plan/__tests__/schemas.test.ts
packages/spreadsheet-parsing/src/interpret/stages/detect-identity.ts
packages/spreadsheet-parsing/src/interpret/stages/__tests__/detect-identity.test.ts
apps/web/src/modules/RegionEditor/utils/region-editor.types.ts
apps/web/src/workflows/FileUploadConnector/utils/layout-plan-mapping.util.ts
apps/web/src/workflows/FileUploadConnector/__tests__/layout-plan-mapping.util.test.ts
```

## A.6 Verification (acceptance for Phase A)

1. `npm run test:unit` passes in `packages/spreadsheet-parsing` and `apps/web`.
2. `npm run type-check` clean across the monorepo.
3. Load any pre-existing committed plan from a non-prod database snapshot. Round-trip: read → re-interpret → write. The persisted `IdentityStrategy` shape is unchanged save for an explicit `source: "heuristic"` on every region. No regressions in the sync output (delta still `unchanged` for unchanged rows).
4. A region whose draft is hand-edited to carry `source: "user"` (e.g. via a one-off integration test) keeps that strategy through interpret + commit + replay. No heuristic override.

## A.7 Risks and mitigations

- **Schema serialization mismatch.** If a frontend client posts a hint without `source`, Zod fills `"heuristic"`. Risk-free.
- **`detect-identity.ts` short-circuit shadows future heuristics.** Mitigation: only fires when `source === "user"`; `"heuristic"` (default) and missing both go through the existing path.
- **Composite locator carries `source`.** v1 doesn't expose composite editing in UI, but the schema accepts `source` on the composite variant for symmetry. Locking a composite locator via direct API edit is allowed; UI surface stays single-locator.
