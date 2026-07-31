import { render, screen } from "./test-utils";

import { ToolActivityStrip } from "../components/ToolActivityStrip.component";

// #279 — the pinned counterpart to the inline indicator, so the phase stays
// visible when the user has scrolled away from the bottom of the feed. This
// component owns no positioning: the overlay placement is the ChatWindow
// slot's job, which is what keeps it out of the composer's layout.

describe("ToolActivityStrip", () => {
  it("renders the phase label and elapsed seconds", () => {
    render(
      <ToolActivityStrip label="Building the chart" elapsedSeconds={12} />
    );
    expect(screen.getByText("Building the chart")).toBeInTheDocument();
    expect(screen.getByTestId("tool-activity-strip-elapsed")).toHaveTextContent(
      "12s"
    );
  });

  it("hides the ticking counter from assistive tech", () => {
    render(<ToolActivityStrip label="Querying your data" elapsedSeconds={3} />);
    expect(screen.getByTestId("tool-activity-strip-elapsed")).toHaveAttribute(
      "aria-hidden",
      "true"
    );
  });

  it("exposes the phase as a status region labelled by the phase", () => {
    render(<ToolActivityStrip label="Clustering records" elapsedSeconds={1} />);
    const node = screen.getByRole("status");
    expect(node).toHaveAttribute("aria-label", "Clustering records");
    expect(node).toHaveAttribute("data-testid", "tool-activity-strip");
  });
});
