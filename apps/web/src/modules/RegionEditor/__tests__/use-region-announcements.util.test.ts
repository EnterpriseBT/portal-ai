import { jest } from "@jest/globals";
import { act, renderHook } from "@testing-library/react";

import { REANNOUNCE_GAP_MS } from "../../../utils/live-region.util";
import {
  KEYBOARD_HINT,
  SELECTION_SETTLE_MS,
  useRegionAnnouncements,
} from "../utils/use-region-announcements.util";
import type { RegionDraft } from "../utils/region-editor.types";

const region = (id: string, endRow = 3): RegionDraft => ({
  id,
  sheetId: "s1",
  bounds: { startRow: 0, endRow, startCol: 0, endCol: 2 },
  targetEntityDefinitionId: id === "r1" ? "ent_a" : "ent_b",
  targetEntityLabel: id === "r1" ? "Customers" : "Orders",
});

const describe_ = (r: RegionDraft) =>
  `${r.targetEntityLabel}, A1:C${r.bounds.endRow + 1}`;

function setup(
  regions: RegionDraft[] = [],
  selectedRegionId: string | null = null
) {
  return renderHook(
    (props: { regions: RegionDraft[]; selectedRegionId: string | null }) =>
      useRegionAnnouncements({ ...props, describe: describe_ }),
    { initialProps: { regions, selectedRegionId } }
  );
}

const settle = (ms = REANNOUNCE_GAP_MS) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

describe("useRegionAnnouncements (#795)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("says nothing on mount", () => {
    const { result } = setup([region("r1")], "r1");
    settle();
    expect(result.current.announcement).toBe("");
  });

  test("a created region is announced once, even when it's also selected", () => {
    const { result, rerender } = setup();
    rerender({ regions: [region("r1")], selectedRegionId: "r1" });
    settle();
    expect(result.current.announcement).toBe(
      "Region created: Customers, A1:C4"
    );
  });

  test("a deleted region is announced", () => {
    const { result, rerender } = setup([region("r1")], "r1");
    rerender({ regions: [], selectedRegionId: null });
    settle();
    expect(result.current.announcement).toBe("Region deleted");
  });

  test("new bounds are announced", () => {
    const { result, rerender } = setup([region("r1")], "r1");
    rerender({ regions: [region("r1", 9)], selectedRegionId: "r1" });
    settle();
    expect(result.current.announcement).toBe("Bounds A1:C10");
  });

  test("selecting a region names it; deselecting says nothing", () => {
    const { result, rerender } = setup([region("r1"), region("r2")], null);
    rerender({ regions: [region("r1"), region("r2")], selectedRegionId: "r2" });
    settle();
    expect(result.current.announcement).toBe("Orders, A1:C4 selected");
    rerender({ regions: [region("r1"), region("r2")], selectedRegionId: null });
    settle();
    expect(result.current.announcement).toBe("Orders, A1:C4 selected");
  });

  test("the keyboard selection's extent is read once it settles", () => {
    const { result } = setup();
    act(() => {
      result.current.announceSelection({
        startRow: 0,
        endRow: 0,
        startCol: 0,
        endCol: 1,
      });
      result.current.announceSelection({
        startRow: 0,
        endRow: 8,
        startCol: 0,
        endCol: 3,
      });
    });
    settle(SELECTION_SETTLE_MS - 1);
    expect(result.current.announcement).toBe("");
    settle(1 + REANNOUNCE_GAP_MS);
    expect(result.current.announcement).toBe("A1 to D9 selected");
    act(() => {
      result.current.announceSelection({
        startRow: 2,
        endRow: 2,
        startCol: 1,
        endCol: 1,
      });
    });
    settle(SELECTION_SETTLE_MS + REANNOUNCE_GAP_MS);
    expect(result.current.announcement).toBe("B3 selected");
  });

  test("a cleared selection cancels a pending read", () => {
    const { result } = setup();
    act(() => {
      result.current.announceSelection({
        startRow: 0,
        endRow: 1,
        startCol: 0,
        endCol: 1,
      });
      result.current.announceSelection(null);
    });
    settle(SELECTION_SETTLE_MS + REANNOUNCE_GAP_MS);
    expect(result.current.announcement).toBe("");
  });

  test("the keyboard hint is said once", () => {
    const { result } = setup();
    act(() => result.current.announceHint());
    settle();
    expect(result.current.announcement).toBe(KEYBOARD_HINT);
    act(() =>
      result.current.announceSelection({
        startRow: 0,
        endRow: 0,
        startCol: 0,
        endCol: 0,
      })
    );
    settle(SELECTION_SETTLE_MS + REANNOUNCE_GAP_MS);
    act(() => result.current.announceHint());
    settle();
    expect(result.current.announcement).toBe("A1 selected");
  });
});
