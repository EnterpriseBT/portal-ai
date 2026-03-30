# Extra Diagram Support: Full Vega & D3

## Goal

Extend the portal visualization pipeline to support **full Vega** specs (tree layouts, network graphs, geographic maps, force-directed diagrams) and **D3-based** custom visualizations (react-d3-tree for hierarchies, custom SVG renderers). Vega-Lite remains the default for statistical charts; the new types cover everything it cannot.

---

## Current State

| Layer | File | What exists |
|-------|------|-------------|
| **Core model** | `packages/core/src/models/portal-result.model.ts` | `PortalResultTypeSchema = z.enum(["text", "vega-lite", "data-table"])` |
| **Contracts** | `packages/core/src/contracts/portal.contract.ts` | `PortalBlockTypeSchema` (adds `tool-call`, `tool-result`), `PINNABLE_BLOCK_TYPES` derived from model enum |
| **DB enum** | `apps/api/src/db/schema/portal-results.table.ts` | `portalResultTypeEnum` mirrors model enum |
| **Stream detection** | `apps/api/src/services/portal.service.ts:343-376` | Checks `toolName === "visualize"` or `result.type === "vega-lite"`, else checks `ROW_SET_TOOLS` for data-table |
| **Tool definition** | `apps/api/src/services/analytics.tools.ts` | `visualize` tool — takes SQL + partial Vega-Lite spec, injects `data.values` |
| **Pin extraction** | `apps/api/src/routes/portal-results.router.ts:158-168` | Branches on `data-table` (columns/rows) vs generic `block.content` |
| **SSE handler** | `apps/web/src/components/PortalSession.component.tsx:196-220` | Detects `vega-lite` and `data-table` from `tool_result` events |
| **Renderer** | `packages/core/src/ui/ContentBlockRenderer.tsx` | Lazy-loads `react-vega`'s `VegaLite`, renders `DataTableBlock`, or `ReactMarkdown` for text |
| **Dependencies** | `packages/core/package.json` | `react-vega@^7.6.0`, `vega@^5.30.0`, `vega-lite@^5.21.0` |

---

## New Block Types

| Type key | Rendering library | Use cases |
|----------|-------------------|-----------|
| `"vega"` | `react-vega` → `Vega` component (already installed via `react-vega`) | Tree layouts, force-directed graphs, geographic maps, Voronoi diagrams, sunbursts — anything requiring Vega transforms (`stratify`, `tree`, `force`, `treemap`) |
| `"d3-tree"` | `react-d3-tree` (new dependency) | Interactive, collapsible hierarchy trees with pan/zoom — best UX for org charts, file trees, entity relationship exploration |

---

## Implementation Plan

### Phase 1 — Full Vega Support

Full Vega is the lowest-effort addition because `react-vega` already ships both `VegaLite` and `Vega` components, and the `vega` runtime is already a dependency.

#### 1.1 Schema & Contract Updates

**`packages/core/src/models/portal-result.model.ts`**
```typescript
export const PortalResultTypeSchema = z.enum([
  "text",
  "vega-lite",
  "vega",          // ← new
  "data-table",
]);
```

**`packages/core/src/contracts/portal.contract.ts`**
```typescript
export const PortalBlockTypeSchema = z.enum([
  "text",
  "vega-lite",
  "vega",          // ← new
  "data-table",
  "tool-call",
  "tool-result",
]);
```

`PINNABLE_BLOCK_TYPES` auto-updates — no change needed.

#### 1.2 Database Migration

**`apps/api/src/db/schema/portal-results.table.ts`**
```typescript
export const portalResultTypeEnum = pgEnum("portal_result_type", [
  "text",
  "vega-lite",
  "vega",          // ← new
  "data-table",
]);
```

Then run:
```bash
cd apps/api && npm run db:generate && npm run db:migrate
```

Type-checks in `type-checks.ts` enforce sync automatically.

#### 1.3 Tool Definition

**`apps/api/src/services/analytics.tools.ts`** — add a new `visualize_tree` tool (or rename to be more general):

```typescript
tools.visualize_tree = tool({
  description:
    "Build a full Vega spec for hierarchical or network visualizations " +
    "(trees, treemaps, sunbursts, force-directed graphs). " +
    "Use this instead of visualize when the chart requires Vega transforms " +
    "like stratify, tree, force, or treemap.",
  inputSchema: z.object({
    sql: z.string().describe("SQL query to fetch node/link data"),
    vegaSpec: z
      .record(z.string(), z.unknown())
      .describe("Full Vega spec — data[0].values will be overwritten with query results"),
  }),
  execute: async ({ sql, vegaSpec }) =>
    AnalyticsService.visualizeVega({ sql, vegaSpec, stationId }),
});
```

**`apps/api/src/services/analytics.service.ts`** — add a service method:

```typescript
static visualizeVega(params: {
  sql: string;
  vegaSpec: Record<string, unknown>;
  stationId: string;
}): Record<string, unknown> {
  const { sql, vegaSpec, stationId } = params;
  const rows = this.sqlQuery({ sql, stationId });
  const data = Array.isArray(vegaSpec.data) ? [...vegaSpec.data] : [{}];
  data[0] = { ...data[0], values: rows };
  return { ...vegaSpec, data };
}
```

