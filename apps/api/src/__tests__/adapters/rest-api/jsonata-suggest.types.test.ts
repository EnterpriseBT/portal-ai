import { describe, it, expect } from "@jest/globals";

import { JsonataSuggestError } from "../../../adapters/rest-api/jsonata-suggest.types.js";

describe("JsonataSuggestError", () => {
  it("carries the name, reason, and reason-prefixed message for timeout", () => {
    const err = new JsonataSuggestError("timeout", "request aborted");
    expect(err.name).toBe("JsonataSuggestError");
    expect(err.reason).toBe("timeout");
    expect(err.message).toBe("[jsonata-suggest:timeout] request aborted");
  });

  it("prefixes the message with reason for network-error", () => {
    const err = new JsonataSuggestError(
      "network-error",
      "fetch failed: ECONNRESET",
    );
    expect(err.reason).toBe("network-error");
    expect(err.message).toBe(
      "[jsonata-suggest:network-error] fetch failed: ECONNRESET",
    );
  });

  it("prefixes the message with reason for malformed-response", () => {
    const err = new JsonataSuggestError(
      "malformed-response",
      "schema mismatch",
    );
    expect(err.reason).toBe("malformed-response");
    expect(err.message).toBe(
      "[jsonata-suggest:malformed-response] schema mismatch",
    );
  });

  it("wires options.cause through to the new error", () => {
    const original = new Error("original failure");
    const err = new JsonataSuggestError("network-error", "wrapped", {
      cause: original,
    });
    expect(err.cause).toBe(original);
  });

  it("is an instance of Error", () => {
    const err = new JsonataSuggestError("timeout", "x");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(JsonataSuggestError);
  });
});
