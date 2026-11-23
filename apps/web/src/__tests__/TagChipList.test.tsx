import { jest } from "@jest/globals";

const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { TagChipListUI } = await import("../components/TagChipList.component");

const tags = [
  { id: "tag-1", name: "Finance", color: "#2563EB" },
  { id: "tag-2", name: "Q4", color: null },
];

describe("TagChipListUI (#1070)", () => {
  it("renders a chip per tag", async () => {
    const { container } = render(<TagChipListUI tags={tags} />);
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByText("Q4")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it.each([
    ["no tags", []],
    ["tags not loaded", undefined],
  ])("renders nothing for %s", (_name, value) => {
    const { container } = render(<TagChipListUI tags={value} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hands the removed tag to onDelete", async () => {
    const onDelete = jest.fn();
    render(<TagChipListUI tags={tags} onDelete={onDelete} />);
    await userEvent.click(screen.getAllByTestId("CancelIcon")[1]!);
    expect(onDelete).toHaveBeenCalledWith(tags[1]);
  });
});
