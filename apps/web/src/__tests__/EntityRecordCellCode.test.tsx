import { render, screen, fireEvent, act } from "./test-utils";
import { EntityRecordCellCode } from "../components/EntityRecordCellCode.component";

describe("EntityRecordCellCode", () => {
  it("renders a JSON object as inline code", () => {
    render(<EntityRecordCellCode value={{ id: 1, name: "Alice" }} type="json" />);
    expect(screen.getByText(/\{"id":1,"name":"Alice"\}/)).toBeInTheDocument();
  });

  it("renders an array as inline code", () => {
    render(<EntityRecordCellCode value={["a", "b", "c"]} type="array" />);
    expect(screen.getByText(/\["a","b","c"\]/)).toBeInTheDocument();
  });

  it("renders a reference-array as inline code", () => {
    render(<EntityRecordCellCode value={["id-1", "id-2"]} type="reference-array" />);
    expect(screen.getByText(/\["id-1","id-2"\]/)).toBeInTheDocument();
  });

  it("does not show a tooltip when value is short", () => {
    render(<EntityRecordCellCode value={{ x: 1 }} type="json" />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("truncates long values and renders ellipsis", () => {
    const longValue = { key: "a".repeat(200) };
    render(<EntityRecordCellCode value={longValue} type="json" maxLength={80} />);
    const code = screen.getByRole("code");
    expect(code.textContent).toHaveLength(81); // 80 chars + "…"
    expect(code.textContent).toMatch(/…$/);
  });

  it("shows tooltip with full value when truncated", async () => {
    const longValue = { key: "a".repeat(200) };
    const { findByRole, getByRole } = render(
      <EntityRecordCellCode value={longValue} type="json" maxLength={80} />
    );

    act(() => {
      fireEvent.mouseOver(getByRole("code"));
    });
    const tooltip = await findByRole("tooltip");
    expect(tooltip.textContent).toContain("a".repeat(200));
  });
});
