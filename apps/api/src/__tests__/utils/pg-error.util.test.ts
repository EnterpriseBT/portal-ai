import { describe, it, expect } from "@jest/globals";

import { unwrapPgError } from "../../utils/pg-error.util.js";

describe("unwrapPgError (#449)", () => {
  it("reads code + message from a Drizzle-wrapped error (.cause)", () => {
    // DrizzleQueryError: own message is the formatted query, real pg error on cause.
    const wrapped = {
      message: "Failed query: SELECT ...",
      cause: {
        code: "57014",
        message: "canceling statement due to statement timeout",
      },
    };
    expect(unwrapPgError(wrapped)).toEqual({
      code: "57014",
      message: "canceling statement due to statement timeout",
    });
  });

  it("reads code from a raw (unwrapped) pg error", () => {
    expect(
      unwrapPgError({ code: "42P01", message: 'relation "x" missing' })
    ).toEqual({ code: "42P01", message: 'relation "x" missing' });
  });

  it("returns undefined code when there is none", () => {
    expect(unwrapPgError(new Error("boom")).code).toBeUndefined();
    expect(unwrapPgError(undefined).code).toBeUndefined();
    expect(unwrapPgError(null).code).toBeUndefined();
  });
});
