import { render, screen } from "./test-utils";

import { TypingIndicator } from "../components/TypingIndicator.component";

describe("TypingIndicator", () => {
  it("renders with role=status and a default aria-label", () => {
    render(<TypingIndicator />);
    const node = screen.getByRole("status");
    expect(node).toHaveAttribute("aria-label", "Assistant is typing");
  });

  it("honors a custom aria-label", () => {
    render(<TypingIndicator ariaLabel="Working on it" />);
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "Working on it"
    );
  });

  it("renders three animated dots", () => {
    const { container } = render(<TypingIndicator />);
    // The dots are the direct children of the status container.
    const status = container.querySelector('[data-testid="typing-indicator"]');
    expect(status).not.toBeNull();
    expect(status!.children.length).toBe(3);
  });

  // #279 — the indicator now stays mounted for the whole turn and names the
  // running tool. With no label it must render exactly as before (the case
  // above is the pin for that); with one it gains the phase and a counter.
  describe("tool activity phase (#279)", () => {
    it("renders the phase label when given one", () => {
      render(<TypingIndicator label="Building the chart" />);
      expect(screen.getByText("Building the chart")).toBeInTheDocument();
    });

    it("renders the elapsed seconds beside the label", () => {
      render(
        <TypingIndicator label="Querying your data" elapsedSeconds={18} />
      );
      expect(screen.getByTestId("typing-indicator-elapsed")).toHaveTextContent(
        "18s"
      );
    });

    it("hides the ticking counter from assistive tech", () => {
      // The counter re-renders every second. Inside a role=status live region
      // that would announce continuously, so only the phase is announced.
      render(<TypingIndicator label="Clustering records" elapsedSeconds={4} />);
      expect(screen.getByTestId("typing-indicator-elapsed")).toHaveAttribute(
        "aria-hidden",
        "true"
      );
    });

    it("announces the phase label instead of the generic typing text", () => {
      render(<TypingIndicator label="Searching the web" />);
      expect(screen.getByRole("status")).toHaveAttribute(
        "aria-label",
        "Searching the web"
      );
    });

    it("renders no counter when elapsedSeconds is omitted", () => {
      render(<TypingIndicator label="Forecasting" />);
      expect(
        screen.queryByTestId("typing-indicator-elapsed")
      ).not.toBeInTheDocument();
    });
  });
});
