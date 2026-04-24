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
