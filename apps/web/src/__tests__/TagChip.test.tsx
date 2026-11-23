import { jest } from "@jest/globals";

const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { TagChipUI } = await import("../components/TagChip.component");

const tag = { id: "tag-1", name: "Finance", color: "#2563EB" };

describe("TagChipUI (#1070)", () => {
  it("shows the tag's name and colour dot", async () => {
    const { container } = render(<TagChipUI tag={tag} />);
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByTestId("tag-color-dot")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("leaves out the dot for a tag with no colour", () => {
    render(<TagChipUI tag={{ ...tag, color: null }} />);
    expect(screen.queryByTestId("tag-color-dot")).toBeNull();
  });

  it("offers removal only when onDelete is set", async () => {
    const onDelete = jest.fn();
    const { rerender } = render(<TagChipUI tag={tag} />);
    expect(screen.queryByTestId("CancelIcon")).toBeNull();

    rerender(<TagChipUI tag={tag} onDelete={onDelete} />);
    await userEvent.click(screen.getByTestId("CancelIcon"));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
