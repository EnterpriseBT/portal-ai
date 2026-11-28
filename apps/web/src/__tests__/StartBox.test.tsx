import { jest } from "@jest/globals";

import type { StartBoxUIProps } from "../components/StartBox.component";

const { expectNoAxeViolations, render, screen, within } =
  await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { StartBoxUI } = await import("../components/StartBox.component");

const STATIONS = [
  { id: "s1", name: "Finance Close", favorite: true },
  { id: "s2", name: "Field Inspections", favorite: false },
];

const props = (overrides: Partial<StartBoxUIProps> = {}): StartBoxUIProps => ({
  stations: STATIONS,
  initialStationId: "s1",
  pending: false,
  serverError: null,
  onStart: jest.fn(),
  ...overrides,
});

const field = () => screen.getByRole("textbox", { name: "Ask a question" });
const start = () => screen.getByRole("button", { name: "Start" });

describe("StartBoxUI", () => {
  it("renders a labelled prompt, the station and Start", async () => {
    const { container } = render(<StartBoxUI {...props()} />);
    expect(field()).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Finance Close, station/ })
    ).toBeInTheDocument();
    expect(start()).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("starts on Enter with the trimmed prompt and the station", async () => {
    const onStart = jest.fn();
    render(<StartBoxUI {...props({ onStart })} />);
    await userEvent.type(field(), "  Top accounts{Enter}");
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith({
      stationId: "s1",
      initialMessage: "Top accounts",
    });
  });

  it("adds a line on Shift+Enter without starting", async () => {
    const onStart = jest.fn();
    render(<StartBoxUI {...props({ onStart })} />);
    await userEvent.type(field(), "one{Shift>}{Enter}{/Shift}two");
    expect(field()).toHaveValue("one\ntwo");
    expect(onStart).not.toHaveBeenCalled();
  });

  // #1137 adversarial walk: the dashboard stays on screen until the new
  // portal's page loads, after the create has answered. A start holds Start
  // until the box goes or the start fails, so a late click can't make a
  // second portal.
  it("holds Start after a start until it fails", async () => {
    const onStart = jest.fn();
    const { rerender } = render(<StartBoxUI {...props({ onStart })} />);
    await userEvent.type(field(), "Top accounts{Enter}");
    expect(onStart).toHaveBeenCalledTimes(1);
    // The create answered: no longer pending, and no error.
    rerender(<StartBoxUI {...props({ onStart })} />);
    expect(start()).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(start());
    await userEvent.type(field(), "{Enter}");
    expect(onStart).toHaveBeenCalledTimes(1);
    // A failure lets the user try again.
    rerender(
      <StartBoxUI
        {...props({
          onStart,
          serverError: { message: "Couldn't start", code: "PORTAL_FAILED" },
        })}
      />
    );
    expect(start()).not.toHaveAttribute("aria-disabled", "true");
    await userEvent.click(start());
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it("starts from the Start button", async () => {
    const onStart = jest.fn();
    render(<StartBoxUI {...props({ onStart })} />);
    await userEvent.type(field(), "Top accounts");
    await userEvent.click(start());
    expect(onStart).toHaveBeenCalledWith({
      stationId: "s1",
      initialMessage: "Top accounts",
    });
  });

  it("can't start an empty prompt, and says why", async () => {
    const onStart = jest.fn();
    render(<StartBoxUI {...props({ onStart })} />);
    expect(start()).toHaveAttribute("aria-disabled", "true");
    expect(start()).toHaveAccessibleDescription("Type a question to start");
    await userEvent.type(field(), "   {Enter}");
    await userEvent.click(start());
    expect(onStart).not.toHaveBeenCalled();
  });

  it("asks for a station when none is preselected, then starts once picked", async () => {
    const onStart = jest.fn();
    render(<StartBoxUI {...props({ onStart, initialStationId: null })} />);
    await userEvent.type(field(), "Top accounts{Enter}");
    expect(onStart).not.toHaveBeenCalled();
    expect(start()).toHaveAccessibleDescription("Pick a station to start");

    await userEvent.click(
      screen.getByRole("button", { name: "Pick a station" })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /Field Inspections/ })
    );
    await userEvent.click(start());
    expect(onStart).toHaveBeenCalledWith({
      stationId: "s2",
      initialMessage: "Top accounts",
    });
  });

  it("never sends a preselected station that isn't in the list", async () => {
    const onStart = jest.fn();
    render(<StartBoxUI {...props({ onStart, initialStationId: "gone" })} />);
    expect(
      screen.getByRole("button", { name: "Pick a station" })
    ).toBeInTheDocument();
    await userEvent.type(field(), "Top accounts{Enter}");
    expect(onStart).not.toHaveBeenCalled();
    expect(start()).toHaveAccessibleDescription("Pick a station to start");
  });

  it("picks up a preselected station that arrives after mount, until the user picks", async () => {
    const onStart = jest.fn();
    const { rerender } = render(
      <StartBoxUI {...props({ onStart, initialStationId: null })} />
    );
    rerender(<StartBoxUI {...props({ onStart, initialStationId: "s1" })} />);
    expect(
      screen.getByRole("button", { name: /Finance Close, station/ })
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /Finance Close, station/ })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /Field Inspections/ })
    );
    // A later preselection doesn't override the user's pick.
    rerender(<StartBoxUI {...props({ onStart, initialStationId: "s1" })} />);
    await userEvent.type(field(), "Top accounts{Enter}");
    expect(onStart).toHaveBeenCalledWith({
      stationId: "s2",
      initialMessage: "Top accounts",
    });
  });

  it("doesn't start again while pending", async () => {
    const onStart = jest.fn();
    render(<StartBoxUI {...props({ onStart, pending: true })} />);
    await userEvent.type(field(), "Top accounts{Enter}");
    await userEvent.click(start());
    expect(onStart).not.toHaveBeenCalled();
    expect(start()).toHaveAccessibleDescription("Starting…");
  });

  it("puts the caller's gate ahead of the box's own reasons", async () => {
    const onStart = jest.fn();
    render(
      <StartBoxUI
        {...props({
          onStart,
          gate: { kind: "disable", reason: "Ask for access to start portals" },
        })}
      />
    );
    await userEvent.type(field(), "Top accounts{Enter}");
    expect(onStart).not.toHaveBeenCalled();
    expect(start()).toHaveAccessibleDescription(
      "Ask for access to start portals"
    );
  });

  it("keeps the typed prompt when a start fails", async () => {
    const { rerender } = render(<StartBoxUI {...props()} />);
    await userEvent.type(field(), "Top accounts");
    rerender(
      <StartBoxUI
        {...props({
          serverError: {
            message: "Couldn't start",
            code: "PORTAL_CREATE_FAILED",
          },
        })}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't start");
    expect(field()).toHaveValue("Top accounts");
    await expectNoAxeViolations(document.body);
  });

  it("describes how Enter behaves, and shows no example prompts", () => {
    render(<StartBoxUI {...props()} />);
    expect(field()).toHaveAccessibleDescription(
      "Enter to start, Shift+Enter for a new line"
    );
    expect(field()).toHaveAttribute(
      "placeholder",
      "Ask anything about your data…"
    );
    expect(screen.queryByText("Try:")).not.toBeInTheDocument();
  });

  // ── #1079: validation, and a station found by search ───────────────

  const LONG = "a".repeat(20_001);
  const TOO_LONG = "Question must be 20000 characters or fewer";

  it("refuses a question over the limit, says why and focuses it", async () => {
    const onStart = jest.fn();
    render(<StartBoxUI {...props({ onStart })} />);
    await userEvent.click(field());
    await userEvent.paste(LONG);
    await userEvent.click(start());

    expect(onStart).not.toHaveBeenCalled();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(TOO_LONG)).toBeInTheDocument();
    expect(field()).toHaveFocus();
    // Kept, never cut, so nothing typed is lost.
    expect(field()).toHaveValue(LONG);
    await expectNoAxeViolations(document.body);
  });

  it("shows the limit only once the field is left or submitted", async () => {
    render(<StartBoxUI {...props()} />);
    await userEvent.click(field());
    await userEvent.paste(LONG);
    expect(screen.queryByText(TOO_LONG)).not.toBeInTheDocument();
    expect(field()).not.toHaveAttribute("aria-invalid", "true");

    await userEvent.tab();
    expect(screen.getByText(TOO_LONG)).toBeInTheDocument();
  });

  it("clears the error once the question fits again", async () => {
    const onStart = jest.fn();
    render(<StartBoxUI {...props({ onStart })} />);
    await userEvent.click(field());
    await userEvent.paste(LONG);
    await userEvent.click(start());
    await userEvent.clear(field());
    await userEvent.type(field(), "Top accounts");
    expect(screen.queryByText(TOO_LONG)).not.toBeInTheDocument();
    await userEvent.click(start());
    expect(onStart).toHaveBeenCalledWith({
      stationId: "s1",
      initialMessage: "Top accounts",
    });
  });

  it("starts in a station found by search, and keeps it named", async () => {
    const onStart = jest.fn();
    const onQueryChange = jest.fn();
    const found = { id: "s9", name: "Ops Review", favorite: false };
    const { rerender } = render(
      <StartBoxUI
        {...props({
          onStart,
          initialStationId: null,
          stationSearch: {
            query: "ops",
            onQueryChange,
            results: [found],
            searching: false,
          },
        })}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Pick a station" })
    );
    await userEvent.click(
      await screen.findByRole("option", { name: /Ops Review/ })
    );
    // The query moves on and the station drops out of the results.
    rerender(
      <StartBoxUI
        {...props({
          onStart,
          initialStationId: null,
          stationSearch: {
            query: "",
            onQueryChange,
            results: [],
            searching: false,
          },
        })}
      />
    );
    expect(
      screen.getByRole("button", { name: /Ops Review, station/ })
    ).toBeInTheDocument();
    // Reopened, it's listed under its own heading after the suggestions.
    await userEvent.click(
      screen.getByRole("button", { name: /Ops Review, station/ })
    );
    const selected = await screen.findByRole("group", {
      name: "Selected station",
    });
    expect(
      within(selected).getByRole("option", { name: /Ops Review/ })
    ).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await userEvent.type(field(), "Top accounts{Enter}");
    expect(onStart).toHaveBeenCalledWith({
      stationId: "s9",
      initialMessage: "Top accounts",
    });
  });
});
