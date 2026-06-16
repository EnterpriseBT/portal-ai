import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { z } from "zod";

import { COMPUTE_MAX_ROWS } from "@portalai/core/constants";

import { ApiCode } from "../../constants/api-codes.constants.js";

// Mock the handle service — the only I/O the helper performs.
const mockGetSnapshot = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule("../../services/portal-sql-handle.service.js", () => ({
  PortalSqlHandleService: { getSnapshot: mockGetSnapshot },
}));

const { resolveComputeRecords, withComputeInput } = await import(
  "../../tools/compute-input.util.js"
);

describe("resolveComputeRecords", () => {
  beforeEach(() => {
    mockGetSnapshot.mockReset();
  });

  // Case 1
  it("passes inline rows through without touching the handle service", async () => {
    const rows = [{ a: 1 }, { a: 2 }];
    await expect(resolveComputeRecords({ rows })).resolves.toEqual(rows);
    expect(mockGetSnapshot).not.toHaveBeenCalled();
  });

  // Case 1 (over-cap)
  it("rejects inline rows over COMPUTE_MAX_ROWS", async () => {
    const rows = Array.from({ length: COMPUTE_MAX_ROWS + 1 }, () => ({}));
    await expect(resolveComputeRecords({ rows })).rejects.toMatchObject({
      code: ApiCode.COMPUTE_INPUT_TOO_LARGE,
    });
    expect(mockGetSnapshot).not.toHaveBeenCalled();
  });

  // Case 2
  it("resolves a handle within the cap via getSnapshot", async () => {
    const rows = [{ x: 10 }, { x: 20 }];
    mockGetSnapshot.mockResolvedValue({
      rows,
      total: 2,
      offset: 0,
      limit: COMPUTE_MAX_ROWS,
    });
    await expect(
      resolveComputeRecords({ queryHandle: "qh-1" })
    ).resolves.toEqual(rows);
    expect(mockGetSnapshot).toHaveBeenCalledWith("qh-1", {
      offset: 0,
      limit: COMPUTE_MAX_ROWS,
    });
  });

  // Case 3
  it("rejects a handle whose total exceeds the cap (truncated set)", async () => {
    mockGetSnapshot.mockResolvedValue({
      rows: [],
      total: COMPUTE_MAX_ROWS + 1,
      offset: 0,
      limit: COMPUTE_MAX_ROWS,
    });
    await expect(
      resolveComputeRecords({ queryHandle: "qh-big" })
    ).rejects.toMatchObject({ code: ApiCode.COMPUTE_INPUT_TOO_LARGE });
  });

  // Case 4
  it("propagates an expired-handle error from getSnapshot", async () => {
    mockGetSnapshot.mockRejectedValue(
      Object.assign(new Error("expired"), {
        code: ApiCode.READ_HANDLE_EXPIRED,
      })
    );
    await expect(
      resolveComputeRecords({ queryHandle: "qh-gone" })
    ).rejects.toMatchObject({ code: ApiCode.READ_HANDLE_EXPIRED });
  });
});

describe("withComputeInput", () => {
  const schema = withComputeInput({ column: z.string() });

  // Case 5
  it("accepts exactly a queryHandle", () => {
    expect(
      schema.safeParse({ queryHandle: "qh-1", column: "amount" }).success
    ).toBe(true);
  });

  it("accepts exactly inline rows", () => {
    expect(
      schema.safeParse({ rows: [{ amount: 1 }], column: "amount" }).success
    ).toBe(true);
  });

  it("rejects neither queryHandle nor rows", () => {
    expect(schema.safeParse({ column: "amount" }).success).toBe(false);
  });

  it("rejects both queryHandle and rows", () => {
    expect(
      schema.safeParse({
        queryHandle: "qh",
        rows: [{}],
        column: "amount",
      }).success
    ).toBe(false);
  });
});
