import { jest } from "@jest/globals";

const { expectNoAxeViolations, render, screen, within } =
  await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { StationPickerUI } =
  await import("../components/StationPicker.component");

const STATIONS = [
  { id: "s3", name: "Customer Success", favorite: false },
  { id: "s1", name: "Finance Close", favorite: true },
  { id: "s2", name: "Field Inspections", favorite: true },
];

describe("StationPickerUI", () => {
  it("shows the chosen station on its chip", async () => {
    const { container } = render(
      <StationPickerUI
        stations={STATIONS}
        selectedId="s1"
        onSelect={jest.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: /^Finance Close, station/ })
    ).toHaveAttribute("aria-haspopup", "menu");
    await expectNoAxeViolations(container);
  });

  it("asks for a station when none is chosen", () => {
    render(
      <StationPickerUI
        stations={STATIONS}
        selectedId={null}
        onSelect={jest.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: "Pick a station" })
    ).toBeInTheDocument();
  });

  it("lists favorite stations first and selects one", async () => {
    const onSelect = jest.fn();
    render(
      <StationPickerUI
        stations={STATIONS}
        selectedId={null}
        onSelect={onSelect}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Pick a station" })
    );

    const menu = await screen.findByRole("menu");
    const names = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    expect(names).toEqual([
      "Finance CloseFavorite",
      "Field InspectionsFavorite",
      "Customer Success",
    ]);
    await expectNoAxeViolations(document.body);

    await userEvent.click(
      within(menu).getByRole("menuitem", { name: /Field Inspections/ })
    );
    expect(onSelect).toHaveBeenCalledWith("s2");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens and closes from the keyboard", async () => {
    render(
      <StationPickerUI
        stations={STATIONS}
        selectedId="s1"
        onSelect={jest.fn()}
      />
    );
    const chip = screen.getByRole("button", { name: /Finance Close, station/ });
    chip.focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("says when there are no stations", async () => {
    render(
      <StationPickerUI stations={[]} selectedId={null} onSelect={jest.fn()} />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Pick a station" })
    );
    expect(
      await screen.findByRole("menuitem", { name: "No stations yet" })
    ).toHaveAttribute("aria-disabled", "true");
  });
});
