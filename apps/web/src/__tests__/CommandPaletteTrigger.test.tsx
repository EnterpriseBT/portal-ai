import { jest } from "@jest/globals";

const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { CommandPaletteTriggerUI } =
  await import("../components/CommandPaletteTrigger.component");

describe("CommandPaletteTriggerUI (#1122)", () => {
  it("is a search-box button named by its text, announcing ⌘K on a Mac", async () => {
    const onOpen = jest.fn();
    const { container } = render(
      <CommandPaletteTriggerUI onOpen={onOpen} platform="mac" />
    );
    const trigger = screen.getByRole("button", { name: "Search or run…" });
    expect(trigger).toHaveAttribute("aria-keyshortcuts", "Meta+K");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.getByText("⌘K").tagName).toBe("KBD");
    await userEvent.click(trigger);
    expect(onOpen).toHaveBeenCalledTimes(1);
    await expectNoAxeViolations(container);
  });

  it("shows Ctrl K elsewhere", () => {
    render(<CommandPaletteTriggerUI onOpen={jest.fn()} platform="other" />);
    expect(screen.getByText("Ctrl K")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Search or run…" })
    ).toHaveAttribute("aria-keyshortcuts", "Control+K");
  });
});
