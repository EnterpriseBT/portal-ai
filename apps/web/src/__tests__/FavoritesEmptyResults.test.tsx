const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const { FavoritesEmptyResults } =
  await import("../components/FavoritesEmptyResults.component");

describe("FavoritesEmptyResults (#1072)", () => {
  it("says how to star an item of the list's kind", () => {
    render(<FavoritesEmptyResults noun="station" />);
    expect(screen.getByText("No favorites yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Star a station to keep it here. Only you see your favorites."
      )
    ).toBeInTheDocument();
  });

  it("links to the Help entry on favorites", () => {
    render(<FavoritesEmptyResults noun="view" />);
    const link = screen.getByRole("link", { name: /How do favorites work\?/ });
    expect(link.getAttribute("href")).toMatch(/^\/help#/);
  });

  it("has no axe violations", async () => {
    const { container } = render(<FavoritesEmptyResults noun="connector" />);
    await expectNoAxeViolations(container);
  });
});
