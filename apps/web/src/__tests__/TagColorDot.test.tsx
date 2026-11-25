const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const { TagColorDotUI } = await import("../components/TagColorDot.component");

describe("TagColorDotUI (#1115)", () => {
  it("draws a decorative dot in the tag's colour", async () => {
    const { container } = render(<TagColorDotUI color="#2563EB" />);
    const dot = screen.getByTestId("tag-color-dot");
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot).toHaveStyle({
      width: "12px",
      backgroundColor: "#2563EB",
    });
    await expectNoAxeViolations(container);
  });

  it("takes a card's larger size", () => {
    render(<TagColorDotUI color="#2563EB" size={16} />);
    expect(screen.getByTestId("tag-color-dot")).toHaveStyle({
      width: "16px",
    });
  });

  it("keeps a host's class, so a chip's icon margin applies", () => {
    render(<TagColorDotUI color="#2563EB" className="MuiChip-icon" />);
    expect(screen.getByTestId("tag-color-dot")).toHaveClass("MuiChip-icon");
  });
});
