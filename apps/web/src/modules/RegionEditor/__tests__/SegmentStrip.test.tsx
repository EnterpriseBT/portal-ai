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
    jest.fn<(axis: AxisMember, segmentIndex: number) => void>();
  const onAddSegment = jest.fn<(axis: AxisMember) => void>();
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
    // Pivot chip surfaces the axis name and positionCount.
    expect(screen.getByText(/quarter · 2/i)).toBeInTheDocument();
    // Field chip surfaces kind + positionCount.
    expect(screen.getByText(/field · 3/i)).toBeInTheDocument();
  });

  it("renders a ∞ suffix on dynamic pivot chips", () => {
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
    expect(screen.getByText(/q · 2 · ∞/i)).toBeInTheDocument();
  });

  it("clicking a chip calls onEditSegment(axis, index)", () => {
    const { onEditSegment } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: /edit row segment 2/i })
    );
    expect(onEditSegment).toHaveBeenCalledWith("row", 1);
  });

  it("clicking Add segment calls onAddSegment(axis)", () => {
    const { onAddSegment } = setup({ axis: "column" });
    fireEvent.click(
      screen.getByRole("button", { name: /add column segment/i })
    );
    expect(onAddSegment).toHaveBeenCalledWith("column");
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