#### 1.4 Stream Detection

**`apps/api/src/services/portal.service.ts`** — add an `else if` branch after the vega-lite check:

```typescript
const isVega =
  toolName === "visualize_tree" ||
  (toolResult != null && toolResult.type === "vega");

if (isVegaLite) {
  // ... existing vega-lite logic ...
} else if (isVega) {
  const event: ToolResultEvent = {
    type: "tool_result",
    toolName,
    result: toolResult,
  };
  sse.send("tool_result", event);
  assistantBlocks.push({ type: "vega", content: toolResult });
} else if (ROW_SET_TOOLS.has(toolName)) {
  // ... existing data-table logic ...
}
```

#### 1.5 SSE Event Handler (Frontend)

**`apps/web/src/components/PortalSession.component.tsx`** — extend the `tool_result` listener:

```typescript
const isVega =
  result != null &&
  typeof result === "object" &&
  (data.toolName === "visualize_tree" || result["type"] === "vega");

if (isVegaLite) {
  block = { type: "vega-lite", content: result };
} else if (isVega) {
  block = { type: "vega", content: result };
} else if (/* data-table check */) {
  block = { type: "data-table", content: result };
}
```

#### 1.6 Content Renderer

**`packages/core/src/ui/ContentBlockRenderer.tsx`**:

```typescript
const LazyVega = React.lazy(() =>
  import("react-vega").then((mod) => ({ default: mod.Vega }))
);

// Inside the component:
if (block.type === "vega") {
  return (
    <Suspense fallback={null}>
      <LazyVega spec={block.content as object} />
    </Suspense>
  );
}
```

No new dependencies needed — `react-vega` already exports `Vega`.

#### 1.7 Pin Content Extraction

**`apps/api/src/routes/portal-results.router.ts`** — the existing fallback (`typeof block.content === "object"`) already handles `vega` blocks correctly. No change needed; the content (full Vega spec) is stored as-is.

---

### Phase 2 — D3 Tree Support

D3 trees provide a better interactive UX for hierarchies (collapsible nodes, pan/zoom, search). This requires a new frontend dependency and a structured data format.

#### 2.1 Install Dependency

```bash
cd packages/core && npm install react-d3-tree
```

#### 2.2 Schema & Contract Updates

**`packages/core/src/models/portal-result.model.ts`**
```typescript
export const PortalResultTypeSchema = z.enum([
  "text",
  "vega-lite",
  "vega",
  "d3-tree",       // ← new
  "data-table",
]);
```

Update `PortalBlockTypeSchema` and `portalResultTypeEnum` the same way. Run migration.

#### 2.3 Data Contract

Define the expected shape in `packages/core/src/contracts/portal.contract.ts`:

```typescript
export const D3TreeNodeSchema: z.ZodType<D3TreeNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    attributes: z.record(z.string(), z.unknown()).optional(),
    children: z.array(D3TreeNodeSchema).optional(),
  })
);

export const D3TreeContentBlockSchema = z.object({
  type: z.literal("d3-tree"),
  content: D3TreeNodeSchema,
});

interface D3TreeNode {
  name: string;
  attributes?: Record<string, unknown>;
  children?: D3TreeNode[];
}
```

#### 2.4 Tool Definition

**`apps/api/src/services/analytics.tools.ts`**:

```typescript
tools.build_tree = tool({
  description:
    "Build an interactive tree diagram from flat parent-child data. " +
    "Returns a nested hierarchy for rendering as a collapsible tree.",
  inputSchema: z.object({
    sql: z.string().describe("SQL returning rows with at least `id`, `parentId`, and `name` columns"),
    labelColumn: z.string().describe("Column to use as node labels").default("name"),
    attributeColumns: z.array(z.string()).describe("Extra columns to display on each node").optional(),
  }),
  execute: async ({ sql, labelColumn, attributeColumns }) =>
    AnalyticsService.buildTree({ sql, labelColumn, attributeColumns, stationId }),
});
```

**`apps/api/src/services/analytics.service.ts`**:

```typescript
static buildTree(params: {
  sql: string;
  labelColumn: string;
  attributeColumns?: string[];
  stationId: string;
}): { type: "d3-tree"; tree: D3TreeNode } {
  const { sql, labelColumn, attributeColumns, stationId } = params;
  const rows = this.sqlQuery({ sql, stationId });

  // Build lookup map
  const nodeMap = new Map<string, D3TreeNode>();
  for (const row of rows) {
    const id = String(row.id);
    const attrs = attributeColumns
      ? Object.fromEntries(attributeColumns.map((c) => [c, row[c]]))
      : undefined;
    nodeMap.set(id, { name: String(row[labelColumn]), attributes: attrs, children: [] });
  }

  // Link children to parents, collect roots
  let roots: D3TreeNode[] = [];
  for (const row of rows) {
    const node = nodeMap.get(String(row.id))!;
    const parentId = row.parentId != null ? String(row.parentId) : null;
    if (parentId && nodeMap.has(parentId)) {
      nodeMap.get(parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }

  // If exactly one root, return it; otherwise wrap in a synthetic root
  const tree = roots.length === 1 ? roots[0] : { name: "Root", children: roots };
  return { type: "d3-tree", tree };
}
```

