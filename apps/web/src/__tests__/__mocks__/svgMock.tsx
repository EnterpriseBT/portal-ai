import React from "react";

// Mock SVG imports as React components for Jest
const SvgMock = React.forwardRef<SVGSVGElement>((props, ref) => {
  return React.createElement("svg", { ...props, ref });
});

SvgMock.displayName = "SvgMock";

export default SvgMock;
export const ReactComponent = SvgMock;
