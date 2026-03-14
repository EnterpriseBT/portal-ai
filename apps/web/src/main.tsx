import { createRoot } from "react-dom/client";
import { Application } from "./Application";

import "@portalai/core/styles";

createRoot(document.getElementById("root")!).render(<Application />);
