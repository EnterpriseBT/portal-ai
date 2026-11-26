import { jest } from "@jest/globals";

const { expectNoAxeViolations, render, screen, within } =
  await import("./test-utils");
const { FavoriteStationsUI } =
  await import("../components/FavoriteStations.component");

const items = [
  { station: { id: "s1", name: "Finance Close" }, lastActivity: null },
  { station: { id: "s2", name: "Field Inspections" }, lastActivity: null },
];

describe("FavoriteStationsUI", () => {
  it("lists one card per favorite station", async () => {
    const { container } = render(
      <FavoriteStationsUI items={items} onLaunch={jest.fn()} />
    );
    const list = screen.getByRole("list", { name: "Favorite stations" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: "Field Inspections" })
    ).toHaveAttribute("href", "/stations/s2");
    await expectNoAxeViolations(container);
  });

  it("teaches how to add one when there are none", async () => {
    const { container } = render(
      <FavoriteStationsUI items={[]} onLaunch={jest.fn()} />
    );
    expect(screen.getByText("No favorite stations yet")).toBeInTheDocument();
    expect(screen.getByText(/Star a station/)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
