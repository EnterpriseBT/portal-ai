const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const { TagResultGroupUI } =
  await import("../components/TagResultGroup.component");

describe("TagResultGroupUI", () => {
  it("links each tagged object and the filtered list", async () => {
    const { container } = render(
      <TagResultGroupUI
        title="Stations"
        items={[{ id: "s1", name: "Finance Close", href: "/stations/s1" }]}
        total={4}
        viewAllHref="/stations"
      />
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Stations" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Finance Close" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Finance Close" })).toHaveAttribute(
      "href",
      "/stations/s1"
    );
    expect(
      screen.getByRole("link", { name: "View all 4 stations" })
    ).toHaveAttribute("href", "/stations");
    await expectNoAxeViolations(container);
  });

  it("says an empty group is empty, with no View all", async () => {
    const { container } = render(
      <TagResultGroupUI
        title="Views"
        items={[]}
        total={0}
        viewAllHref="/views"
      />
    );
    expect(screen.getByText("No views have this tag.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    await expectNoAxeViolations(container);
  });
});
