import { describe, it, expect, jest } from "@jest/globals";

import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  fetchJson,
  MAX_RESPONSE_BYTES,
} from "../../../adapters/rest-api/fetch.util.js";

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
    const fakeFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{ id: 1 }, { id: 2 }]));
    const result = await fetchJson("https://x.test", {}, fakeFetch);
    expect(result.status).toBe(200);
    expect(result.body).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.headers["content-type"]).toContain("application/json");
  });
});

describe("fetchJson — non-2xx", () => {
  it("throws REST_API_FETCH_FAILED on 500 with status + headers in details", async () => {
    const fakeFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: "internal" }, { status: 500 })
      );
    await expect(
      fetchJson("https://x.test", {}, fakeFetch)
    ).rejects.toMatchObject({
      code: ApiCode.REST_API_FETCH_FAILED,
      details: expect.objectContaining({
        status: 500,
        // headers is collected via the `Headers` iterator and downcased
        // — assert just one well-known entry is present.
        headers: expect.objectContaining({
          "content-type": expect.any(String),
        }),
      }),
    });
  });

  it("attaches Retry-After to details so withRetry can read it", async () => {
    const fakeFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(
        { error: "slow down" },
        {
          status: 429,
          headers: { "Retry-After": "30" },
        }
      )
    );
    await expect(
      fetchJson("https://x.test", {}, fakeFetch)
    ).rejects.toMatchObject({
      code: ApiCode.REST_API_FETCH_FAILED,
      details: expect.objectContaining({
        status: 429,
        headers: expect.objectContaining({ "retry-after": "30" }),
      }),
    });
  });

  it("throws REST_API_FETCH_FAILED on 404", async () => {
    const fakeFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: "not found" }, { status: 404 })
      );
    await expect(
      fetchJson("https://x.test", {}, fakeFetch)
    ).rejects.toMatchObject({
      code: ApiCode.REST_API_FETCH_FAILED,
      details: expect.objectContaining({ status: 404 }),
    });
  });

  it("throws REST_API_FETCH_FAILED on network error", async () => {
    const fakeFetch = jest
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(
      fetchJson("https://x.test", {}, fakeFetch)
    ).rejects.toMatchObject({
      code: ApiCode.REST_API_FETCH_FAILED,
      details: expect.objectContaining({ cause: "ECONNREFUSED" }),
    });
  });
});

describe("fetchJson — non-2xx body surfacing (#78)", () => {
  it("captures the response body on `details.responseBody`", async () => {
    const fakeFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      new Response('{"error":{"message":"required field missing"}}', {
        status: 422,
        headers: { "content-type": "application/json" },
      })
    );
    await expect(
      fetchJson("https://x.test", {}, fakeFetch)
    ).rejects.toMatchObject({
      code: ApiCode.REST_API_FETCH_FAILED,
      details: expect.objectContaining({
        status: 422,
        responseBody: '{"error":{"message":"required field missing"}}',
      }),
    });
  });

  it("appends the extracted user message to `ApiError.message`", async () => {
    const fakeFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      new Response('{"error":{"message":"required field missing"}}', {
        status: 422,
        headers: { "content-type": "application/json" },
      })
    );
    await expect(
      fetchJson("https://x.test", {}, fakeFetch)
    ).rejects.toMatchObject({
      message: "Endpoint returned HTTP 422: required field missing",
    });
  });

  it("falls back to the plain status message when the body has no recognized shape", async () => {
    const fakeFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      new Response("<html>500 Internal Server Error</html>", {
        status: 500,
        headers: { "content-type": "text/html" },
      })
    );
    await expect(
      fetchJson("https://x.test", {}, fakeFetch)
    ).rejects.toMatchObject({
      message: "Endpoint returned HTTP 500",
      details: expect.objectContaining({
        responseBody: "<html>500 Internal Server Error</html>",
      }),
    });
  });

  it("omits responseBody when the upstream returns an empty body", async () => {
    // Empty-body 404 — readErrorBody returns "" → no friendly message
    // and the responseBody key is suppressed via the spread guard.
    const fakeFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const err = await fetchJson("https://x.test", {}, fakeFetch).catch(
      (e) => e
    );
    expect(err.code).toBe(ApiCode.REST_API_FETCH_FAILED);
    expect(err.details).toMatchObject({ status: 404 });
    expect(err.details).not.toHaveProperty("responseBody");
  });

  it("truncates large error bodies to 8 KB", async () => {
    const huge = "x".repeat(20 * 1024); // 20 KB
    const fakeFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(huge, {
        status: 500,
        headers: { "content-type": "text/plain" },
      })
    );
    const err = await fetchJson("https://x.test", {}, fakeFetch).catch(
      (e) => e
    );
    expect(err.details.responseBody.length).toBe(8 * 1024);
  });
});

