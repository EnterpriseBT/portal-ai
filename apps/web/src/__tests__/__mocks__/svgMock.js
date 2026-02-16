import React from "react";

// Mock SVG imports as React components for Jest
const SvgMock = React.forwardRef((props, ref) => {
  return React.createElement("svg", { ...props, ref });
});

SvgMock.displayName = "SvgMock";

export default SvgMock;
