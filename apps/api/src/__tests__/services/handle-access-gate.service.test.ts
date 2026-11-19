import { describe, it, expect, jest } from "@jest/globals";

import { ApiCode } from "../../constants/api-codes.constants.js";
import { ApiError } from "../../services/http.service.js";

const { wrapWithHandleAccessGate, findHandleIds } =
  await import("../../services/handle-access-gate.service.js");

/**
 * #1038 (adversarial A): a tool that reads a query handle by id read its rows
 * with no org, owner or access check, so a member whose view was revoked
 * could still feed their own live handle (its id is in their history) to a
 * compute tool, and any caller could read another user's or org's handle
 * given its id. The gate checks every handle a call names, as the handle
 * route does, before the tool runs.
 */
const H1 = "qh-11111111-1111-4111-8111-111111111111";
const H2 = "qh-22222222-2222-4222-8222-222222222222";
const caller = { organizationId: "org-1", userId: "user-1" };

function makeTools() {
  const builtin = jest.fn(async (input: unknown) => ({ ran: input }));
  const custom = jest.fn(async (input: unknown) => ({ ran: input }));
  const tools: Record<
    string,
    { execute?: (input: unknown, options: unknown) => unknown }
  > = {
    technical_indicator: { execute: builtin },
    org_webhook: { execute: custom },
    no_execute: {},
  };
  return { tools, builtin, custom };
}

const expired = () =>
  new ApiError(404, ApiCode.READ_HANDLE_EXPIRED, "Query handle has expired");

describe("findHandleIds", () => {
  it("finds handle ids under any key, nested, once each", () => {
    expect(
      findHandleIds({
        queryHandle: H1,
        benchmarkQueryHandle: H2,
        nested: { list: [{ ref: H1 }] },
        other: "qh-not-a-handle",
        n: 3,
      }).sort()
    ).toEqual([H1, H2].sort());
  });

  it("finds none in input that names no handle", () => {
    expect(findHandleIds({ sql: "SELECT 1", rows: [{ a: 1 }] })).toEqual([]);
    expect(findHandleIds(undefined)).toEqual([]);
  });
});

describe("wrapWithHandleAccessGate", () => {
  it("runs a call whose handles the caller may read", async () => {
    const { tools, builtin } = makeTools();
    const authorize = jest.fn(async () => undefined);
    wrapWithHandleAccessGate(tools, caller, { authorize });

    const out = await tools.technical_indicator!.execute!(
      { queryHandle: H1 },
      {}
    );

    expect(authorize).toHaveBeenCalledWith(H1, caller);
    expect(builtin).toHaveBeenCalled();
    expect(out).toEqual({ ran: { queryHandle: H1 } });
  });

  it("refuses a call naming a handle the caller may not read, without running it", async () => {
    const { tools, builtin } = makeTools();
    const authorize = jest.fn(async () => {
      throw expired();
    });
    wrapWithHandleAccessGate(tools, caller, { authorize });

    const out = await tools.technical_indicator!.execute!(
      { queryHandle: H1 },
      {}
    );

    expect(builtin).not.toHaveBeenCalled();
    expect(out).toEqual({
      error: {
        code: ApiCode.READ_HANDLE_EXPIRED,
        message: "Query handle has expired",
      },
    });
  });

  it("checks every handle a call names", async () => {
    const { tools, builtin } = makeTools();
    const authorize = jest.fn(async (id: string) => {
      if (id === H2) throw expired();
    });
    wrapWithHandleAccessGate(tools, caller, { authorize });

    const out = await tools.technical_indicator!.execute!(
      { queryHandle: H1, benchmarkQueryHandle: H2 },
      {}
    );

    expect(authorize).toHaveBeenCalledTimes(2);
    expect(builtin).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      error: { code: ApiCode.READ_HANDLE_EXPIRED },
    });
  });

  it("gates custom tools too: their runtime pulls the handle's rows", async () => {
    const { tools, custom } = makeTools();
    const authorize = jest.fn(async () => {
      throw expired();
    });
    wrapWithHandleAccessGate(tools, caller, { authorize });

    await tools.org_webhook!.execute!({ queryHandle: H1 }, {});

    expect(custom).not.toHaveBeenCalled();
  });

  it("doesn't check a call that names no handle", async () => {
    const { tools, builtin } = makeTools();
    const authorize = jest.fn(async () => undefined);
    wrapWithHandleAccessGate(tools, caller, { authorize });

    await tools.technical_indicator!.execute!({ rows: [{ a: 1 }] }, {});

    expect(authorize).not.toHaveBeenCalled();
    expect(builtin).toHaveBeenCalled();
  });

  it("lets an unexpected failure propagate", async () => {
    const { tools } = makeTools();
    const authorize = jest.fn(async () => {
      throw new Error("redis down");
    });
    wrapWithHandleAccessGate(tools, caller, { authorize });

    await expect(
      tools.technical_indicator!.execute!({ queryHandle: H1 }, {})
    ).rejects.toThrow("redis down");
  });
});
