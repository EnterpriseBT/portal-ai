import { jest } from "@jest/globals";

const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { NewPortalButtonUI } =
  await import("../components/NewPortalButton.component");

const SALES = { id: "s1", name: "Sales Ops" };
const props = (overrides = {}) => ({
  station: SALES,
  onLaunch: jest.fn(),
  pageStation: SALES,
  favoriteStations: [
    { id: "s2", name: "Finance Close" },
    { id: "s3", name: "Field Inspections" },
  ],
  onLaunchIn: jest.fn(),
  onChooseStation: jest.fn(),
  ...overrides,
});

const openMenu = async () => {
  await userEvent.click(
    screen.getByRole("button", { name: "More ways to start a portal" })
  );
  return screen.findByRole("menu");
};

describe("NewPortalButtonUI (#1122)", () => {
  it("names its station and starts a portal there", async () => {
    const p = props();
    render(<NewPortalButtonUI {...p} />);
    await userEvent.click(
      screen.getByRole("button", { name: "New portal in Sales Ops" })
    );
    expect(p.onLaunch).toHaveBeenCalledTimes(1);
  });

  it("lists the page's station and favorites under headings, then Choose station", async () => {
    const p = props();
    const { baseElement } = render(<NewPortalButtonUI {...p} />);
    const menu = await openMenu();
    const names = screen
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    expect(names).toEqual([
      "New portal in Sales Ops",
      "Finance Close",
      "Field Inspections",
      "Choose station…",
    ]);
    expect(
      screen.getByRole("menuitem", { name: "Finance Close" })
    ).toHaveAccessibleDescription("Favorite stations");
    await expectNoAxeViolations(baseElement);

    await userEvent.click(
      screen.getByRole("menuitem", { name: "Finance Close" })
    );
    expect(p.onLaunchIn).toHaveBeenCalledWith("s2");
    expect(menu).not.toBeVisible();
  });

  it("teaches how to add favorites when there are none", async () => {
    render(
      <NewPortalButtonUI
        {...props({ favoriteStations: [], pageStation: null })}
      />
    );
    await openMenu();
    const hint = screen.getByRole("menuitem", {
      name: "Star a station to add it here",
    });
    expect(hint).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText("On this page")).toBeNull();
  });

  it("chooses a station from the main click when there's none to use", async () => {
    const p = props({ station: null });
    render(<NewPortalButtonUI {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "New portal" }));
    expect(p.onChooseStation).toHaveBeenCalledTimes(1);
    expect(p.onLaunch).not.toHaveBeenCalled();
  });

  it("blocks every launch, keeping each focusable with the reason", async () => {
    const p = props({
      gate: { kind: "disable", reason: "Ask for access to start portals" },
    });
    render(<NewPortalButtonUI {...p} />);
    const main = screen.getByRole("button", {
      name: "New portal in Sales Ops",
    });
    expect(main).toHaveAccessibleDescription("Ask for access to start portals");
    await openMenu();
    const favorite = screen.getByRole("menuitem", { name: "Finance Close" });
    expect(favorite).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(favorite);
    expect(p.onLaunchIn).not.toHaveBeenCalled();
  });

  it("says it's starting while a launch runs", () => {
    render(<NewPortalButtonUI {...props({ pending: true })} />);
    expect(
      screen.getByRole("button", { name: "New portal in Sales Ops" })
    ).toHaveAccessibleDescription("Starting…");
  });

  it("is icons only, named by its label, at narrow widths", async () => {
    const { container } = render(
      <NewPortalButtonUI {...props({ layout: "icon" })} />
    );
    const main = screen.getByRole("button", {
      name: "New portal in Sales Ops",
    });
    expect(main).not.toHaveTextContent("Sales Ops");
    await expectNoAxeViolations(container);
  });
});
