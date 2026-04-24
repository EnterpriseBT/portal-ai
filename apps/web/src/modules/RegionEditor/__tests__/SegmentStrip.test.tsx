import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AxisMember, Segment } from "@portalai/core/contracts";

import {
  SegmentStripUI,
  type SegmentStripUIProps,
} from "../SegmentStrip.component";

function setup(overrides: Partial<SegmentStripUIProps> = {}) {
  const onEditSegment =
    jest.fn<
      (axis: AxisMember, segmentIndex: number, anchor: HTMLElement) => void
    >();
  const onAddSegment =
    jest.fn<(axis: AxisMember, kind: Segment["kind"]) => void>();
  const onAddHeaderAxis = jest.fn<(otherAxis: AxisMember) => void>();
  const baseSegments: Segment[] = [
    { kind: "field", positionCount: 3 },
    {
      kind: "pivot",
      id: "p1",
      axisName: "Quarter",
      axisNameSource: "user",
      positionCount: 2,
    },
    { kind: "skip", positionCount: 1 },
  ];
  const props: SegmentStripUIProps = {
    axis: "row",
    segments: baseSegments,
    onEditSegment,
    onAddSegment,
    onAddHeaderAxis,
    ...overrides,
  };
  const utils = render(<SegmentStripUI {...props} />);
  return { ...utils, onEditSegment, onAddSegment, onAddHeaderAxis };
}

