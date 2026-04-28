import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { Segment, Terminator } from "@portalai/core/contracts";

import {
  SegmentEditPopoverUI,
  type SegmentEditPopoverUIProps,
} from "../SegmentEditPopover.component";

function fieldSegment(): Segment {
  return { kind: "field", positionCount: 3 };
}

function pivotSegment(overrides: Partial<Extract<Segment, { kind: "pivot" }>> = {}): Segment {
  return {
    kind: "pivot",
    id: "p1",
    axisName: "Quarter",
    axisNameSource: "user",
    positionCount: 4,
    ...overrides,
  };
}

function skipSegment(): Segment {
  return { kind: "skip", positionCount: 1 };
}

function setup(overrides: Partial<SegmentEditPopoverUIProps> = {}) {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const onChangeAxisName = jest.fn<(value: string) => void>();
  const onChangeHeaders =
    jest.fn<(headers: string[] | undefined) => void>();
  const onChangeSkipped =
    jest.fn<(skipped: boolean[] | undefined) => void>();
  const onToggleDynamic = jest.fn<(on: boolean) => void>();
  const onChangeTerminator = jest.fn<(t: Terminator) => void>();
  const onConvert = jest.fn<(kind: Segment["kind"]) => void>();
  const onClose = jest.fn();
  const props: SegmentEditPopoverUIProps = {
    open: true,
    anchorEl: anchor,
    axis: "row",
    segment: fieldSegment(),
    isTail: true,
    onChangeAxisName,
    onChangeHeaders,
    onChangeSkipped,
    onToggleDynamic,
    onChangeTerminator,
    onConvert,
    onClose,
    ...overrides,
  };
  const utils = render(<SegmentEditPopoverUI {...props} />);
  return {
    ...utils,
    onChangeAxisName,
    onChangeHeaders,
    onChangeSkipped,
    onToggleDynamic,
    onChangeTerminator,
    onConvert,
    onClose,
  };
}

describe("SegmentEditPopoverUI — pivot axis name", () => {
  it("renders an axis-name input for pivot segments and wires onChangeAxisName", () => {
    const { onChangeAxisName } = setup({ segment: pivotSegment() });
    const input = screen.getByRole("textbox", { name: /axis name/i });
    expect(input).toHaveValue("Quarter");
    fireEvent.change(input, { target: { value: "Region" } });
    expect(onChangeAxisName).toHaveBeenCalledWith("Region");
  });

  it("does not render an axis-name input for non-pivot segments", () => {
    setup({ segment: fieldSegment() });
    expect(
      screen.queryByRole("textbox", { name: /axis name/i })
    ).not.toBeInTheDocument();
  });

  it("autofocuses the axis-name input when the popover opens on a pivot segment", async () => {
    setup({ segment: pivotSegment() });
    const input = screen.getByRole("textbox", { name: /axis name/i });
    // useDialogAutoFocus defers focus past the popover's transition; wait
    // long enough for it to settle.
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(document.activeElement).toBe(input);
  });
});

describe("SegmentEditPopoverUI — dynamic toggle", () => {
  it("renders the dynamic toggle only on tail pivot segments", () => {
    setup({ segment: pivotSegment(), isTail: true });
    expect(
      screen.getByRole("checkbox", { name: /can this segment grow/i })
    ).toBeInTheDocument();
  });

  it("does not render the dynamic toggle on non-tail pivot segments", () => {
    setup({ segment: pivotSegment(), isTail: false });
    expect(
      screen.queryByRole("checkbox", { name: /can this segment grow/i })
    ).not.toBeInTheDocument();
  });

  it("does not render the dynamic toggle on field or skip segments even when tail", () => {
    setup({ segment: fieldSegment(), isTail: true });
    expect(
      screen.queryByRole("checkbox", { name: /can this segment grow/i })
    ).not.toBeInTheDocument();
  });

  it("toggling the switch fires onToggleDynamic(true/false)", () => {
    const { onToggleDynamic } = setup({ segment: pivotSegment(), isTail: true });
    const toggle = screen.getByRole("checkbox", {
      name: /can this segment grow/i,
    });
    fireEvent.click(toggle);
    expect(onToggleDynamic).toHaveBeenCalledWith(true);
  });
});

