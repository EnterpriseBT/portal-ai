# Implementation Plan: Extra Diagram Support (Full Vega & D3 Tree)

## Context

The portal visualization pipeline currently supports `text`, `vega-lite`, and `data-table` block types. This plan extends it with **full Vega** specs (tree layouts, network graphs, geographic maps) and **D3-based** interactive hierarchy trees. Full Vega is low-effort since `react-vega` already ships the `Vega` component. D3 trees add a new dependency (`react-d3-tree`) for collapsible, pan/zoom hierarchy UX.

Based on discovery document: `features/EXTRA_DIAGRAM_SUPPORT.discovery.md`

---

## Phase 1 — Full Vega Support

### 1.1 Schema & Contract Updates

**Files:**
- `packages/core/src/models/portal-result.model.ts` — add `"vega"` to `PortalResultTypeSchema`
- `packages/core/src/contracts/portal.contract.ts` — add `"vega"` to `PortalBlockTypeSchema`

`PINNABLE_BLOCK_TYPES` derives from the model enum automatically — no change needed.

#### Tests to write:
- [x] `packages/core/src/__tests__/models/portal-result.model.test.ts` — add `"vega"` to the existing "accepts all valid types" test case; add a dedicated `it("should accept vega type")`
- [x] `packages/core/src/__tests__/contracts/portal.contract.test.ts` — add test that `PortalBlockTypeSchema` accepts `"vega"`; verify `PINNABLE_BLOCK_TYPES` contains `"vega"`

### 1.2 Database Migration

**File:** `apps/api/src/db/schema/portal-results.table.ts` — add `"vega"` to `portalResultTypeEnum`

Then: `cd apps/api && npm run db:generate && npm run db:migrate` (determine a descriptive migration name)

Type-checks in `apps/api/src/db/schema/type-checks.ts` enforce sync at compile time.

#### Tests to write:
- [x] No unit tests needed — compile-time type assertions cover schema sync. Verified by `npm run build`.

### 1.3 Tool Definition & Service Method

**Files:**
- `apps/api/src/services/analytics.tools.ts` — add `visualize_tree` tool in the `data_query` pack section
- `apps/api/src/services/analytics.service.ts` — add `visualizeVega()` static method (runs SQL, injects `data[0].values`)

#### Tests to write:
- [x] `apps/api/src/__tests__/services/analytics.tools.test.ts` — test `visualize_tree` is registered when `data_query` pack enabled; test it is NOT registered when pack disabled; add to shadow-conflict set
- [x] `apps/api/src/__tests__/services/analytics.service.test.ts` — test `visualizeVega()` injects query rows into `data[0].values`; test it handles specs with no existing `data` array; test it handles specs with existing `data` entries (preserves non-first entries)

### 1.4 Stream Detection (API)

**File:** `apps/api/src/services/portal.service.ts` (~line 343-376) — add `isVega` check between `isVegaLite` and `ROW_SET_TOOLS` branches:
```
isVega = toolName === "visualize_tree" || (toolResult?.type === "vega")
```
Push `{ type: "vega", content: toolResult }` to `assistantBlocks`.

Also update the `reconstructModelMessages` comment at line 483 to include `"vega"` in the display-only blocks list.

#### Tests to write:
- [x] `apps/api/src/__tests__/services/portal.service.test.ts` — test `streamResponse` sends `tool_result` SSE for `visualize_tree` tool; test it sends `tool_result` SSE when webhook returns `type: "vega"`; test persisted assistant message includes `vega` display block

### 1.5 SSE Event Handler (Frontend)

**File:** `apps/web/src/components/PortalSession.component.tsx` (~line 196-220) — add `isVega` check after `isVegaLite`:
```typescript
const isVega = result != null && typeof result === "object" &&
  (data.toolName === "visualize_tree" || result["type"] === "vega");
```

#### Tests to write:
- [x] `apps/web/src/__tests__/PortalSession.test.tsx` — test streaming blocks include vega block when `tool_result` event has `toolName: "visualize_tree"`; test streaming blocks include vega block when result has `type: "vega"`

### 1.6 Content Renderer

**File:** `packages/core/src/ui/ContentBlockRenderer.tsx` — add lazy-loaded `Vega` component (from `react-vega`) and render branch for `block.type === "vega"` between the vega-lite and data-table branches.

```typescript
const LazyVega = React.lazy(() =>
  import("react-vega").then((mod) => ({ default: mod.Vega }))
);
```

#### Tests to write:
- [x] `packages/core/src/__tests__/ui/ContentBlockRenderer.test.tsx` — mock `react-vega` to also export `Vega` component; test renders vega block with lazy loading (similar to existing vega-lite test pattern)

### 1.7 Pin Content Extraction

**File:** `apps/api/src/routes/portal-results.router.ts` — no change needed. The existing fallback at line 162 (`typeof block.content === "object"`) handles `vega` blocks correctly (stores the full Vega spec as-is).

#### Tests to write:
- [x] No new tests needed — existing pin extraction logic covers object content blocks generically.

### Phase 1 Verification

Run each step sequentially. All must pass before proceeding to Phase 2.