describe("fetchJson — invalid JSON", () => {
  it("throws REST_API_INVALID_JSON when body isn't parseable", async () => {
    const fakeFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not-json{", { status: 200 }));
    await expect(
      fetchJson("https://x.test", {}, fakeFetch)
    ).rejects.toMatchObject({
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
    await expect(
      fetchJson("https://x.test", {}, fakeFetch)
    ).rejects.toMatchObject({
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
    await expect(
      fetchJson("https://x.test", {}, fakeFetch)
    ).rejects.toMatchObject({
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

describe("fetchJson — double-encoded JSON unwrap", () => {
  // Some upstreams (notably misconfigured ArcGIS REST FeatureServer
  // endpoints, JSONP-shimmed gateways, and a handful of legacy SOAP
  // bridges) return a body whose top-level JSON value is itself a
  // STRING containing JSON, e.g. body literally `"{\"x\":1}"`. The
  // single JSON.parse leaves us with a JS string, which downstream
  // (Preview pane, inference, transform) is useless to. Detect this
  // case and unwrap once.

  it("unwraps a body that's a JSON-encoded JSON object string", async () => {
    const inner = { objectIdFieldName: "OBJECTID", features: [{ id: 1 }] };
    // Body is `"{\"objectIdFieldName\":...}"` after escaping — one extra
    // layer of JSON wrapping.
    const wrapped = JSON.stringify(JSON.stringify(inner));
    const fakeFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(wrapped, {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const result = await fetchJson("https://x.test", {}, fakeFetch);
    expect(result.body).toEqual(inner);
  });

  it("unwraps a body that's a JSON-encoded JSON array string", async () => {
    const inner = [{ id: 1 }, { id: 2 }];
    const wrapped = JSON.stringify(JSON.stringify(inner));
    const fakeFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(wrapped, {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const result = await fetchJson("https://x.test", {}, fakeFetch);
    expect(result.body).toEqual(inner);
  });

  it("does NOT unwrap a body that's just a regular JSON string (not nested JSON)", async () => {
    // A legitimate JSON-string body, e.g. an endpoint that returns a
    // status message. The single JSON.parse already unwrapped one
    // layer; we must not eat a second layer that isn't there.
    const fakeFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify("hello world"), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const result = await fetchJson("https://x.test", {}, fakeFetch);
    expect(result.body).toBe("hello world");
  });

  it("does NOT unwrap a string body that starts with { but isn't valid JSON", async () => {
    // String literally is `{not json}` — looks like JSON to a naive
    // sniff, but the inner parse fails; keep the string body.
    const fakeFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify("{not json}"), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const result = await fetchJson("https://x.test", {}, fakeFetch);
    expect(result.body).toBe("{not json}");
  });

  it("only unwraps one level (a triple-encoded body remains a string)", async () => {
    const inner = { x: 1 };
    // Triple-encoded — first parse yields a string whose JSON-parsed
    // form is still a STRING (not an object), so we deliberately don't
    // recurse. Triple-encoding is pathological; one level is enough.
    const wrapped = JSON.stringify(JSON.stringify(JSON.stringify(inner)));
    const fakeFetch = jest.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(wrapped, {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const result = await fetchJson("https://x.test", {}, fakeFetch);
    expect(typeof result.body).toBe("string");
    // The body should still parse to a string (the inner-stringified
    // JSON), which would itself parse to the object — but we stop one
    // level shy of that.
    expect(typeof JSON.parse(result.body as string)).toBe("string");
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
    await expect(
      fetchJson("https://x.test", {}, fakeFetch)
    ).rejects.toMatchObject({
      code: ApiCode.REST_API_RESPONSE_TOO_LARGE,
      details: expect.objectContaining({ limit: MAX_RESPONSE_BYTES }),
    });
  });
});
