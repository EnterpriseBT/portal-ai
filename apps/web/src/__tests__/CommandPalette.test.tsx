import { jest } from "@jest/globals";

import type { PaletteGroup } from "../utils/launcher-items.util";

const { expectNoAxeViolations, render, screen, waitFor } =
  await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { CommandPaletteUI } =
  await import("../components/CommandPalette.component");

const groups = (onNew = jest.fn()): PaletteGroup[] => [
  {
    label: "Actions",
    entries: [
      { kind: "action", id: "new", label: "New portal", onSelect: onNew },
      {
        kind: "action",
        id: "invite",
        label: "Invite a member",
        onSelect: jest.fn(),
        gate: { kind: "disable", reason: "Needs member.invite" },
      },
    ],
  },
  {
    label: "Favorites",
    entries: [
      {
        kind: "item",
        id: "s1",
        type: "station",
        name: "Finance Close",
        href: "/stations/s1",
      },
    ],
  },
];

const props = (overrides = {}) => ({
  open: true,
  onClose: jest.fn(),
  query: "",
  onQueryChange: jest.fn(),
  groups: groups(),
  ...overrides,
});

describe("CommandPaletteUI (#1122)", () => {
  it("is a named dialog with grouped rows, a count and key hints", async () => {
    render(<CommandPaletteUI {...props()} />);
    const dialog = screen.getByRole("dialog", { name: "Search and actions" });
    expect(screen.getByRole("group", { name: "Actions" })).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Favorites" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Finance Close · station" })
    ).toHaveAttribute("href", "/stations/s1");
    expect(screen.getByRole("status")).toHaveTextContent("3 results");
    expect(dialog).toHaveTextContent("filter by tag");
    await expectNoAxeViolations(dialog);
  });

  it("focuses the search on open", async () => {
    render(<CommandPaletteUI {...props()} />);
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Search or run an action" })
      ).toHaveFocus()
    );
  });

  it("runs the highlighted action on Enter, and not a gated one", async () => {
    const onNew = jest.fn();
    const p = props({ groups: groups(onNew) });
    render(<CommandPaletteUI {...p} />);
    const input = screen.getByRole("combobox");
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    expect(onNew).toHaveBeenCalledTimes(1);
    const gated = screen.getByRole("option", { name: "Invite a member" });
    expect(gated).toHaveAccessibleDescription("Needs member.invite");
  });

  it("passes typing up and closes on Escape", async () => {
    const p = props();
    render(<CommandPaletteUI {...p} />);
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveFocus());
    await userEvent.keyboard("#fin");
    expect(p.onQueryChange).toHaveBeenCalledWith("#");
    await userEvent.keyboard("{Escape}");
    expect(p.onClose).toHaveBeenCalled();
  });

  it("labels a tag query's results by the caller's group", () => {
    render(
      <CommandPaletteUI
        {...props({
          query: "#finance",
          groups: [{ label: "Tagged “finance”", entries: groups()[1].entries }],
        })}
      />
    );
    expect(
      screen.getByRole("group", { name: "Tagged “finance”" })
    ).toBeInTheDocument();
  });

  it("says it's searching while results load", async () => {
    render(
      <CommandPaletteUI
        {...props({ groups: [], loading: true, query: "fin" })}
      />
    );
    expect(screen.getByText("Searching…")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading results…");
    await expectNoAxeViolations(screen.getByRole("dialog"));
  });

  it("says nothing matches a query with no results", () => {
    render(<CommandPaletteUI {...props({ groups: [], query: "zzz" })} />);
    expect(screen.getByText("Nothing matches “zzz”.")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("teaches how to fill it when there's nothing yet", async () => {
    render(<CommandPaletteUI {...props({ groups: [] })} />);
    expect(
      screen.getByText(/Star stations, pinned results/)
    ).toBeInTheDocument();
    await expectNoAxeViolations(screen.getByRole("dialog"));
  });

  it("renders nothing when closed", () => {
    render(<CommandPaletteUI {...props({ open: false })} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