describe("SegmentStripUI", () => {
  it("renders one chip per segment showing kind + positionCount", () => {
    setup();
    expect(
      screen.getByRole("button", { name: /edit row segment 1 \(field\)/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /edit row segment 2 \(pivot\)/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /edit row segment 3 \(skip\)/i })
    ).toBeInTheDocument();
    // Pivot chip surfaces the axis name; field/skip chips surface their kind
    // label. Counts render as ×N.
    expect(screen.getByText("Quarter")).toBeInTheDocument();
    expect(screen.getByText("Field")).toBeInTheDocument();
    expect(screen.getByText("Skip")).toBeInTheDocument();
    expect(screen.getByText("×3")).toBeInTheDocument();
    expect(screen.getByText("×2")).toBeInTheDocument();
    expect(screen.getByText("×1")).toBeInTheDocument();
  });

  it("marks dynamic pivot chips as growing", () => {
    setup({
      segments: [
        {
          kind: "pivot",
          id: "p1",
          axisName: "Q",
          axisNameSource: "user",
          positionCount: 2,
          dynamic: { terminator: { kind: "untilBlank", consecutiveBlanks: 2 } },
        },
      ],
    });
    // Visible cue for sighted users.
    expect(screen.getByText(/grows/i)).toBeInTheDocument();
    // Legacy "· ∞" suffix is kept for screen readers.
    expect(screen.getByText(/q · 2 · ∞/i)).toBeInTheDocument();
  });

  it("renders a cell-range badge when axisStart is provided", () => {
    setup({
      axis: "row",
      axisStart: 1,
      segments: [
        { kind: "field", positionCount: 3 },
        { kind: "skip", positionCount: 1 },
      ],
    });
    // Row-axis segments starting at column 1 (B): field covers B–D, skip covers E.
    expect(screen.getByText(/B–D/)).toBeInTheDocument();
    expect(screen.getByText(/^E$/)).toBeInTheDocument();
  });

  it("renders row numbers for column-axis cell-range", () => {
    setup({
      axis: "column",
      axisStart: 2,
      segments: [{ kind: "field", positionCount: 2 }],
    });
    // Column-axis segments starting at row 2 (1-indexed row 3): covers rows 3–4.
    expect(screen.getByText(/3–4/)).toBeInTheDocument();
  });

  it("omits the cell-range badge when axisStart is not provided", () => {
    setup({ axis: "row" });
    // No stray A–Z range text should appear in any chip.
    expect(screen.queryByText(/^[A-Z]–[A-Z]$/)).not.toBeInTheDocument();
  });

  it("clicking a chip calls onEditSegment(axis, index, anchor)", () => {
    const { onEditSegment } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: /edit row segment 2/i })
    );
    expect(onEditSegment).toHaveBeenCalledTimes(1);
    const [axis, idx, anchor] = onEditSegment.mock.calls[0];
    expect(axis).toBe("row");
    expect(idx).toBe(1);
    expect(anchor).toBeInstanceOf(HTMLElement);
  });

  it("renders a per-kind add button that forwards onAddSegment(axis, kind)", () => {
    const { onAddSegment } = setup({ axis: "column" });
    fireEvent.click(
      screen.getByRole("button", { name: /add column field segment/i })
    );
    expect(onAddSegment).toHaveBeenLastCalledWith("column", "field");
    fireEvent.click(
      screen.getByRole("button", { name: /add column pivot segment/i })
    );
    expect(onAddSegment).toHaveBeenLastCalledWith("column", "pivot");
    fireEvent.click(
      screen.getByRole("button", { name: /add column skip segment/i })
    );
    expect(onAddSegment).toHaveBeenLastCalledWith("column", "skip");
  });

  it("disables add buttons when every segment already occupies a single position", () => {
    const { onAddSegment } = setup({
      segments: [
        { kind: "field", positionCount: 1 },
        { kind: "skip", positionCount: 1 },
      ],
    });
    const fieldBtn = screen.getByRole("button", {
      name: /add row field segment/i,
    });
    expect(fieldBtn).toBeDisabled();
    fireEvent.click(fieldBtn);
    expect(onAddSegment).not.toHaveBeenCalled();
  });

  it("keeps add buttons enabled when at least one segment has spare positions", () => {
    setup({
      segments: [
        { kind: "field", positionCount: 1 },
        { kind: "skip", positionCount: 2 },
      ],
    });
    expect(
      screen.getByRole("button", { name: /add row field segment/i })
    ).toBeEnabled();
  });

  it("renders a delete X on each chip that fires onRemoveSegment without opening the popover", () => {
    const onRemoveSegment =
      jest.fn<(axis: AxisMember, index: number) => void>();
    const { onEditSegment } = setup({ onRemoveSegment });
    const deleteBtn = screen.getByLabelText(/delete row segment 2/i);
    fireEvent.click(deleteBtn);
    expect(onRemoveSegment).toHaveBeenCalledWith("row", 1);
    // The chip's own click handler should not have run.
    expect(onEditSegment).not.toHaveBeenCalled();
  });

  it("renders the delete X even when the axis has only one segment", () => {
    const onRemoveSegment =
      jest.fn<(axis: AxisMember, index: number) => void>();
    setup({
      segments: [{ kind: "field", positionCount: 3 }],
      onRemoveSegment,
    });
    const deleteBtn = screen.getByLabelText(/delete row segment 1/i);
    fireEvent.click(deleteBtn);
    expect(onRemoveSegment).toHaveBeenCalledWith("row", 0);
  });

  it("omits the delete X when onRemoveSegment is not provided", () => {
    setup({ onRemoveSegment: undefined });
    expect(
      screen.queryByLabelText(/delete row segment/i)
    ).not.toBeInTheDocument();
  });

  it("renders the Add header axis button and emits onAddHeaderAxis(otherAxis) when provided", () => {
    const { onAddHeaderAxis } = setup({ axis: "row" });
    const btn = screen.getByRole("button", {
      name: /add column header axis/i,
    });
    fireEvent.click(btn);
    expect(onAddHeaderAxis).toHaveBeenCalledWith("column");
  });

  it("omits the Add header axis button when the callback is not provided", () => {
    setup({ axis: "row", onAddHeaderAxis: undefined });
    expect(
      screen.queryByRole("button", { name: /add column header axis/i })
    ).not.toBeInTheDocument();
  });
});
