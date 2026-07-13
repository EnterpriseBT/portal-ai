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

async function runUpToDetectIdentity(
  input: InterpretInput
): Promise<InterpretState> {
  let state = createInitialState(input);
  state = detectRegions(state);
  state = await detectHeaders(state);
  state = await detectIdentity(state);
  return state;
}

describe("detect-segments — matrix coverage", () => {
  it.each([...MATRIX_IDS])("produces expected segments for %s", async (id) => {
    const state = await runUpToDetectIdentity(matrixInput(id));
    const after = await detectSegments(state);
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
  it("does not populate segmentsByRegion / cellValueFieldByRegion for headerless regions", async () => {
    const state = await runUpToDetectIdentity(matrixInput("headerless-rows"));
    const after = await detectSegments(state);
    const regionId = state.detectedRegions[0].id;
    expect(after.segmentsByRegion.has(regionId)).toBe(false);
    expect(after.cellValueFieldByRegion.has(regionId)).toBe(false);
  });
});

describe("detect-segments — purity", () => {
  it("returns structurally equal output on repeated invocations", async () => {
    const state = await runUpToDetectIdentity(matrixInput("1e"));
    const first = await detectSegments(state);
    const second = await detectSegments(first);
    expect(second.segmentsByRegion).toEqual(first.segmentsByRegion);
    expect(second.cellValueFieldByRegion).toEqual(first.cellValueFieldByRegion);
  });

  it("does not mutate the input state's maps", async () => {
    const state = await runUpToDetectIdentity(matrixInput("1e"));
    const snapshotBefore = new Map(state.segmentsByRegion);
    const snapshotFieldBefore = new Map(state.cellValueFieldByRegion);
    await detectSegments(state);
    expect(state.segmentsByRegion).toEqual(snapshotBefore);
    expect(state.cellValueFieldByRegion).toEqual(snapshotFieldBefore);
  });
});
