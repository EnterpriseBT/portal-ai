import { jest } from "@jest/globals";

const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { FavoriteStationCardUI } =
  await import("../components/FavoriteStationCard.component");

const station = {
  id: "s1",
  name: "Finance Close",
  description: "GL accounts and the close calendar.",
};

describe("FavoriteStationCardUI", () => {
  it("links its h3 title to the station and shows its activity", async () => {
    const { container } = render(
      <FavoriteStationCardUI
        station={station}
        lastActivity={Date.now() - 2 * 3600_000}
        onLaunch={jest.fn()}
      />
    );
    const heading = screen.getByRole("heading", {
      level: 3,
      name: "Finance Close",
    });
    expect(heading).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Finance Close" })).toHaveAttribute(
      "href",
      "/stations/s1"
    );
    expect(screen.getByText("Last portal 2h ago")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("says when the station has no portals yet", () => {
    render(
      <FavoriteStationCardUI
        station={station}
        lastActivity={null}
        onLaunch={jest.fn()}
      />
    );
    expect(screen.getByText("No portals yet")).toBeInTheDocument();
  });

  it("launches its station, and Launch is described by the station", async () => {
    const onLaunch = jest.fn();
    render(
      <FavoriteStationCardUI
        station={station}
        lastActivity={null}
        onLaunch={onLaunch}
      />
    );
    const launch = screen.getByRole("button", { name: "Launch" });
    expect(launch).toHaveAccessibleDescription("Finance Close");
    await userEvent.click(launch);
    expect(onLaunch).toHaveBeenCalledWith("s1");
  });

  it("can't launch while launching", async () => {
    const onLaunch = jest.fn();
    render(
      <FavoriteStationCardUI
        station={station}
        lastActivity={null}
        launching
        onLaunch={onLaunch}
      />
    );
    const launch = screen.getByRole("button", { name: "Launch" });
    expect(launch).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(launch);
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("renders a disable gate with its reason, and hides on hide", () => {
    const { rerender } = render(
      <FavoriteStationCardUI
        station={station}
        lastActivity={null}
        launchGate={{ kind: "disable", reason: "Ask for access to launch" }}
        onLaunch={jest.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Launch" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(screen.getByText("Ask for access to launch")).toBeInTheDocument();

    rerender(
      <FavoriteStationCardUI
        station={station}
        lastActivity={null}
        launchGate={{ kind: "hide" }}
        onLaunch={jest.fn()}
      />
    );
    expect(
      screen.queryByRole("button", { name: "Launch" })
    ).not.toBeInTheDocument();
  });
});
