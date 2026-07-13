import { describe, it, expect, jest } from "@jest/globals";

import { ApiCode } from "../../../constants/api-codes.constants.js";
import { streamFetchRecords } from "../../../adapters/rest-api/stream.util.js";

// ── Test helpers ──────────────────────────────────────────────────────

/**
 * Build a fake `fetch` impl that returns a response whose body is a
 * `ReadableStream` you can drive chunk-by-chunk. Use for cases that
 * need to interleave consumer pulls with producer pushes (case 1 —
 * incremental emission, case 6 — mid-stream parse error).
 *
 * `cancelSpy` (optional) fires when the underlying stream's source
 * `cancel` callback runs — i.e., when the consumer breaks early and
 * the Node Readable adapter propagates cancellation upstream.
 */
function makeControlledFetch(
  opts: {
    status?: number;
    headers?: Record<string, string>;
    cancelSpy?: (reason?: unknown) => void;
  } = {}
) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel(reason) {
      opts.cancelSpy?.(reason);
    },
  });
  const encoder = new TextEncoder();
  const fake = jest.fn<typeof fetch>().mockResolvedValueOnce(
    new Response(stream, {
      status: opts.status ?? 200,
      headers: {
        "content-type": "application/json",
        ...(opts.headers ?? {}),
      },
    })
  );
  return {
    fetch: fake,
    push: (chunk: string) => controller.enqueue(encoder.encode(chunk)),
    close: () => controller.close(),
    error: (err: Error) => controller.error(err),
  };
}

/**
 * Static-body fake fetch — for cases that only need a whole-string body.
 */
function staticFetch(
  body: string,
  opts: { status?: number; headers?: Record<string, string> } = {}
) {
  return jest.fn<typeof fetch>().mockResolvedValueOnce(
    new Response(body, {
      status: opts.status ?? 200,
      headers: {
        "content-type": "application/json",
        ...(opts.headers ?? {}),
      },
    })
  );
}

/** Collect the entire async iterable to an array. */
async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

// ── Cases ─────────────────────────────────────────────────────────────

