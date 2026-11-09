import React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";

import { useGridNavigation } from "../../ui/use-grid-navigation";

/**
 * #794: the APG data grid. One Tab stop; arrows move between cells; Enter or
 * F2 enters a cell's control and Escape returns; Tab always leaves.
 */
const Grid: React.FC<{ rows: number; onAct?: (r: number) => void }> = ({
  rows,
  onAct,
}) => {
  const { gridProps, cellProps } = useGridNavigation({
    rowCount: rows + 1,
    colCount: 3,
  });
  return (
    <>
      <button type="button">Before</button>
      <table role="grid" aria-label="People" {...gridProps}>
        <thead>
          <tr role="row">
            {["Name", "Role", "Action"].map((h, c) => (
              <th key={h} role="columnheader" {...cellProps(0, c)}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i} role="row">
              <td role="gridcell" {...cellProps(i + 1, 0)}>
                Person {i + 1}
              </td>
              <td role="gridcell" {...cellProps(i + 1, 1)}>
                <input aria-label={`Role ${i + 1}`} defaultValue="member" />
              </td>
              <td role="gridcell" {...cellProps(i + 1, 2)}>
                <button
                  type="button"
                  onClick={() => onAct?.(i + 1)}
                  onKeyDown={(e) => {
                    // A control that handles Escape itself.
                    if (e.key === "Escape" && e.shiftKey) e.preventDefault();
                  }}
                >
                  Remove {i + 1}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button">After</button>
    </>
  );
};

const cell = (name: string) =>
  screen.getByRole("gridcell", { name }) as HTMLElement;
const header = (name: string) => screen.getByRole("columnheader", { name });
// A cell holding an input takes its name from the input's value, so the Role
// cells are found by coordinates.
const at = (row: number, col: number) =>
  document.querySelector(`[data-grid-cell="${row}:${col}"]`) as HTMLElement;

describe("useGridNavigation", () => {
  it("is one tab stop: Tab enters at the first cell and leaves on the next Tab", async () => {
    const user = userEvent.setup();
    render(<Grid rows={2} />);
    screen.getByRole("button", { name: "Before" }).focus();
    await user.tab();
    expect(header("Name")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
  });

  it("keeps the controls in cells out of the tab order", () => {
    render(<Grid rows={2} />);
    expect(screen.getByRole("textbox", { name: "Role 1" })).toHaveAttribute(
      "tabindex",
      "-1"
    );
    expect(screen.getByRole("button", { name: "Remove 2" })).toHaveAttribute(
      "tabindex",
      "-1"
    );
  });

  it("moves one cell per arrow and stops at the edges", async () => {
    const user = userEvent.setup();
    render(<Grid rows={2} />);
    act(() => header("Name").focus());
    await user.keyboard("{ArrowDown}");
    expect(cell("Person 1")).toHaveFocus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(cell("Remove 1")).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(cell("Remove 2")).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowUp}");
    expect(at(1, 1)).toHaveFocus();
  });

  it("goes to the row's ends with Home/End and the grid's with Ctrl", async () => {
    const user = userEvent.setup();
    render(<Grid rows={2} />);
    act(() => cell("Person 1").focus());
    await user.keyboard("{End}");
    expect(cell("Remove 1")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(cell("Person 1")).toHaveFocus();
    await user.keyboard("{Control>}{End}{/Control}");
    expect(cell("Remove 2")).toHaveFocus();
    await user.keyboard("{Control>}{Home}{/Control}");
    expect(header("Name")).toHaveFocus();
  });

  it("keeps the last focused cell as the tab stop", async () => {
    const user = userEvent.setup();
    render(<Grid rows={2} />);
    act(() => at(2, 1).focus());
    await user.tab();
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(at(2, 1)).toHaveFocus();
  });

  it("enters a cell's control with Enter and returns with Escape", async () => {
    const user = userEvent.setup();
    render(<Grid rows={2} />);
    act(() => at(1, 1).focus());
    await user.keyboard("{Enter}");
    const input = screen.getByRole("textbox", { name: "Role 1" });
    expect(input).toHaveFocus();
    // Arrows belong to the control while it has focus.
    await user.keyboard("{ArrowLeft}x");
    expect(input).toHaveValue("membexr");
    await user.keyboard("{Escape}");
    expect(at(1, 1)).toHaveFocus();
  });

  it("enters with F2 too, and a button activates once inside", async () => {
    const onAct = jest.fn();
    const user = userEvent.setup();
    render(<Grid rows={2} onAct={onAct} />);
    act(() => cell("Remove 1").focus());
    await user.keyboard("{F2}");
    expect(screen.getByRole("button", { name: "Remove 1" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onAct).toHaveBeenCalledWith(1);
  });

  it("leaves an Escape the control handled to the control", async () => {
    const user = userEvent.setup();
    render(<Grid rows={2} />);
    act(() => cell("Remove 1").focus());
    await user.keyboard("{Enter}");
    await user.keyboard("{Shift>}{Escape}{/Shift}");
    expect(screen.getByRole("button", { name: "Remove 1" })).toHaveFocus();
  });

  it("enters interaction when a control is clicked, putting it back in the tab order", async () => {
    const user = userEvent.setup();
    render(<Grid rows={2} />);
    const input = screen.getByRole("textbox", { name: "Role 2" });
    await user.click(input);
    expect(input).toHaveFocus();
    expect(input).not.toHaveAttribute("tabindex", "-1");
    await user.keyboard("{Escape}");
    expect(at(2, 1)).toHaveFocus();
    expect(input).toHaveAttribute("tabindex", "-1");
  });

  it("leaves the grid when Tab passes a cell's last control", async () => {
    const user = userEvent.setup();
    render(<Grid rows={2} />);
    act(() => cell("Remove 1").focus());
    await user.keyboard("{Enter}");
    await user.tab();
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
  });

  it("keeps one tab stop within bounds when rows shrink", () => {
    const { rerender } = render(<Grid rows={3} />);
    act(() => cell("Person 3").focus());
    rerender(<Grid rows={1} />);
    const stops = Array.from(
      document.querySelectorAll('[data-grid-cell][tabindex="0"]')
    );
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveTextContent("Person 1");
  });

  it("gives exactly one cell tabindex 0 at a time", async () => {
    const user = userEvent.setup();
    render(<Grid rows={2} />);
    act(() => header("Name").focus());
    await user.keyboard("{ArrowDown}{ArrowRight}");
    const stops = document.querySelectorAll('[data-grid-cell][tabindex="0"]');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(at(1, 1));
  });

  // Code review: an empty state's single colSpan cell must not strand focus.
  it("keeps a tab stop in an empty grid whose body is one cell", async () => {
    const Empty: React.FC = () => {
      const { gridProps, cellProps } = useGridNavigation({
        rowCount: 2,
        colCount: 3,
      });
      return (
        <table role="grid" aria-label="Empty" {...gridProps}>
          <thead>
            <tr role="row">
              {["A", "B", "C"].map((h, c) => (
                <th key={h} role="columnheader" {...cellProps(0, c)}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr role="row">
              <td role="gridcell" colSpan={3} {...cellProps(1, 0)}>
                Nothing yet
              </td>
            </tr>
          </tbody>
        </table>
      );
    };
    const user = userEvent.setup();
    render(<Empty />);
    act(() => header("C").focus());
    await user.keyboard("{ArrowDown}");
    expect(cell("Nothing yet")).toHaveFocus();
    await user.keyboard("{End}{ArrowRight}");
    expect(cell("Nothing yet")).toHaveFocus();
    expect(
      document.querySelectorAll('[data-grid-cell][tabindex="0"]')
    ).toHaveLength(1);
  });
});