describe("SegmentEditPopoverUI — terminator form", () => {
  it("reveals the untilBlank form when dynamic is set with untilBlank terminator", () => {
    const dyn = pivotSegment({
      dynamic: { terminator: { kind: "untilBlank", consecutiveBlanks: 3 } },
    });
    setup({ segment: dyn, isTail: true });
    const blanksInput = screen.getByRole("spinbutton", {
      name: /segment terminator consecutive blanks/i,
    });
    expect(blanksInput).toHaveValue(3);
  });

  it("reveals the matchesPattern form when dynamic is set with matchesPattern terminator", () => {
    const dyn = pivotSegment({
      dynamic: { terminator: { kind: "matchesPattern", pattern: "^END$" } },
    });
    setup({ segment: dyn, isTail: true });
    const patternInput = screen.getByRole("textbox", {
      name: /segment terminator pattern/i,
    });
    expect(patternInput).toHaveValue("^END$");
  });

  it("flags an invalid regex as invalid in the matchesPattern form", () => {
    const dyn = pivotSegment({
      dynamic: { terminator: { kind: "matchesPattern", pattern: "(" } },
    });
    setup({ segment: dyn, isTail: true });
    const patternInput = screen.getByRole("textbox", {
      name: /segment terminator pattern/i,
    });
    expect(patternInput).toHaveAttribute("aria-invalid", "true");
  });

  it("editing the consecutiveBlanks field fires onChangeTerminator", () => {
    const dyn = pivotSegment({
      dynamic: { terminator: { kind: "untilBlank", consecutiveBlanks: 2 } },
    });
    const { onChangeTerminator } = setup({ segment: dyn, isTail: true });
    const input = screen.getByRole("spinbutton", {
      name: /segment terminator consecutive blanks/i,
    });
    fireEvent.change(input, { target: { value: "5" } });
    expect(onChangeTerminator).toHaveBeenCalledWith({
      kind: "untilBlank",
      consecutiveBlanks: 5,
    });
  });
});

describe("SegmentEditPopoverUI — convert buttons", () => {
  it("renders convert-to buttons and emits onConvert(toKind)", () => {
    const { onConvert } = setup({ segment: fieldSegment() });
    // "Convert to" group renders Field/Pivot/Skip; current kind is disabled.
    const group = screen
      .getByText(/convert to/i)
      .closest("div") as HTMLElement;
    const pivotBtn = within(group).getByRole("button", { name: /pivot/i });
    fireEvent.click(pivotBtn);
    expect(onConvert).toHaveBeenCalledWith("pivot");
  });

  it("disables the convert button for the segment's current kind", () => {
    setup({ segment: skipSegment() });
    const group = screen
      .getByText(/convert to/i)
      .closest("div") as HTMLElement;
    const skipBtn = within(group).getByRole("button", { name: /skip/i });
    expect(skipBtn).toBeDisabled();
  });
});

