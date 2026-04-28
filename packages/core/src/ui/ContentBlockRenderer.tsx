import React, { Component, Suspense } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type {
  PortalMessageBlock,
  MutationResultContentBlock,
} from "../contracts/portal.contract.js";
import { DataTableBlock } from "./DataTableBlock.js";
import { MutationResultBlock } from "./MutationResultBlock.js";

const LazyVegaLite = React.lazy(() =>
  import("react-vega").then((mod) => ({ default: mod.VegaLite }))
);

const LazyVega = React.lazy(() =>
  import("react-vega").then((mod) => ({ default: mod.Vega }))
);

// ── Vega spec helpers ──────────────────────────────────────────────
type Obj = Record<string, unknown>;

/**
 * When `data[0]` derives from a named `source` that doesn't exist in the data
 * array, create that base dataset from `data[0].values`.
 */
function ensureBaseDataset(data: Obj[]): Obj[] {
  const first = data[0];
  const sourceName = typeof first?.source === "string" ? first.source : null;
  if (!sourceName) return data;
  if (data.some((d) => d.name === sourceName)) return data;
  if (!Array.isArray(first.values)) return data;

  const { values, ...rest } = first;
  return [{ name: sourceName, values }, rest, ...data.slice(1)];
}

/**
 * Fix a common broken pattern in AI-generated Vega force-directed specs:
 *
 * The AI places a force transform in a *data source* (e.g. `{ name: "force",
 * source: "node-data", transform: [{ type: "force", … }] }`), then a mark
 * reads from that data source, and the linkpath mark references
 * `require: { signal: "force" }`. This doesn't work because "force" is a data
 * source name, not a signal.
 *
 * The fix converts the spec to the correct "Pattern B" layout:
 * 1. Remove data sources whose only purpose is a force transform.
 * 2. Ensure the nodes mark reads from the original node data and carries the
 *    force transform (with `signal` set so the linkpath `require` resolves).
 * 3. Add `id` to link forces that don't specify one (needed when source/target
 *    in link data are string IDs rather than array indices).
 */
function fixForceLayout(
  data: Obj[],
  marks: Obj[]
): { data: Obj[]; marks: Obj[] } {
  // Find data sources whose transforms include a force transform.
  const forceDataIndices: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const transforms = data[i].transform as Obj[] | undefined;
    if (transforms?.some((t) => t.type === "force")) {
      forceDataIndices.push(i);
    }
  }
  if (forceDataIndices.length === 0) return { data, marks };

  const removedDataNames = new Set<string>();

  for (const idx of forceDataIndices) {
    const ds = data[idx];
    const dsName = ds.name as string;
    const dsSource = ds.source as string | undefined;
    const dsForce = (ds.transform as Obj[]).find((t) => t.type === "force")!;

    // Find any mark that reads from this force data source.
    const mark = marks.find((m) => {
      const from = m.from as Obj | undefined;
      return from?.data === dsName;
    });

    if (mark && dsSource) {
      // Point the mark at the original node data instead.
      (mark.from as Obj).data = dsSource;

      // Ensure the mark carries a force transform with a signal name.
      const markTransforms = ((mark.transform ?? []) as Obj[]).slice();
      const existingForce = markTransforms.find((t) => t.type === "force");

      if (existingForce) {
        // Patch in the signal name if missing.
        if (!existingForce.signal) existingForce.signal = dsName;
      } else {
        markTransforms.push({ ...dsForce, signal: dsName });
      }
      mark.transform = markTransforms;
    }

    removedDataNames.add(dsName);
  }

  // Add `id` to any link forces that don't specify one. Without `id`, Vega
  // resolves source/target as array indices, which fails when the link data
  // uses string IDs.
  for (const mark of marks) {
    for (const t of (mark.transform ?? []) as Obj[]) {
      if (t.type !== "force" || !Array.isArray(t.forces)) continue;
      for (const f of t.forces as Obj[]) {
        if (f.force === "link" && !f.id) {
          f.id = "datum.id";
        }
      }
    }
  }

  // Remove the force-only data sources.
  const filteredData = data.filter(
    (d) => !removedDataNames.has(d.name as string)
  );

  return { data: filteredData, marks };
}