#### Step 1 — Tests
```bash
npm run test
```
- [x] All existing tests still pass (no regressions)
- [x] New `portal-result.model.test.ts` tests pass — `"vega"` type accepted
- [x] New `portal.contract.test.ts` tests pass — `PortalBlockTypeSchema` accepts `"vega"`, `PINNABLE_BLOCK_TYPES` contains `"vega"`
- [x] New `analytics.tools.test.ts` tests pass — `visualize_tree` registered/gated by `data_query` pack
- [x] New `analytics.service.test.ts` tests pass — `visualizeVega()` injects rows into spec
- [x] New `portal.service.test.ts` tests pass — `streamResponse` sends `tool_result` SSE for vega blocks
- [x] New `PortalSession.test.tsx` tests pass — streaming blocks include vega block
- [x] New `ContentBlockRenderer.test.tsx` tests pass — renders vega block with lazy `Vega` component

#### Step 2 — Lint
```bash
npm run lint
```
- [x] Zero lint errors across all modified files
- [x] No new warnings introduced

#### Step 3 — Build
```bash
npm run build
```
- [x] TypeScript compilation succeeds across all packages
- [x] Dual-schema type assertions pass (`type-checks.ts` — `PortalResultSelect` ↔ `PortalResult` with `"vega"`)
- [x] Vite bundle builds successfully (no missing imports)

---

## Phase 2 — D3 Tree Support

### 2.1 Install Dependency

```bash
cd packages/core && npm install react-d3-tree
```

### 2.2 Schema & Contract Updates

**Files:**
- `packages/core/src/models/portal-result.model.ts` — add `"d3-tree"` to `PortalResultTypeSchema`
- `packages/core/src/contracts/portal.contract.ts` — add `"d3-tree"` to `PortalBlockTypeSchema`; add `D3TreeNodeSchema` and `D3TreeContentBlockSchema` Zod schemas

#### Tests to write:
- [x] `packages/core/src/__tests__/models/portal-result.model.test.ts` — add `"d3-tree"` to "accepts all valid types" test; add dedicated `it("should accept d3-tree type")`
- [x] `packages/core/src/__tests__/contracts/portal.contract.test.ts` — test `PortalBlockTypeSchema` accepts `"d3-tree"`; test `PINNABLE_BLOCK_TYPES` contains `"d3-tree"`; test `D3TreeNodeSchema` accepts valid tree data; test it rejects missing `name`; test it accepts nested children recursively; test `D3TreeContentBlockSchema` validates correctly

### 2.3 Database Migration

**File:** `apps/api/src/db/schema/portal-results.table.ts` — add `"d3-tree"` to `portalResultTypeEnum`

Then: `cd apps/api && npm run db:generate && npm run db:migrate`

#### Tests to write:
- [x] No unit tests — compile-time type assertions cover this. Verified by `npm run build`.

### 2.4 Tool Definition & Service Method

**Files:**
- `apps/api/src/services/analytics.tools.ts` — add `build_tree` tool in the `data_query` pack
- `apps/api/src/services/analytics.service.ts` — add `buildTree()` static method (flat→nested conversion from parent-child SQL rows)

#### Tests to write:
- [ ] `apps/api/src/__tests__/services/analytics.tools.test.ts` — test `build_tree` is registered when `data_query` pack enabled; test it is NOT registered when pack disabled; add to shadow-conflict set
- [ ] `apps/api/src/__tests__/services/analytics.service.test.ts` — test `buildTree()` converts flat rows to nested tree; test single root returns that root directly; test multiple roots wraps in synthetic "Root" node; test `attributeColumns` are extracted correctly; test `labelColumn` is used for node names; test empty rows returns a root with no children

### 2.5 Stream Detection (API)

**File:** `apps/api/src/services/portal.service.ts` — add `isD3Tree` check after `isVega`:
```
isD3Tree = toolName === "build_tree" || (toolResult?.type === "d3-tree")
```
Push `{ type: "d3-tree", content: toolResult.tree ?? toolResult }`.

#### Tests to write:
- [ ] `apps/api/src/__tests__/services/portal.service.test.ts` — test `streamResponse` sends `tool_result` SSE for `build_tree` tool; test persisted assistant message includes `d3-tree` display block; test it extracts `.tree` from the result when present

### 2.6 SSE Event Handler (Frontend)

**File:** `apps/web/src/components/PortalSession.component.tsx` — add `isD3Tree` branch:
```typescript
} else if (result && typeof result === "object" &&
  (data.toolName === "build_tree" || result["type"] === "d3-tree")) {
  block = { type: "d3-tree", content: result };
}
```

#### Tests to write:
- [ ] `apps/web/src/__tests__/PortalSession.test.tsx` — test streaming blocks include d3-tree block when `tool_result` event has `toolName: "build_tree"`

### 2.7 Content Renderer

**Files:**
- `packages/core/src/ui/D3TreeBlock.tsx` — **new file** with `D3TreeBlock` component (react-d3-tree wrapper with vertical orientation, step path, collapsible, zoomable)
- `packages/core/src/ui/ContentBlockRenderer.tsx` — add lazy-loaded `D3TreeBlock` and render branch for `block.type === "d3-tree"`

