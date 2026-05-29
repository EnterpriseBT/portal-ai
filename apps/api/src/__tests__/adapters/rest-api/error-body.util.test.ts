import { describe, it, expect } from "@jest/globals";

import {
  extractUserMessage,
  readErrorBody,
} from "../../../adapters/rest-api/error-body.util.js";

describe("readErrorBody", () => {
  it("returns the body text for a small response", async () => {
    const response = new Response('{"error":{"message":"nope"}}', {
      status: 422,
      headers: { "content-type": "application/json" },
    });
    const body = await readErrorBody(response);
    expect(body).toBe('{"error":{"message":"nope"}}');
  });

  it("returns null when the response has no body", async () => {
    // `Response.body` can be null for 204 / HEAD responses; simulate with a
    // construction that doesn't take a body.
    const response = new Response(null, { status: 204 });
    const body = await readErrorBody(response);
    expect(body).toBeNull();
  });

  it("returns an empty string when the body is empty", async () => {
    const response = new Response("", {
      status: 500,
      headers: { "content-type": "text/plain" },
    });
    const body = await readErrorBody(response);
    expect(body).toBe("");
  });

  it("truncates bodies larger than the cap", async () => {
    const large = "x".repeat(20 * 1024); // 20 KB
    const response = new Response(large, {
      status: 500,
      headers: { "content-type": "text/plain" },
    });
    const body = await readErrorBody(response, 8 * 1024);
    expect(body).not.toBeNull();
    expect(body!.length).toBe(8 * 1024);
  });

  it("accepts a custom cap", async () => {
    const response = new Response("hello world", {
      status: 500,
      headers: { "content-type": "text/plain" },
    });
    const body = await readErrorBody(response, 5);
    expect(body).toBe("hello");
  });
});

describe("extractUserMessage", () => {
  it("returns null for null input", () => {
    expect(extractUserMessage(null)).toBeNull();
  });

  it("returns null for empty / whitespace input", () => {
    expect(extractUserMessage("")).toBeNull();
    expect(extractUserMessage("   ")).toBeNull();
  });

  it("returns null when the body isn't JSON", () => {
    expect(extractUserMessage("<html>500 Internal Server Error</html>")).toBeNull();
  });

  it("returns null when JSON has no recognized error field", () => {
    expect(extractUserMessage('{"foo":"bar"}')).toBeNull();
  });

  it("extracts error.message (marketstack / stripe shape)", () => {
    expect(
      extractUserMessage('{"error":{"message":"required field missing"}}')
    ).toBe("required field missing");
  });

  it("extracts errors[0].message (GitHub / OpenAI shape)", () => {
    expect(
      extractUserMessage(
        '{"errors":[{"message":"insufficient_quota"},{"message":"other"}]}'
      )
    ).toBe("insufficient_quota");
  });

  it("extracts top-level message", () => {
    expect(extractUserMessage('{"message":"bad request"}')).toBe("bad request");
  });

  it("extracts top-level detail (DRF / FastAPI shape)", () => {
    expect(extractUserMessage('{"detail":"Not found."}')).toBe("Not found.");
  });

  it("prefers error.message over other fields when both present", () => {
    expect(
      extractUserMessage(
        '{"error":{"message":"primary"},"message":"secondary"}'
      )
    ).toBe("primary");
  });

  it("returns null when errors is an empty array", () => {
    expect(extractUserMessage('{"errors":[]}')).toBeNull();
  });

  it("returns null when error.message is not a string", () => {
    expect(extractUserMessage('{"error":{"message":123}}')).toBeNull();
  });
});
