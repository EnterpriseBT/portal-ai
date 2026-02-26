import { createRoot } from "react-dom/client";
import { Application } from "./Application";

import "@mcp-ui/core/styles";

createRoot(document.getElementById("root")!).render(<Application />);