#### 2.5 Stream Detection

**`apps/api/src/services/portal.service.ts`**:

```typescript
const isD3Tree =
  toolName === "build_tree" ||
  (toolResult != null && toolResult.type === "d3-tree");

// Add after the isVega branch:
} else if (isD3Tree) {
  const event: ToolResultEvent = { type: "tool_result", toolName, result: toolResult };
  sse.send("tool_result", event);
  assistantBlocks.push({ type: "d3-tree", content: toolResult.tree ?? toolResult });
}
```

#### 2.6 SSE Event Handler

**`apps/web/src/components/PortalSession.component.tsx`**:

```typescript
} else if (result && typeof result === "object" && result["type"] === "d3-tree") {
  block = { type: "d3-tree", content: result };
}
```

#### 2.7 Content Renderer

**`packages/core/src/ui/D3TreeBlock.tsx`** — new component:

```tsx
import React, { useMemo } from "react";
import Tree from "react-d3-tree";
import { Box } from "@mui/material";

interface D3TreeBlockProps {
  data: object;
}

export const D3TreeBlock: React.FC<D3TreeBlockProps> = ({ data }) => {
  const treeData = useMemo(() => data, [data]);

  return (
    <Box sx={{ width: "100%", height: 500, "& svg": { width: "100%" } }}>
      <Tree
        data={treeData}
        orientation="vertical"
        pathFunc="step"
        translate={{ x: 300, y: 40 }}
        separation={{ siblings: 1.5, nonSiblings: 2 }}
        collapsible
        zoomable
      />
    </Box>
  );
};
```

**`packages/core/src/ui/ContentBlockRenderer.tsx`**:

```typescript
const LazyD3Tree = React.lazy(() =>
  import("./D3TreeBlock").then((mod) => ({ default: mod.D3TreeBlock }))
);

// Inside the component:
if (block.type === "d3-tree") {
  return (
    <Suspense fallback={null}>
      <LazyD3Tree data={block.content as object} />
    </Suspense>
  );
}
```

#### 2.8 Pin Content Extraction

**`apps/api/src/routes/portal-results.router.ts`** — the existing `typeof block.content === "object"` fallback handles this. No change needed unless a custom shape is desired.

---

## File Change Summary

| File | Phase 1 (Vega) | Phase 2 (D3) |
|------|:-:|:-:|
| `packages/core/src/models/portal-result.model.ts` | modify | modify |
| `packages/core/src/contracts/portal.contract.ts` | modify | modify |
| `apps/api/src/db/schema/portal-results.table.ts` | modify + migrate | modify + migrate |
| `apps/api/src/services/analytics.tools.ts` | modify | modify |
| `apps/api/src/services/analytics.service.ts` | modify | modify |
| `apps/api/src/services/portal.service.ts` | modify | modify |
| `apps/web/src/components/PortalSession.component.tsx` | modify | modify |
| `packages/core/src/ui/ContentBlockRenderer.tsx` | modify | modify |
| `packages/core/src/ui/D3TreeBlock.tsx` | — | **new file** |
| `packages/core/package.json` | — | add `react-d3-tree` |

---

## Risks & Considerations

| Risk | Mitigation |
|------|------------|
| **Full Vega specs are complex** — LLMs may produce invalid specs | Add server-side validation via `vega`'s `parse()` before persisting; return a clear error to the model so it can self-correct |
| **Bundle size** — `vega` is already bundled (peer dep of `react-vega`), so no new weight for Phase 1. `react-d3-tree` adds ~45 KB gzipped | Lazy-load both renderers behind `React.lazy` + `Suspense` |
| **D3 tree data shape** — LLM must produce correct parent-child SQL | The `build_tree` tool handles the flat→nested conversion server-side; the LLM only writes SQL |
| **Vega-Lite vs Vega tool selection** — model may pick the wrong one | Provide clear tool descriptions; the `visualize` tool description should explicitly say "for statistical charts only" while `visualize_tree` says "for trees, networks, hierarchies" |
| **Pin content size** — full Vega specs or large trees may be heavy | The existing JSONB content column handles this, but consider adding a size guard on the pin route |
| **SSE detection ordering** — `vega` must be checked after `vega-lite` | Use explicit `result.type` checks rather than substring matching; check `isVegaLite` first |

---

## Recommended Execution Order

1. **Phase 1 first** — zero new dependencies, unlocks trees/networks/maps via Vega transforms
2. **Validate with real prompts** — test tree layout specs against the LLM to gauge reliability
3. **Phase 2 if needed** — only if Vega tree UX (static SVG) is insufficient and interactive collapse/zoom is required
