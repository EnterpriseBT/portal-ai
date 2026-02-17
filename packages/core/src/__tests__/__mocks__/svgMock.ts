import React from "react";

// Mock SVG imports as React components for Jest (ESM-compatible)
const SvgMock = React.forwardRef<SVGSVGElement>(
  (props: Record<string, unknown>, ref: React.Ref<SVGSVGElement>) => {
    return React.createElement("svg", { ...props, ref });
  }
);

SvgMock.displayName = "SvgMock";

export default SvgMock;
