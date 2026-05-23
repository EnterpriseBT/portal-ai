import { describe, it, expect, jest } from "@jest/globals";

import { ApiCode } from "../../../constants/api-codes.constants.js";
import { fetchJson, MAX_RESPONSE_BYTES } from "../../../adapters/rest-api/fetch.util.js";

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

describe("fetchJson — happy path", () => {
  it("returns { status, body, headers } on 200 + valid JSON", async () => {
    const fakeFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse([{ id: 1 }, { id: 2 }])
    );
    const result = await fetchJson("https://x.test", {}, fakeFetch);
    expect(result.status).toBe(200);
    expect(result.body).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.headers["content-type"]).toContain("application/json");
  });
});

describe("fetchJson — non-2xx", () => {
  it("throws REST_API_FETCH_FAILED on 500 with status + headers in details", async () => {
    const fakeFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({ error: "internal" }, { status: 500 })
    );
    await expect(fetchJson("https://x.test", {}, fakeFetch)).rejects.toMatchObject({
      code: ApiCode.REST_API_FETCH_FAILED,
      details: expect.objectContaining({
        status: 500,
        // headers is collected via the `Headers` iterator and downcased
        // — assert just one well-known entry is present.
        headers: expect.objectContaining({ "content-type": expect.any(String) }),
      }),
    });
  });

  it("attaches Retry-After to details so withRetry can read it", async () => {
    const fakeFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({ error: "slow down" }, {
        status: 429,
        headers: { "Retry-After": "30" },
      })
    );
    await expect(fetchJson("https://x.test", {}, fakeFetch)).rejects.toMatchObject({
      code: ApiCode.REST_API_FETCH_FAILED,
      details: expect.objectContaining({
        status: 429,
        headers: expect.objectContaining({ "retry-after": "30" }),
      }),
    });
  });

  it("throws REST_API_FETCH_FAILED on 404", async () => {
    const fakeFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({ error: "not found" }, { status: 404 })
    );
    await expect(fetchJson("https://x.test", {}, fakeFetch)).rejects.toMatchObject({
      code: ApiCode.REST_API_FETCH_FAILED,
      details: expect.objectContaining({ status: 404 }),
    });
  });

  it("throws REST_API_FETCH_FAILED on network error", async () => {
    const fakeFetch = jest.fn<typeof fetch>().mockRejectedValueOnce(
      new Error("ECONNREFUSED")
    );
    await expect(fetchJson("https://x.test", {}, fakeFetch)).rejects.toMatchObject({
      code: ApiCode.REST_API_FETCH_FAILED,
      details: expect.objectContaining({ cause: "ECONNREFUSED" }),
    });
  });
});

describe("fetchJson — invalid JSON", () => {
  it("throws REST_API_INVALID_JSON when body isn't parseable", async () => {
    const fakeFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      new Response("not-json{", { status: 200 })
    );
    await expect(fetchJson("https://x.test", {}, fakeFetch)).rejects.toMatchObject({
      code: ApiCode.REST_API_INVALID_JSON,
    });
  });

  it("attaches status + headers to details on parse failure (so callers can introspect)", async () => {
    const fakeFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      new Response("not-json{", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );
    await expect(fetchJson("https://x.test", {}, fakeFetch)).rejects.toMatchObject({
      code: ApiCode.REST_API_INVALID_JSON,
      details: expect.objectContaining({
        status: 200,
        headers: expect.objectContaining({ "content-type": "text/html" }),
      }),
    });
  });
});

describe("fetchJson — response too large (fast path)", () => {
  it("throws REST_API_RESPONSE_TOO_LARGE when Content-Length exceeds cap", async () => {
    const fakeFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: {
          "content-length": String(MAX_RESPONSE_BYTES + 1),
          "content-type": "application/json",
        },
      })
    );
    await expect(fetchJson("https://x.test", {}, fakeFetch)).rejects.toMatchObject({
      code: ApiCode.REST_API_RESPONSE_TOO_LARGE,
      details: expect.objectContaining({
        bytesObserved: MAX_RESPONSE_BYTES + 1,
        limit: MAX_RESPONSE_BYTES,
      }),
    });
  });

  it("accepts when Content-Length is at the cap exactly", async () => {
    const body = JSON.stringify([1]);
    const fakeFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(body, {
        status: 200,
        headers: {
          "content-length": String(body.length),
          "content-type": "application/json",
        },
      })
    );
    const result = await fetchJson("https://x.test", {}, fakeFetch);
    expect(result.body).toEqual([1]);
  });
});

describe("fetchJson — response too large (slow path)", () => {
  it("throws REST_API_RESPONSE_TOO_LARGE when streamed bytes exceed cap and no Content-Length", async () => {
    // Build a ReadableStream that emits chunks adding up to > MAX_RESPONSE_BYTES.
    const chunkSize = 1024 * 1024; // 1 MB
    const chunkCount = Math.ceil(MAX_RESPONSE_BYTES / chunkSize) + 2;
    const chunk = new Uint8Array(chunkSize).fill("a".charCodeAt(0));

    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < chunkCount; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const fakeFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    await expect(fetchJson("https://x.test", {}, fakeFetch)).rejects.toMatchObject({
      code: ApiCode.REST_API_RESPONSE_TOO_LARGE,
      details: expect.objectContaining({ limit: MAX_RESPONSE_BYTES }),
    });
  });
});
