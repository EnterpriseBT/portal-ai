const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const { TagCountChipUI } = await import("../components/TagCountChip.component");

describe("TagCountChipUI", () => {
  it("links to the tag's page, naming the tag and its count", async () => {
    const { container } = render(
      <TagCountChipUI
        tag={{ id: "t1", name: "Finance", color: "#2e7d32" }}
        count={14}
      />
    );
    expect(screen.getByRole("link", { name: "Finance (14)" })).toHaveAttribute(
      "href",
      "/tags/t1"
    );
    expect(screen.getByTestId("tag-color-dot")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("has no dot without a colour", () => {
    render(
      <TagCountChipUI
        tag={{ id: "t4", name: "Draft", color: null }}
        count={2}
      />
    );
    expect(screen.queryByTestId("tag-color-dot")).toBeNull();
  });
});
