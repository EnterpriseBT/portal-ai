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

  it("lists stations in the order given, starring favorites, and selects one", async () => {
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
    // The caller orders them (#1079: the start box's suggestions).
    expect(names).toEqual([
      "Customer Success",
      "Finance CloseFavorite",
      "Field InspectionsFavorite",
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

  // #1079: the dashboard's box searches every station the caller can see,
  // not only the first page it loaded.
  describe("search (#1079)", () => {
    const search = (overrides = {}) => ({
      query: "",
      onQueryChange: jest.fn(),
      results: [] as typeof STATIONS,
      searching: false,
      ...overrides,
    });
    const open = async () => {
      await userEvent.click(
        screen.getByRole("button", { name: "Pick a station" })
      );
      return screen.findByRole("dialog", { name: "Pick a station" });
    };

    it("lists the loaded stations for an empty query, and reports what's typed", async () => {
      const onQueryChange = jest.fn();
      render(
        <StationPickerUI
          stations={STATIONS}
          selectedId={null}
          onSelect={jest.fn()}
          search={search({ onQueryChange })}
        />
      );
      const menu = await open();
      expect(within(menu).getAllByRole("option")).toHaveLength(3);
      await userEvent.type(
        screen.getByRole("combobox", { name: "Search stations" }),
        "o"
      );
      expect(onQueryChange).toHaveBeenLastCalledWith("o");
      await expectNoAxeViolations(document.body);
    });

    it("shows the results for a typed query and selects one", async () => {
      const onSelect = jest.fn();
      render(
        <StationPickerUI
          stations={STATIONS}
          selectedId={null}
          onSelect={onSelect}
          search={search({
            query: "ops",
            results: [{ id: "s9", name: "Ops Review", favorite: false }],
          })}
        />
      );
      const menu = await open();
      const names = within(menu)
        .getAllByRole("option")
        .map((item) => item.textContent);
      // An option's name is its station's (a favorite's star line is read as
      // its description).
      expect(names).toEqual(["Ops Review"]);
      await userEvent.click(
        within(menu).getByRole("option", { name: /Ops Review/ })
      );
      expect(onSelect).toHaveBeenCalledWith("s9");
    });

    it("says when it's searching, and when nothing matches", async () => {
      const { rerender } = render(
        <StationPickerUI
          stations={STATIONS}
          selectedId={null}
          onSelect={jest.fn()}
          search={search({ query: "zz", searching: true })}
        />
      );
      await open();
      expect(screen.getAllByText("Searching…").length).toBeGreaterThan(0);
      rerender(
        <StationPickerUI
          stations={STATIONS}
          selectedId={null}
          onSelect={jest.fn()}
          search={search({ query: "zz" })}
        />
      );
      expect(screen.getAllByText("No stations match").length).toBeGreaterThan(
        0
      );
      expect(screen.queryByText("Searching…")).not.toBeInTheDocument();
    });

    // #1137 code review: the popup holds a field and a menu, so it's
    // announced as a dialog; and it reopens without the old search.
    it("opens a named dialog, and forgets the query on pick and on close", async () => {
      const onQueryChange = jest.fn();
      render(
        <StationPickerUI
          stations={STATIONS}
          selectedId={null}
          onSelect={jest.fn()}
          search={search({
            query: "ops",
            onQueryChange,
            results: [{ id: "s9", name: "Ops Review", favorite: false }],
          })}
        />
      );
      const chip = screen.getByRole("button", { name: "Pick a station" });
      expect(chip).toHaveAttribute("aria-haspopup", "dialog");
      await userEvent.click(chip);
      const dialog = await screen.findByRole("dialog", {
        name: "Pick a station",
      });
      expect(chip).toHaveAttribute("aria-controls", dialog.id);
      expect(
        within(dialog).getByRole("combobox", { name: "Search stations" })
      ).toBeInTheDocument();
      await userEvent.click(
        within(dialog).getByRole("option", { name: /Ops Review/ })
      );
      expect(onQueryChange).toHaveBeenLastCalledWith("");

      onQueryChange.mockClear();
      await userEvent.click(chip);
      await screen.findByRole("dialog", { name: "Pick a station" });
      await userEvent.keyboard("{Escape}");
      expect(onQueryChange).toHaveBeenLastCalledWith("");
    });

    it("has no search field without the prop", async () => {
      render(
        <StationPickerUI
          stations={STATIONS}
          selectedId={null}
          onSelect={jest.fn()}
        />
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Pick a station" })
      );
      expect(await screen.findByRole("menu")).toBeInTheDocument();
      expect(
        screen.queryByRole("combobox", { name: "Search stations" })
      ).not.toBeInTheDocument();
    });
  });
});