describe("streamFetchRecords — happy path", () => {
  it("case 1: emits records incrementally as bytes arrive", async () => {
    const ctrl = makeControlledFetch();

    const result = await streamFetchRecords("https://x.test", {}, "items", {
      fetchImpl: ctrl.fetch,
    });

    const iter = result.recordsStream[Symbol.asyncIterator]();

    // Open the JSON document + array but don't push any records yet.
    ctrl.push('{"items":[');

    // Push exactly one record. The consumer should see it before chunk 3.
    ctrl.push('{"id":1}');

    const first = await iter.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({ id: 1 });

    // Push the second record + close.
    ctrl.push(',{"id":2}]}');
    ctrl.close();

    const second = await iter.next();
    expect(second.value).toEqual({ id: 2 });

    const end = await iter.next();
    expect(end.done).toBe(true);
  });

  it("case 2: recordsPath = '' streams the document-root array", async () => {
    const fake = staticFetch('[{"id":1},{"id":2},{"id":3}]');

    const result = await streamFetchRecords("https://x.test", {}, "", {
      fetchImpl: fake,
    });

    const records = await collect(result.recordsStream);
    expect(records).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it("case 3: deep recordsPath emits records under nested object", async () => {
    const fake = staticFetch(
      '{"data":{"results":{"items":[{"id":1},{"id":2}]}}}'
    );

    const result = await streamFetchRecords(
      "https://x.test",
      {},
      "data.results.items",
      { fetchImpl: fake }
    );

    const records = await collect(result.recordsStream);
    expect(records).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("case 4: empty array → empty iteration, no throws", async () => {
    const fake = staticFetch('{"items":[]}');

    const result = await streamFetchRecords("https://x.test", {}, "items", {
      fetchImpl: fake,
    });

    const records = await collect(result.recordsStream);
    expect(records).toEqual([]);
  });

  it("exposes status + headers from the upstream response", async () => {
    const fake = staticFetch('{"items":[]}', {
      status: 200,
      headers: { "x-custom": "v" },
    });

    const result = await streamFetchRecords("https://x.test", {}, "items", {
      fetchImpl: fake,
    });

    expect(result.status).toBe(200);
    expect(result.headers["x-custom"]).toBe("v");
    // Drain so we don't leak the stream into other tests.
    await collect(result.recordsStream);
  });

  it("getBytesObserved reports raw upstream byte count after draining", async () => {
    const body = '{"items":[{"id":1},{"id":2}]}';
    const expected = Buffer.byteLength(body, "utf8");
    const fake = staticFetch(body);

    const result = await streamFetchRecords("https://x.test", {}, "items", {
      fetchImpl: fake,
    });

    // Counter starts at 0 — the iterator hasn't pulled any chunks yet.
    expect(result.recordsStream.getBytesObserved()).toBe(0);

    await collect(result.recordsStream);

    expect(result.recordsStream.getBytesObserved()).toBe(expected);
  });
});

describe("streamFetchRecords — error cases", () => {
  it("case 5: non-2xx upstream → REST_API_FETCH_FAILED before consumer pulls", async () => {
    const fake = staticFetch('{"error":"oops"}', { status: 500 });

    await expect(
      streamFetchRecords("https://x.test", {}, "items", { fetchImpl: fake })
    ).rejects.toMatchObject({
      code: ApiCode.REST_API_FETCH_FAILED,
      details: expect.objectContaining({ status: 500 }),
    });
  });

  it("case 5b: non-2xx body surfaces on details.responseBody + ApiError.message (#78)", async () => {
    const fake = staticFetch(
      '{"error":{"message":"required field \\"symbols\\" missing"}}',
      { status: 422 }
    );
    await expect(
      streamFetchRecords("https://x.test", {}, "items", { fetchImpl: fake })
    ).rejects.toMatchObject({
      code: ApiCode.REST_API_FETCH_FAILED,
      message: 'Endpoint returned HTTP 422: required field "symbols" missing',
      details: expect.objectContaining({
        status: 422,
        responseBody:
          '{"error":{"message":"required field \\"symbols\\" missing"}}',
      }),
    });
  });

  it("case 6: malformed JSON mid-stream throws inside for-await; earlier records observable", async () => {
    const ctrl = makeControlledFetch();

    const result = await streamFetchRecords("https://x.test", {}, "items", {
      fetchImpl: ctrl.fetch,
    });

    const iter = result.recordsStream[Symbol.asyncIterator]();

    ctrl.push('{"items":[{"id":1}');
    const first = await iter.next();
    expect(first.value).toEqual({ id: 1 });

    // Inject garbage that the parser will choke on.
    ctrl.push(",not-json{");
    ctrl.close();

    await expect(iter.next()).rejects.toMatchObject({
      code: ApiCode.REST_API_INVALID_JSON,
    });
  });

  it("case 7: missing recordsPath throws REST_API_RECORDS_PATH_NOT_FOUND on first pull", async () => {
    const fake = staticFetch('{"data":{"other":[1,2,3]}}');

    const result = await streamFetchRecords(
      "https://x.test",
      {},
      "data.items",
      { fetchImpl: fake }
    );

    await expect(collect(result.recordsStream)).rejects.toMatchObject({
      code: ApiCode.REST_API_RECORDS_PATH_NOT_FOUND,
      details: expect.objectContaining({ path: "data.items" }),
    });
  });

  it("case 7b: recordsPath resolves to non-array throws REST_API_RECORDS_PATH_NOT_ARRAY", async () => {
    const fake = staticFetch('{"items":{"not":"an-array"}}');

    const result = await streamFetchRecords("https://x.test", {}, "items", {
      fetchImpl: fake,
    });

    await expect(collect(result.recordsStream)).rejects.toMatchObject({
      code: ApiCode.REST_API_RECORDS_PATH_NOT_ARRAY,
      details: expect.objectContaining({ path: "items" }),
    });
  });

  it("case 8: single record exceeding maxRecordBytes throws REST_API_RECORD_TOO_LARGE", async () => {
    // Build a body whose second record is > maxRecordBytes = 1 KB.
    const tiny = JSON.stringify({ id: 1 });
    const huge = JSON.stringify({ id: 2, payload: "x".repeat(2048) });
    const body = `[${tiny},${huge}]`;
    const fake = staticFetch(body);

    const result = await streamFetchRecords("https://x.test", {}, "", {
      fetchImpl: fake,
      maxRecordBytes: 1024,
    });

    const iter = result.recordsStream[Symbol.asyncIterator]();

    const first = await iter.next();
    expect(first.value).toEqual({ id: 1 });

    await expect(iter.next()).rejects.toMatchObject({
      code: ApiCode.REST_API_RECORD_TOO_LARGE,
      details: expect.objectContaining({ limit: 1024 }),
    });
  });

  it("case 9: re-iteration throws REST_API_STREAM_ALREADY_CONSUMED", async () => {
    const fake = staticFetch('{"items":[{"id":1}]}');

    const result = await streamFetchRecords("https://x.test", {}, "items", {
      fetchImpl: fake,
    });

    await collect(result.recordsStream);

    expect(() => result.recordsStream[Symbol.asyncIterator]()).toThrow(
      expect.objectContaining({
        code: ApiCode.REST_API_STREAM_ALREADY_CONSUMED,
      })
    );
  });

  it("case 10: consumer break cancels the upstream reader", async () => {
    const cancelSpy = jest.fn();
    const ctrl = makeControlledFetch({ cancelSpy });

    const result = await streamFetchRecords("https://x.test", {}, "items", {
      fetchImpl: ctrl.fetch,
    });

    ctrl.push('{"items":[{"id":1},{"id":2}');
    // Don't close — the consumer breaks early.

    const iter = result.recordsStream[Symbol.asyncIterator]();
    const first = await iter.next();
    expect(first.value).toEqual({ id: 1 });

    // Simulate `for await ... { break }`.
    await iter.return?.(undefined);

    // Cancellation is queued through Node's stream machinery; wait a
    // microtask for the underlying ReadableStream's source.cancel() to fire.
    await new Promise((resolve) => setImmediate(resolve));

    expect(cancelSpy).toHaveBeenCalled();
  });

  it("case 11: upstream reader error rejects the in-flight next()", async () => {
    const ctrl = makeControlledFetch();

    const result = await streamFetchRecords("https://x.test", {}, "items", {
      fetchImpl: ctrl.fetch,
    });

    const iter = result.recordsStream[Symbol.asyncIterator]();

    ctrl.push('{"items":[{"id":1}');
    const first = await iter.next();
    expect(first.value).toEqual({ id: 1 });

    ctrl.error(new Error("socket reset"));

    await expect(iter.next()).rejects.toThrow(/socket reset/);
  });
});