#### Tests to write:
- [ ] `packages/core/src/__tests__/ui/D3TreeBlock.test.tsx` — **new file**: test renders a tree container; test passes data prop to react-d3-tree; test renders with correct dimensions (500px height)
- [ ] `packages/core/src/__tests__/ui/ContentBlockRenderer.test.tsx` — mock `./D3TreeBlock`; test renders d3-tree block with lazy loading

### 2.8 Pin Content Extraction

No change needed — existing object fallback handles `d3-tree` blocks.

#### Tests to write:
- [ ] No new tests needed.

### Phase 2 Verification

Run each step sequentially. All must pass before considering the feature complete.

#### Step 1 — Tests
```bash
npm run test
```
- [ ] All Phase 1 tests still pass (no regressions from Phase 2 changes)
- [ ] New `portal-result.model.test.ts` tests pass — `"d3-tree"` type accepted
- [ ] New `portal.contract.test.ts` tests pass — `PortalBlockTypeSchema` accepts `"d3-tree"`, `PINNABLE_BLOCK_TYPES` contains `"d3-tree"`, `D3TreeNodeSchema` validates tree data correctly, rejects missing `name`, accepts nested children
- [ ] New `analytics.tools.test.ts` tests pass — `build_tree` registered/gated by `data_query` pack
- [ ] New `analytics.service.test.ts` tests pass — `buildTree()` flat→nested conversion, single root, multiple roots, attributeColumns, labelColumn, empty rows
- [ ] New `portal.service.test.ts` tests pass — `streamResponse` sends `tool_result` SSE for d3-tree blocks, extracts `.tree` from result
- [ ] New `PortalSession.test.tsx` tests pass — streaming blocks include d3-tree block
- [ ] New `D3TreeBlock.test.tsx` tests pass — renders tree container, passes data prop, correct dimensions
- [ ] New `ContentBlockRenderer.test.tsx` tests pass — renders d3-tree block with lazy `D3TreeBlock` component

#### Step 2 — Lint
```bash
npm run lint
```
- [ ] Zero lint errors across all modified and new files
- [ ] No new warnings introduced
- [ ] New `D3TreeBlock.tsx` passes lint

#### Step 3 — Build
```bash
npm run build
```
- [ ] TypeScript compilation succeeds across all packages
- [ ] Dual-schema type assertions pass (`type-checks.ts` — `PortalResultSelect` ↔ `PortalResult` with `"d3-tree"`)
- [ ] `react-d3-tree` dependency resolves correctly in bundle
- [ ] Vite bundle builds successfully (lazy imports for `D3TreeBlock` resolve)

---

## Critical Files Summary

| File | Phase |
|------|-------|
| `packages/core/src/models/portal-result.model.ts` | 1, 2 |
| `packages/core/src/contracts/portal.contract.ts` | 1, 2 |
| `packages/core/src/ui/ContentBlockRenderer.tsx` | 1, 2 |
| `packages/core/src/ui/D3TreeBlock.tsx` | 2 (new) |
| `apps/api/src/db/schema/portal-results.table.ts` | 1, 2 |
| `apps/api/src/services/analytics.tools.ts` | 1, 2 |
| `apps/api/src/services/analytics.service.ts` | 1, 2 |
| `apps/api/src/services/portal.service.ts` | 1, 2 |
| `apps/web/src/components/PortalSession.component.tsx` | 1, 2 |

## Existing Patterns to Reuse

- **Model test pattern**: `StubIDFactory` + `buildCoreModelFactory()` from `packages/core/src/__tests__/test-utils.ts`
- **Service mock pattern**: `jest.unstable_mockModule()` with dynamic imports from `apps/api/src/__tests__/services/portal.service.test.ts`
- **Tool registration tests**: Pack gating pattern from `apps/api/src/__tests__/services/analytics.tools.test.ts`
- **Stream test helpers**: `makeStream()`, `makeSse()` from `apps/api/src/__tests__/services/portal.service.test.ts`
- **Component lazy-load test**: Mock + Suspense pattern from `packages/core/src/__tests__/ui/ContentBlockRenderer.test.tsx`
- **SSE event test**: EventSource mock pattern from `apps/web/src/__tests__/PortalSession.test.tsx`

## Final Verification (both phases complete)

Run the full suite one final time to confirm end-to-end integrity.

#### Step 1 — Tests
```bash
npm run test
```
- [ ] All unit tests pass across `packages/core`, `apps/api`, and `apps/web`
- [ ] No skipped or pending tests related to this feature
- [ ] All new test cases (Phase 1 + Phase 2) are green

#### Step 2 — Lint
```bash
npm run lint
```
- [ ] Zero lint errors monorepo-wide
- [ ] No new warnings in any modified or new files

#### Step 3 — Build
```bash
npm run build
```
- [ ] Full monorepo build succeeds (all three packages)
- [ ] Dual-schema type assertions pass for both `"vega"` and `"d3-tree"` enum values
- [ ] No missing module or unresolved import errors
- [ ] Lazy-loaded chunks for `Vega`, `VegaLite`, and `D3TreeBlock` are emitted correctly
