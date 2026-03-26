import React, { Suspense } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { PortalMessageBlock } from "../contracts/portal.contract.js";
import { DataTableBlock } from "./DataTableBlock.js";

const LazyVegaLite = React.lazy(() =>
  import("react-vega").then((mod) => ({ default: mod.VegaLite }))
);

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
      <Suspense fallback={null}>
        <LazyVegaLite spec={block.content as object} />
      </Suspense>
    );
  }

  if (block.type === "data-table") {
    const content = block.content as {
      columns?: string[];
      rows?: Record<string, unknown>[];
    } | null;
    const columns = content?.columns ?? [];
    const rows = content?.rows ?? [];
    return <DataTableBlock columns={columns} rows={rows} />;
  }

  return null;
};
