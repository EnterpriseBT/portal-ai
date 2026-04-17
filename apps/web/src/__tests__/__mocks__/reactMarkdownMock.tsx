import React from "react";

// Lightweight stub used by Jest to sidestep react-markdown's ESM export.
// Renders children as plain text so smoke tests don't crash when any component
// pulls @portalai/core/ui (which transitively imports react-markdown).
const ReactMarkdown: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <div>{children}</div>
);

export default ReactMarkdown;
