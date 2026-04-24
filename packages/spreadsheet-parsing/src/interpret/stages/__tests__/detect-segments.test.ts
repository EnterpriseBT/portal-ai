import { describe, it, expect } from "@jest/globals";

import {
  EXPECTATIONS,
  MATRIX_IDS,
  matrixInput,
} from "../../../__tests__/fixtures/segment-expectations.js";
import type { InterpretInput } from "../../../plan/index.js";
import { createInitialState } from "../../state.js";
import type { InterpretState } from "../../types.js";
import { detectHeaders } from "../detect-headers.js";
import { detectIdentity } from "../detect-identity.js";
import { detectRegions } from "../detect-regions.js";
import { detectSegments } from "../detect-segments.js";

function runUpToDetectIdentity(input: InterpretInput): InterpretState {
  let state = createInitialState(input);
  state = detectRegions(state);
  state = detectHeaders(state);
  state = detectIdentity(state);
  return state;
}

describe("detect-segments — matrix coverage", () => {
  it.each([...MATRIX_IDS])("produces expected segments for %s", (id) => {
    const state = runUpToDetectIdentity(matrixInput(id));
    const after = detectSegments(state);
    const regionId = state.detectedRegions[0].id;
    const expected = EXPECTATIONS[id];
    expect(after.segmentsByRegion.get(regionId)).toEqual(
      expected.segmentsByAxis
    );
    if (expected.cellValueField) {
      expect(after.cellValueFieldByRegion.get(regionId)).toEqual(
        expected.cellValueField
      );
    } else {
      expect(after.cellValueFieldByRegion.get(regionId)).toBeUndefined();
    }
  });
});

describe("detect-segments — headerless skip", () => {
  it("does not populate segmentsByRegion / cellValueFieldByRegion for headerless regions", () => {
    const state = runUpToDetectIdentity(matrixInput("headerless-rows"));
    const after = detectSegments(state);
    const regionId = state.detectedRegions[0].id;
    expect(after.segmentsByRegion.has(regionId)).toBe(false);
    expect(after.cellValueFieldByRegion.has(regionId)).toBe(false);
  });
});

describe("detect-segments — purity", () => {
  it("returns structurally equal output on repeated invocations", () => {
    const state = runUpToDetectIdentity(matrixInput("1e"));
    const first = detectSegments(state);
    const second = detectSegments(first);
    expect(second.segmentsByRegion).toEqual(first.segmentsByRegion);
    expect(second.cellValueFieldByRegion).toEqual(first.cellValueFieldByRegion);
  });

  it("does not mutate the input state's maps", () => {
    const state = runUpToDetectIdentity(matrixInput("1e"));
    const snapshotBefore = new Map(state.segmentsByRegion);
    const snapshotFieldBefore = new Map(state.cellValueFieldByRegion);
    detectSegments(state);
    expect(state.segmentsByRegion).toEqual(snapshotBefore);
    expect(state.cellValueFieldByRegion).toEqual(snapshotFieldBefore);
  });
});
