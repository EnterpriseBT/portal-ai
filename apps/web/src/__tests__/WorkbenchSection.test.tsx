const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const { WorkbenchSectionUI } =
  await import("../components/WorkbenchSection.component");

describe("WorkbenchSectionUI", () => {
  it("titles the section with an h2 and renders its content", () => {
    render(
      <WorkbenchSectionUI title="Favorite stations">
        <p>Body</p>
      </WorkbenchSectionUI>
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Favorite stations" })
    ).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("renders its see-all as a link to the list", async () => {
    const { container } = render(
      <WorkbenchSectionUI
        title="Favorite stations"
        seeAll={{ href: "/stations", label: "All stations" }}
      >
        <p>Body</p>
      </WorkbenchSectionUI>
    );
    expect(screen.getByRole("link", { name: "All stations" })).toHaveAttribute(
      "href",
      "/stations"
    );
    await expectNoAxeViolations(container);
  });

  it("has no link without a see-all", () => {
    render(
      <WorkbenchSectionUI title="Recent portals">
        <p>Body</p>
      </WorkbenchSectionUI>
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
