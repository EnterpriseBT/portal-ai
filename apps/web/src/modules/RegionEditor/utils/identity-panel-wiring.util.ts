/**
 * Container-side helpers that bridge the IdentityPanel's pure `IdentityChange`
 * shape to the workflow harness's `onRegionUpdate(regionId, partial)` API.
 *
 * Two functions, both pure:
 *
 * - `resolveLocatorOptionsFor(workbook, region)` — find the sheet matching
 *   `region.sheetId` and run `computeLocatorOptions(region, sheet)`. Returns
 *   `[]` when the workbook is null or the sheet isn't loaded so the
 *   IdentityPanel hides cleanly mid-flow.
 *
 * - `buildIdentityUpdater(args)` — closes over the workbook + regions +
 *   `onRegionUpdate` and returns a callback suitable for `ReviewStepUI`'s
 *   `onIdentityUpdate`. Translates an `IdentityChange` into the
 *   corresponding `Partial<RegionDraft>` patch with `identityStrategy.source
 *   = "user"` so `regionDraftsToHints` round-trips the lock to the next
 *   interpret pass.
 */

import {
  computeLocatorOptions,
  type LocatorOption,
} from "./identity-locator-options.util";
import type { RegionDraft, Workbook } from "./region-editor.types";
import type { IdentityChange } from "../IdentityPanel.component";

export function resolveLocatorOptionsFor(
  workbook: Workbook | null | undefined,
  region: RegionDraft
): LocatorOption[] {
  if (!workbook) return [];
  const sheet = workbook.sheets.find((s) => s.id === region.sheetId);
  if (!sheet) return [];
  return computeLocatorOptions(region, sheet);
}

export interface IdentityUpdaterArgs {
  workbook: Workbook | null | undefined;
  regions: RegionDraft[];
  onRegionUpdate: (regionId: string, updates: Partial<RegionDraft>) => void;
}

export function buildIdentityUpdater(
  args: IdentityUpdaterArgs
): (regionId: string, change: IdentityChange) => void {
  const { workbook, regions, onRegionUpdate } = args;
  return (regionId, change) => {
    if (change.kind === "rowPosition") {
      onRegionUpdate(regionId, {
        identityStrategy: {
          kind: "rowPosition",
          source: "user",
          confidence: 0,
        },
      });
      return;
    }
    // change.kind === "column" — translate (axis, 0-indexed index) into a
    // structured backend Locator (1-indexed) with the region's sheet name.
    const region = regions.find((r) => r.id === regionId);
    if (!region || !workbook) return;
    const sheet = workbook.sheets.find((s) => s.id === region.sheetId);
    const sheetName = sheet?.name ?? "";
    const rawLocator =
      change.locator.axis === "column"
        ? {
            kind: "column" as const,
            sheet: sheetName,
            col: change.locator.index + 1,
          }
        : {
            kind: "row" as const,
            sheet: sheetName,
            row: change.locator.index + 1,
          };
    onRegionUpdate(regionId, {
      identityStrategy: {
        kind: "column",
        source: "user",
        confidence: 0.7,
        rawLocator,
      },
    });
  };
}
