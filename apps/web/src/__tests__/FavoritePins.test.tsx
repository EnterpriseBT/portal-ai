const { expectNoAxeViolations, render, screen, within } =
  await import("./test-utils");
const { FavoritePinsUI } = await import("../components/FavoritePins.component");

const item = (n: number) => ({
  pin: { id: `r${n}`, title: `Pin ${n}` },
  status: "ready" as const,
  content: <p>Content {n}</p>,
});

describe("FavoritePinsUI", () => {
  it("renders a tile per pin with its content", async () => {
    const { container } = render(<FavoritePinsUI pins={[item(1), item(2)]} />);
    const list = screen.getByRole("list", { name: "Favorite pins" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Content 2")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("shows at most six by default", () => {
    render(<FavoritePinsUI pins={[1, 2, 3, 4, 5, 6, 7, 8].map(item)} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.queryByText("Pin 7")).not.toBeInTheDocument();
  });

  it("honours a smaller max", () => {
    render(<FavoritePinsUI pins={[1, 2, 3].map(item)} max={2} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows a teaching empty state", async () => {
    const { container } = render(<FavoritePinsUI pins={[]} />);
    expect(screen.getByText("No favorite pins yet")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "How do favorites work?" })
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
