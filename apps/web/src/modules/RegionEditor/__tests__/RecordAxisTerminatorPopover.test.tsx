import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Terminator } from "@portalai/core/contracts";

import {
  RecordAxisTerminatorPopoverUI,
  type RecordAxisTerminatorPopoverUIProps,
} from "../RecordAxisTerminatorPopover.component";

function setup(overrides: Partial<RecordAxisTerminatorPopoverUIProps> = {}) {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const onToggle = jest.fn<(on: boolean) => void>();
  const onChangeTerminator = jest.fn<(t: Terminator) => void>();
  const onClose = jest.fn();
  const props: RecordAxisTerminatorPopoverUIProps = {
    open: true,
    anchorEl: anchor,
    recordsAxis: "row",
    onToggle,
    onChangeTerminator,
    onClose,
    ...overrides,
  };
  const utils = render(<RecordAxisTerminatorPopoverUI {...props} />);
  return { ...utils, onToggle, onChangeTerminator, onClose };
}

describe("RecordAxisTerminatorPopoverUI", () => {
  it("renders a terminator toggle; unchecked when terminator is undefined", () => {
    setup();
    const toggle = screen.getByRole("checkbox", {
      name: /grow until terminator/i,
    });
    expect(toggle).not.toBeChecked();
    // The terminator form stays hidden while the toggle is off.
    expect(
      screen.queryByRole("textbox", { name: /record axis terminator/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("spinbutton", { name: /record axis terminator/i })
    ).not.toBeInTheDocument();
  });

  it("reveals the terminator form when a terminator is set", () => {
    setup({
      terminator: { kind: "untilBlank", consecutiveBlanks: 4 },
    });
    const toggle = screen.getByRole("checkbox", {
      name: /grow until terminator/i,
    });
    expect(toggle).toBeChecked();
    const blanksInput = screen.getByRole("spinbutton", {
      name: /record axis terminator consecutive blanks/i,
    });
    expect(blanksInput).toHaveValue(4);
  });

  it("toggling fires onToggle with the next checked state", () => {
    const { onToggle } = setup();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /grow until terminator/i })
    );
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("editing the pattern fires onChangeTerminator", () => {
    const { onChangeTerminator } = setup({
      terminator: { kind: "matchesPattern", pattern: "" },
    });
    const patternInput = screen.getByRole("textbox", {
      name: /record axis terminator pattern/i,
    });
    fireEvent.change(patternInput, { target: { value: "^END$" } });
    expect(onChangeTerminator).toHaveBeenCalledWith({
      kind: "matchesPattern",
      pattern: "^END$",
    });
  });

  it("renders the records axis label in the header", () => {
    setup({ recordsAxis: "column" });
    expect(screen.getByText(/extent · column axis/i)).toBeInTheDocument();
  });
});
