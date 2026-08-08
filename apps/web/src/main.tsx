import { createRoot } from "react-dom/client";
import { Application } from "./Application";

import { registerD3BlockRenderer } from "./modules/D3Widget";
import { registerMapBlockRenderer } from "./modules/MapWidget";

import "@portalai/core/styles";

// Block-renderer registrations must precede the first render so persisted
// and streamed `d3` / `geo` blocks dispatch from the start (#268, #314).
registerD3BlockRenderer();
registerMapBlockRenderer();

createRoot(document.getElementById("root")!).render(<Application />);
