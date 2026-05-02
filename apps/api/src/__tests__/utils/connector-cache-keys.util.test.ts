import { describe, it, expect } from "@jest/globals";

import {
  accessTokenCacheKey,
  workbookCacheKey,
} from "../../utils/connector-cache-keys.util.js";

describe("workbookCacheKey", () => {
  it("formats `connector:wb:<slug>:<id>`", () => {
    expect(workbookCacheKey("google-sheets", "ci-1")).toBe(
      "connector:wb:google-sheets:ci-1"
    );
    expect(workbookCacheKey("microsoft-excel", "ci-2")).toBe(
      "connector:wb:microsoft-excel:ci-2"
    );
  });

  it("refuses an empty slug", () => {
    expect(() => workbookCacheKey("", "ci-1")).toThrow(/slug/);
  });

  it("refuses an empty connectorInstanceId", () => {
    expect(() => workbookCacheKey("google-sheets", "")).toThrow(
      /connectorInstanceId/
    );
  });
});

describe("accessTokenCacheKey", () => {
  it("formats `connector:access:<slug>:<id>`", () => {
    expect(accessTokenCacheKey("google-sheets", "ci-1")).toBe(
      "connector:access:google-sheets:ci-1"
    );
    expect(accessTokenCacheKey("microsoft-excel", "ci-2")).toBe(
      "connector:access:microsoft-excel:ci-2"
    );
  });

  it("refuses an empty slug", () => {
    expect(() => accessTokenCacheKey("", "ci-1")).toThrow(/slug/);
  });

  it("refuses an empty connectorInstanceId", () => {
    expect(() => accessTokenCacheKey("google-sheets", "")).toThrow(
      /connectorInstanceId/
    );
  });
});
