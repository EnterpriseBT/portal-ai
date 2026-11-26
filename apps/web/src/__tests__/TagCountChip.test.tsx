import { jest } from "@jest/globals";

const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { TagCountChipUI } = await import("../components/TagCountChip.component");

const tag = { id: "t1", name: "Finance", color: "#2e7d32" };

describe("TagCountChipUI", () => {
  it("is a toggle named by the tag and its count", async () => {
    const { container } = render(<TagCountChipUI tag={tag} count={14} />);
    const chip = screen.getByRole("button", { name: "Finance (14)" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("tag-color-dot")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("reports its tag when pressed, and shows when it's selected", async () => {
    const onToggle = jest.fn();
    render(
      <>
        <TagCountChipUI
          tag={tag}
          count={14}
          selected
          onToggle={onToggle}
          controls="matches"
        />
        <div id="matches" />
      </>
    );
    const chip = screen.getByRole("button", { name: "Finance (14)" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveAttribute("aria-controls", "matches");
    await userEvent.click(chip);
    expect(onToggle).toHaveBeenCalledWith("t1");
  });

  it("has no dot without a colour", () => {
    render(
      <TagCountChipUI
        tag={{ id: "t4", name: "Draft", color: null }}
        count={2}
      />
    );
    expect(screen.queryByTestId("tag-color-dot")).toBeNull();
  });
});
