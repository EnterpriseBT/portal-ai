import { jest } from "@jest/globals";

const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { FavoriteToggleUI } =
  await import("../components/FavoriteToggle.component");

const props = (overrides = {}) => ({
  name: "Sales",
  isFavorite: false,
  pending: false,
  onToggle: jest.fn(),
  ...overrides,
});

describe("FavoriteToggleUI (#1072)", () => {
  it("offers to favorite an unstarred object, unpressed", () => {
    render(<FavoriteToggleUI {...props()} />);
    const button = screen.getByRole("button", { name: "Favorite Sales" });
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("offers to unfavorite a starred object, pressed", () => {
    render(<FavoriteToggleUI {...props({ isFavorite: true })} />);
    const button = screen.getByRole("button", { name: "Unfavorite Sales" });
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onToggle when pressed", async () => {
    const user = userEvent.setup();
    const onToggle = jest.fn();
    render(<FavoriteToggleUI {...props({ onToggle })} />);
    await user.click(screen.getByRole("button", { name: "Favorite Sales" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("keeps focus and ignores presses while a change is in flight", async () => {
    const user = userEvent.setup();
    const onToggle = jest.fn();
    const { rerender } = render(<FavoriteToggleUI {...props({ onToggle })} />);
    const button = screen.getByRole("button", { name: "Favorite Sales" });
    button.focus();
    rerender(<FavoriteToggleUI {...props({ onToggle, pending: true })} />);
    const waiting = screen.getByRole("button", { name: "Favorite Sales" });
    expect(waiting).toHaveFocus();
    expect(waiting).toHaveAttribute("aria-disabled", "true");
    await user.click(waiting);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("has no axe violations, starred or not", async () => {
    const { container, rerender } = render(<FavoriteToggleUI {...props()} />);
    await expectNoAxeViolations(container);
    rerender(<FavoriteToggleUI {...props({ isFavorite: true })} />);
    await expectNoAxeViolations(container);
  });
});
