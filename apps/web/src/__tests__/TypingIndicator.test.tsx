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
});
