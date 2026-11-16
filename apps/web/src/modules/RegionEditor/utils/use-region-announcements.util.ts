import { useCallback, useEffect, useRef } from "react";

import { useLiveAnnouncement } from "../../../utils/live-region.util";
import { formatBounds, formatCell } from "./a1-notation.util";
import type { CellBounds, RegionDraft } from "./region-editor.types";

/** How long the keyboard selection settles before its extent is read. */
export const SELECTION_SETTLE_MS = 400;

export const KEYBOARD_HINT =
  "Select cells with Shift and the arrow keys, then press Enter to add a region";

const sameBounds = (a: CellBounds, b: CellBounds) =>
  a.startRow === b.startRow &&
  a.endRow === b.endRow &&
  a.startCol === b.startCol &&
  a.endCol === b.endCol;

/**
 * What a screen reader hears as regions change in the editor (#795):
 * created, deleted, resized and selected regions, the keyboard selection's
 * extent, and a one-time hint for Enter on an empty cell. Feed
 * `announcement` to a hidden `StatusMessage`.
 */
export function useRegionAnnouncements({
  regions,
  selectedRegionId,
  describe,
}: {
  regions: RegionDraft[];
  selectedRegionId: string | null;
  describe: (region: RegionDraft) => string;
}): {
  announcement: string;
  announceSelection: (bounds: CellBounds | null) => void;
  announceHint: () => void;
} {
  const { announcement, say } = useLiveAnnouncement();
  const prevRegions = useRef(regions);
  const prevSelected = useRef(selectedRegionId);
  const describeRef = useRef(describe);
  useEffect(() => {
    describeRef.current = describe;
  }, [describe]);

  useEffect(() => {
    const before = new Map(prevRegions.current.map((r) => [r.id, r]));
    const afterIds = new Set(regions.map((r) => r.id));
    const selectionChanged = prevSelected.current !== selectedRegionId;
    prevRegions.current = regions;
    prevSelected.current = selectedRegionId;

    const created = regions.filter((r) => !before.has(r.id));
    const deleted = [...before.keys()].filter((id) => !afterIds.has(id));
    // The most significant change wins: a create usually selects the new
    // region too, and that's one event to the user.
    if (created.length === 1) {
      say(`Region created: ${describeRef.current(created[0])}`);
      return;
    }
    if (created.length > 1) {
      say(`${created.length} regions created`);
      return;
    }
    if (deleted.length > 0) {
      say(
        deleted.length === 1
          ? "Region deleted"
          : `${deleted.length} regions deleted`
      );
      return;
    }
    const resized = regions.find((r) => {
      const old = before.get(r.id);
      return old && !sameBounds(old.bounds, r.bounds);
    });
    if (resized) {
      say(`Bounds ${formatBounds(resized.bounds)}`);
      return;
    }
    if (selectionChanged && selectedRegionId) {
      const region = regions.find((r) => r.id === selectedRegionId);
      if (region) say(`${describeRef.current(region)} selected`);
    }
  }, [regions, selectedRegionId, say]);

  const selectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (selectionTimer.current) clearTimeout(selectionTimer.current);
    },
    []
  );
  const announceSelection = useCallback(
    (bounds: CellBounds | null) => {
      if (selectionTimer.current) clearTimeout(selectionTimer.current);
      if (!bounds) return;
      selectionTimer.current = setTimeout(() => {
        const start = formatCell({
          row: bounds.startRow,
          col: bounds.startCol,
        });
        const end = formatCell({ row: bounds.endRow, col: bounds.endCol });
        say(
          start === end ? `${start} selected` : `${start} to ${end} selected`
        );
      }, SELECTION_SETTLE_MS);
    },
    [say]
  );

  const hinted = useRef(false);
  const announceHint = useCallback(() => {
    if (hinted.current) return;
    hinted.current = true;
    say(KEYBOARD_HINT);
  }, [say]);

  return { announcement, announceSelection, announceHint };
}
