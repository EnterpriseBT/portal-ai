import { render, screen } from "./test-utils";
import { EntityRecordFieldValue } from "../components/EntityRecordFieldValue.component";

describe("EntityRecordFieldValue", () => {
  it("renders null as a muted dash", () => {
    render(<EntityRecordFieldValue value={null} type="string" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders undefined as a muted dash", () => {
    render(<EntityRecordFieldValue value={undefined} type="string" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders a string value as typography", () => {
    render(<EntityRecordFieldValue value="hello" type="string" />);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("renders a boolean value formatted", () => {
    render(<EntityRecordFieldValue value={true} type="boolean" />);
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });

  it("renders a number value formatted", () => {
    render(<EntityRecordFieldValue value={1234} type="number" />);
    expect(screen.getByText("1,234")).toBeInTheDocument();
  });

  it("renders a json object as a <pre> code block", () => {
    const { container } = render(
      <EntityRecordFieldValue value={{ id: 1, name: "Alice" }} type="json" />
    );
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toContain('"name": "Alice"');
  });

  it("renders an array as a <pre> code block", () => {
    const { container } = render(
      <EntityRecordFieldValue value={["a", "b", "c"]} type="array" />
    );
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toContain('"a"');
  });

  it("json <pre> block shows pretty-printed JSON with indentation", () => {
    const { container } = render(
      <EntityRecordFieldValue value={{ x: 1 }} type="json" />
    );
    expect(container.querySelector("pre")!.textContent).toBe(
      JSON.stringify({ x: 1 }, null, 2)
    );
  });

  it("renders a reference-array as a <pre> code block", () => {
    const { container } = render(
      <EntityRecordFieldValue value={["id-1", "id-2"]} type="reference-array" />
    );
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toContain('"id-1"');
  });
});
