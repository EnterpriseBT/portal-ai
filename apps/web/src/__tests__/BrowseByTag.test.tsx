const { expectNoAxeViolations, render, screen, within } =
  await import("./test-utils");
const { BrowseByTagUI } = await import("../components/BrowseByTag.component");

const tags = [
  { tag: { id: "t1", name: "Finance", color: "#2e7d32" }, count: 14 },
  { tag: { id: "t2", name: "Field ops", color: null }, count: 3 },
];

describe("BrowseByTagUI", () => {
  it("lists each tag as a link with its count, in order", async () => {
    const { container } = render(<BrowseByTagUI tags={tags} />);
    const list = screen.getByRole("list", { name: "Tags" });
    const links = within(list).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Finance (14)",
      "Field ops (3)",
    ]);
    expect(links[1]).toHaveAttribute("href", "/tags/t2");
    await expectNoAxeViolations(container);
  });

  it("shows a teaching empty state", async () => {
    const { container } = render(<BrowseByTagUI tags={[]} />);
    expect(screen.getByText("No tags yet")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "How do tags work?" })
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