describe("SegmentEditPopoverUI — field headers", () => {
  it("renders one header input per position for field segments", () => {
    setup({
      segment: { kind: "field", positionCount: 3 },
      cellPlaceholders: ["", "name", "desc"],
    });
    expect(
      screen.getByRole("textbox", { name: /field header for position 1/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /field header for position 2/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /field header for position 3/i })
    ).toBeInTheDocument();
  });

  it("does not render header inputs for non-field segments", () => {
    setup({ segment: pivotSegment() });
    expect(
      screen.queryByRole("textbox", { name: /field header for position 1/i })
    ).not.toBeInTheDocument();
  });

  it("editing a header position fires onChangeHeaders with that index updated", () => {
    const { onChangeHeaders } = setup({
      segment: { kind: "field", positionCount: 3 },
      cellPlaceholders: ["", "name", "desc"],
    });
    const input = screen.getByRole("textbox", {
      name: /field header for position 1/i,
    });
    fireEvent.change(input, { target: { value: "year" } });
    expect(onChangeHeaders).toHaveBeenCalledWith(["year", "", ""]);
  });

  it("seeds the editor from existing segment headers", () => {
    setup({
      segment: { kind: "field", positionCount: 2, headers: ["year", ""] },
      cellPlaceholders: ["", "name"],
    });
    expect(
      screen.getByRole("textbox", { name: /field header for position 1/i })
    ).toHaveValue("year");
    expect(
      screen.getByRole("textbox", { name: /field header for position 2/i })
    ).toHaveValue("");
  });

  it("clearing the last override emits undefined to drop the headers field", () => {
    const { onChangeHeaders } = setup({
      segment: { kind: "field", positionCount: 2, headers: ["year", ""] },
      cellPlaceholders: ["", "name"],
    });
    const input = screen.getByRole("textbox", {
      name: /field header for position 1/i,
    });
    fireEvent.change(input, { target: { value: "" } });
    expect(onChangeHeaders).toHaveBeenCalledWith(undefined);
  });

  it("autofocuses the first blank-cell position", async () => {
    setup({
      segment: { kind: "field", positionCount: 3 },
      cellPlaceholders: ["name", "", "desc"],
    });
    const input = screen.getByRole("textbox", {
      name: /field header for position 2/i,
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(document.activeElement).toBe(input);
  });

  it("falls back to position 0 when every cell already has a label", async () => {
    setup({
      segment: { kind: "field", positionCount: 3 },
      cellPlaceholders: ["year", "name", "desc"],
    });
    const input = screen.getByRole("textbox", {
      name: /field header for position 1/i,
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(document.activeElement).toBe(input);
  });
});

describe("SegmentEditPopoverUI — field skip checkbox", () => {
  it("renders one Skip checkbox per position when onChangeSkipped is provided", () => {
    setup({
      segment: { kind: "field", positionCount: 3 },
      cellPlaceholders: ["", "name", "desc"],
    });
    expect(
      screen.getByRole("checkbox", { name: /skip field at position 1/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /skip field at position 2/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /skip field at position 3/i })
    ).toBeInTheDocument();
  });

  it("checking a position fires onChangeSkipped with that index flipped to true", () => {
    const { onChangeSkipped } = setup({
      segment: { kind: "field", positionCount: 3 },
      cellPlaceholders: ["", "name", "desc"],
    });
    const checkbox = screen.getByRole("checkbox", {
      name: /skip field at position 2/i,
    });
    fireEvent.click(checkbox);
    expect(onChangeSkipped).toHaveBeenCalledWith([false, true, false]);
  });

  it("unchecking the last skipped position emits undefined to drop the array", () => {
    const { onChangeSkipped } = setup({
      segment: {
        kind: "field",
        positionCount: 3,
        skipped: [false, true, false],
      },
    });
    const checkbox = screen.getByRole("checkbox", {
      name: /skip field at position 2/i,
    });
    fireEvent.click(checkbox);
    expect(onChangeSkipped).toHaveBeenCalledWith(undefined);
  });

  it("disables the header input when its position is skipped", () => {
    setup({
      segment: {
        kind: "field",
        positionCount: 2,
        skipped: [false, true],
      },
      cellPlaceholders: ["year", "name"],
    });
    expect(
      screen.getByRole("textbox", { name: /field header for position 1/i })
    ).not.toBeDisabled();
    expect(
      screen.getByRole("textbox", { name: /field header for position 2/i })
    ).toBeDisabled();
  });

  it("does not render skip checkboxes when onChangeSkipped is not provided", () => {
    const onChangeHeaders = jest.fn<(h: string[] | undefined) => void>();
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    render(
      <SegmentEditPopoverUI
        open
        anchorEl={anchor}
        axis="row"
        segment={{ kind: "field", positionCount: 2 }}
        isTail
        cellPlaceholders={["a", "b"]}
        onChangeAxisName={jest.fn()}
        onChangeHeaders={onChangeHeaders}
        onToggleDynamic={jest.fn()}
        onChangeTerminator={jest.fn()}
        onConvert={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(
      screen.queryByRole("checkbox", { name: /skip field at position 1/i })
    ).not.toBeInTheDocument();
  });
});

describe("SegmentEditPopoverUI — delete button", () => {
  it("does not render the delete button when onRemove is not provided", () => {
    setup();
    expect(
      screen.queryByRole("button", { name: /delete segment/i })
    ).not.toBeInTheDocument();
  });

  it("renders and fires onRemove when onRemove is provided", () => {
    const onRemove = jest.fn();
    setup({ onRemove });
    const btn = screen.getByRole("button", { name: /delete segment/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("disables the delete button when canRemove is false", () => {
    const onRemove = jest.fn();
    setup({ onRemove, canRemove: false });
    const btn = screen.getByRole("button", { name: /delete segment/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onRemove).not.toHaveBeenCalled();
  });
});

describe("SegmentEditPopoverUI — Enter to dismiss", () => {
  it("Enter inside the axis-name input fires onClose (commit-and-close affordance)", () => {
    const { onClose } = setup({ segment: pivotSegment() });
    const input = screen.getByRole("textbox", { name: /axis name/i });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Enter inside a field-header input fires onClose", () => {
    const { onClose } = setup({
      segment: { kind: "field", positionCount: 2 },
      cellPlaceholders: ["", "name"],
    });
    const input = screen.getByRole("textbox", {
      name: /field header for position 1/i,
    });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Enter on a Convert-to button activates it instead of dismissing", () => {
    const { onConvert, onClose } = setup({ segment: fieldSegment() });
    const group = screen
      .getByText(/convert to/i)
      .closest("div") as HTMLElement;
    const pivotBtn = within(group).getByRole("button", { name: /pivot/i });
    // jsdom synthesizes a click for keyboard activation; emulate by
    // clicking through the same handler the browser would call.
    pivotBtn.focus();
    fireEvent.keyDown(pivotBtn, { key: "Enter" });
    fireEvent.click(pivotBtn);
    expect(onConvert).toHaveBeenCalledWith("pivot");
    // Enter on the button reaches Stack's onKeyDown but we skip the
    // close path for BUTTON targets so the click activation wins.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("modifier-held Enter (e.g. Shift+Enter) is ignored — leaves the popover open", () => {
    const { onClose } = setup({ segment: pivotSegment() });
    const input = screen.getByRole("textbox", { name: /axis name/i });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onClose).not.toHaveBeenCalled();
  });
});
