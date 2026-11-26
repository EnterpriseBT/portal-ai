import { jest } from "@jest/globals";

import type { StartBoxUIProps } from "../components/StartBox.component";

const { expectNoAxeViolations, render, screen } = await import("./test-utils");
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
      prompt: "Top accounts",
      stationId: "s1",
    });
  });

  it("adds a line on Shift+Enter without starting", async () => {
    const onStart = jest.fn();
    render(<StartBoxUI {...props({ onStart })} />);
    await userEvent.type(field(), "one{Shift>}{Enter}{/Shift}two");
    expect(field()).toHaveValue("one\ntwo");
    expect(onStart).not.toHaveBeenCalled();
  });

  it("starts from the Start button", async () => {
    const onStart = jest.fn();
    render(<StartBoxUI {...props({ onStart })} />);
    await userEvent.type(field(), "Top accounts");
    await userEvent.click(start());
    expect(onStart).toHaveBeenCalledWith({
      prompt: "Top accounts",
      stationId: "s1",
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

  it("asks for a station when there's no default, then starts once picked", async () => {
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
      prompt: "Top accounts",
      stationId: "s2",
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
});
