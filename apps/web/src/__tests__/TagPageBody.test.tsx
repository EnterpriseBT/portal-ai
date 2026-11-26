const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const { TagPageBodyUI } = await import("../components/TagPageBody.component");

const groups = [
  {
    title: "Stations",
    items: [{ id: "s1", name: "Finance Close", href: "/stations/s1" }],
    total: 1,
    viewAllHref: "/stations",
  },
  { title: "Views", items: [], total: 0, viewAllHref: "/views" },
];

describe("TagPageBodyUI", () => {
  it("renders every group in order, empty ones included", async () => {
    const { container } = render(<TagPageBodyUI groups={groups} />);
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
    ).toEqual(["Stations", "Views"]);
    expect(screen.getByText("No views have this tag.")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("shows one teaching empty state when nothing has the tag", async () => {
    const { container } = render(
      <TagPageBodyUI
        groups={groups.map((g) => ({ ...g, items: [], total: 0 }))}
      />
    );
    expect(screen.getByText("Nothing has this tag yet")).toBeInTheDocument();
    expect(screen.queryByText("No views have this tag.")).toBeNull();
    await expectNoAxeViolations(container);
  });
});