/**
 * Fix empty-string parent values in datasets that use a `stratify` transform.
 *
 * Vega's stratify transform treats an empty string as a real parent reference
 * and looks for a node whose id is `""`. When root nodes use `parent: ""`
 * instead of `null`, the stratify fails silently and nothing renders.
 * This converts empty-string values in the `parentKey` field to `null`.
 */
function fixStratifyRoots(data: Obj[]): Obj[] {
  for (const ds of data) {
    const transforms = ds.transform as Obj[] | undefined;
    if (!transforms) continue;

    for (const t of transforms) {
      if (t.type !== "stratify") continue;

      const parentKey = (t.parentKey as string) ?? "parent";
      const values = ds.values as Obj[] | undefined;
      if (!Array.isArray(values)) continue;

      for (const row of values) {
        if (row[parentKey] === "" || row[parentKey] === undefined) {
          row[parentKey] = null;
        }
      }
    }
  }
  return data;
}

/**
 * Normalise a Vega spec so that common AI-generated issues are repaired before
 * the spec is handed to the Vega renderer.
 */
function normalizeVegaSpec(spec: Obj): Obj {
  if (!Array.isArray(spec.data) || spec.data.length === 0) return spec;

  let data = JSON.parse(JSON.stringify(spec.data)) as Obj[];
  let marks = Array.isArray(spec.marks)
    ? (JSON.parse(JSON.stringify(spec.marks)) as Obj[])
    : [];

  // 1. Ensure the base data source exists.
  data = ensureBaseDataset(data);

  // 2. Fix empty-string parent keys for stratify transforms.
  data = fixStratifyRoots(data);

  // 3. Fix broken force-directed layout patterns.
  if (marks.length > 0) {
    ({ data, marks } = fixForceLayout(data, marks));
    return { ...spec, data, marks };
  }

  return { ...spec, data };
}

// ── Error boundary for Vega/VegaLite render failures ─────────────────

interface VegaErrorBoundaryState {
  error: Error | null;
}

class VegaErrorBoundary extends Component<
  { children: React.ReactNode },
  VegaErrorBoundaryState
> {
  state: VegaErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): VegaErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ color: "#b00", fontFamily: "monospace", padding: 8 }}>
          Visualization failed to render: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

export interface ContentBlockRendererProps {
  block: PortalMessageBlock;
}

export const ContentBlockRenderer: React.FC<ContentBlockRendererProps> = ({
  block,
}) => {
  if (block.type === "text") {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {String(block.content ?? "")}
      </ReactMarkdown>
    );
  }

  if (block.type === "vega-lite") {
    return (
      <VegaErrorBoundary>
        <Suspense fallback={null}>
          <LazyVegaLite spec={block.content as object} />
        </Suspense>
      </VegaErrorBoundary>
    );
  }

  if (block.type === "vega") {
    const spec = normalizeVegaSpec(block.content as Record<string, unknown>);
    return (
      <VegaErrorBoundary>
        <Suspense fallback={null}>
          <LazyVega spec={spec} />
        </Suspense>
      </VegaErrorBoundary>
    );
  }

  if (block.type === "data-table") {
    const raw = (block.content ?? {}) as {
      columns?: string[];
      rows?: Record<string, unknown>[];
    };
    const columns = raw.columns ?? [];
    const rows = raw.rows ?? [];
    return <DataTableBlock columns={columns} rows={rows} />;
  }

  if (block.type === "mutation-result") {
    return (
      <MutationResultBlock
        content={block.content as MutationResultContentBlock}
      />
    );
  }

  return null;
};
