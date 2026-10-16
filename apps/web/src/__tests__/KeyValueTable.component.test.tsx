import { jest } from "@jest/globals";

import type { KeyValueRow } from "../utils/key-value-rows.util";

const { render, screen, fireEvent } = await import("./test-utils");
const { KeyValueTableUI } =
  await import("../components/KeyValueTable.component");
const { newKeyValueRow } = await import("../utils/key-value-rows.util");

const setup = (
  rows: KeyValueRow[],
  extra: Partial<Parameters<typeof KeyValueTableUI>[0]> = {}
) => {
  const onChange = jest.fn<(rows: KeyValueRow[]) => void>();
  render(<KeyValueTableUI rows={rows} onChange={onChange} {...extra} />);
  return { onChange };
};

describe("KeyValueTableUI (#808)", () => {
  it("shows the hint and the add button when empty", () => {
    setup([], { emptyHint: "No query parameters." });
    expect(screen.getByText("No query parameters.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add parameter" })
    ).toBeInTheDocument();
  });

  it("adds an empty row", () => {
    const { onChange } = setup([]);
    fireEvent.click(screen.getByRole("button", { name: "Add parameter" }));
    const next = onChange.mock.calls[0][0];
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ key: "", value: "" });
  });

  it("edits a row's key and value", () => {
    const rows = [newKeyValueRow("a", "1"), newKeyValueRow("b", "2")];
    const { onChange } = setup(rows);
    fireEvent.change(screen.getByRole("textbox", { name: "Key 2" }), {
      target: { value: "bee" },
    });
    expect(onChange.mock.calls[0][0][1]).toMatchObject({
      id: rows[1].id,
      key: "bee",
      value: "2",
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Value 1" }), {
      target: { value: "a&b=c d" },
    });
    expect(onChange.mock.calls[1][0][0]).toMatchObject({ value: "a&b=c d" });
  });

  it("removes a row through its named remove button", () => {
    const rows = [newKeyValueRow("a", "1"), newKeyValueRow("", "2")];
    const { onChange } = setup(rows);
    // A keyless row is named by its position.
    expect(
      screen.getByRole("button", { name: "Remove parameter 2" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove parameter a" }));
    expect(onChange.mock.calls[0][0]).toEqual([rows[1]]);
  });

  it("shows a key error with aria-invalid on that row only", () => {
    setup([newKeyValueRow("a", "1"), newKeyValueRow("a", "2")], {
      keyErrors: [undefined, "Duplicate key"],
    });
    expect(screen.getByText("Duplicate key")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Key 2" })).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    expect(screen.getByRole("textbox", { name: "Key 1" })).toHaveAttribute(
      "aria-invalid",
      "false"
    );
  });

  it("reports a key blur by row index", () => {
    const onKeyBlur = jest.fn();
    setup([newKeyValueRow("a", "1"), newKeyValueRow("b", "2")], { onKeyBlur });
    fireEvent.blur(screen.getByRole("textbox", { name: "Key 2" }));
    expect(onKeyBlur).toHaveBeenCalledWith(1);
  });

  it("uses the item noun and column labels it's given", () => {
    setup([newKeyValueRow("Accept", "application/json")], {
      itemNoun: "header",
      keyLabel: "Name",
    });
    expect(
      screen.getByRole("columnheader", { name: "Name" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove header Accept" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add header" })
    ).toBeInTheDocument();
  });

  it("shows a value error and reports a value blur by row index", () => {
    const onValueBlur = jest.fn();
    setup([newKeyValueRow("filter", "{{page}}")], {
      valueErrors: ["Unknown template variable"],
      onValueBlur,
    });
    expect(screen.getByText("Unknown template variable")).toBeInTheDocument();
    const value = screen.getByRole("textbox", { name: "Value 1" });
    expect(value).toHaveAttribute("aria-invalid", "true");
    fireEvent.blur(value);
    expect(onValueBlur).toHaveBeenCalledWith(0);
  });
});
