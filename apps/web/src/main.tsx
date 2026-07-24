import { createRoot } from "react-dom/client";
import { Application } from "./Application";

import { registerD3BlockRenderer } from "./modules/D3Widget";

import "@portalai/core/styles";

// Block-renderer registrations must precede the first render so persisted
// and streamed `d3` blocks dispatch from the start (#268).
registerD3BlockRenderer();

createRoot(document.getElementById("root")!).render(<Application />);
