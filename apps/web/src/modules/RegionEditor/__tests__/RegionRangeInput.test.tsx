import "@testing-library/jest-dom";
import type { FormEvent } from "react";
import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { expectNoAxeViolations } from "../../../__tests__/test-utils";
import { RegionRangeInputUI } from "../RegionRangeInput.component";
import type { CellBounds } from "../utils/region-editor.types";

const sheet = { rowCount: 200, colCount: 26 };

function setup() {
  const onCreate = jest.fn<(bounds: CellBounds) => void>();
  const onSubmit = jest.fn((e: FormEvent) => e.preventDefault());
  const utils = render(
    <form onSubmit={onSubmit}>
      <RegionRangeInputUI sheet={sheet} onCreate={onCreate} />
      <input aria-label="Other field" />
    </form>
  );
  return { ...utils, onCreate, onSubmit };
}

describe("RegionRangeInputUI (#795)", () => {
  test("Enter in the field adds the region, clears the field, and doesn't submit the form", async () => {
    const { onCreate, onSubmit } = setup();
    const field = screen.getByRole("textbox", { name: "Range" });
    await userEvent.type(field, "A1:D20{Enter}");
    expect(onCreate).toHaveBeenCalledWith({
      startRow: 0,
      endRow: 19,
      startCol: 0,
      endCol: 3,
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(field).toHaveValue("");
  });

  test("the Add region button adds it too", async () => {
    const { onCreate, onSubmit } = setup();
    await userEvent.type(screen.getByRole("textbox", { name: "Range" }), "B3");
    fireEvent.click(screen.getByRole("button", { name: "Add region" }));
    expect(onCreate).toHaveBeenCalledWith({
      startRow: 2,
      endRow: 2,
      startCol: 1,
      endCol: 1,
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("an unreadable range is invalid, keeps focus, and names the format", async () => {
    const { onCreate } = setup();
    const field = screen.getByRole("textbox", { name: "Range" });
    await userEvent.type(field, "hello{Enter}");
    expect(onCreate).not.toHaveBeenCalled();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Enter a range like A1:D20");
    expect(field).toHaveFocus();
    expect(field).toHaveValue("hello");
  });

  test("a range off the sheet names the sheet's extent", async () => {
    const { onCreate } = setup();
    const field = screen.getByRole("textbox", { name: "Range" });
    await userEvent.type(field, "A1:A500{Enter}");
    expect(onCreate).not.toHaveBeenCalled();
    expect(field).toHaveAccessibleDescription("Outside the sheet (A1:Z200)");
  });

  test("has no axe violations, with and without an error", async () => {
    const { container } = setup();
    await expectNoAxeViolations(container);
    await userEvent.type(
      screen.getByRole("textbox", { name: "Range" }),
      "zz{Enter}"
    );
    await expectNoAxeViolations(container);
  });
});
