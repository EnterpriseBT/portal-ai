/**
 * Streaming JSON parse for the REST API connector. Pipes the response
 * body through `stream-json` so the sync loop can emit records one at
 * a time as bytes arrive — the whole-document buffered path in
 * `fetch.util.ts` is the fallback for callers that need a snapshot
 * (JSONata transform, Preview, probe).
 *
 * Spec: `docs/REST_API_STREAM_PARSE.spec.md`. Slice 0 of the plan in
 * `docs/REST_API_STREAM_PARSE.plan.md` — primitive only, no consumers
 * yet; `syncInstance` wires it in slice 4.
 */

import { Readable } from "node:stream";

import parserStream from "stream-json";
import Pick from "stream-json/filters/pick.js";
import StreamArray from "stream-json/streamers/stream-array.js";

import { ApiCode } from "../../constants/api-codes.constants.js";
import { ApiError } from "../../services/http.service.js";

export const DEFAULT_MAX_RECORD_BYTES = 50 * 1024 * 1024;

export interface StreamFetchOptions {
  /** Injectable for tests; defaults to `globalThis.fetch`. */
  fetchImpl?: typeof globalThis.fetch;
  /**
   * Throws `REST_API_RECORD_TOO_LARGE` when any single record's
   * serialized JSON exceeds this. Defaults to 50 MB — almost always a
   * misconfigured `recordsPath` pointing at the document root.
   */
  maxRecordBytes?: number;
}

export interface StreamFetchResult {
  status: number;
  headers: Record<string, string>;
  /**
   * Records emitted under `recordsPath` as bytes arrive. Single-use —
   * re-iterating throws `REST_API_STREAM_ALREADY_CONSUMED`. Mid-stream
   * parse / size / socket failures surface as throws inside `for await`.
   */
  recordsStream: AsyncIterable<unknown>;
}

/**
 * Streaming counterpart to `fetchJson` for the records hot path. Pipes
 * the response body through a JSON parser configured with the supplied
 * `recordsPath` filter; emits each element as it parses.
 *
 * Throws — never returns — on:
 *   - 4xx / 5xx response → `REST_API_FETCH_FAILED` (before the consumer pulls).
 *   - Network failure / DNS / timeout → `REST_API_FETCH_FAILED`.
 *
 * Lazily throws inside `for await`:
 *   - Malformed JSON anywhere in the stream → `REST_API_INVALID_JSON`.
 *   - `recordsPath` doesn't exist in the document → `REST_API_RECORDS_PATH_NOT_FOUND`.
 *   - `recordsPath` resolves to a non-array → `REST_API_RECORDS_PATH_NOT_ARRAY`.
 *   - Any single record's serialized JSON exceeds `maxRecordBytes` → `REST_API_RECORD_TOO_LARGE`.
 *   - Upstream reader rejects mid-stream → the underlying error.
 */
export async function streamFetchRecords(
  url: string,
  init: RequestInit,
  recordsPath: string,
  opts: StreamFetchOptions = {}
): Promise<StreamFetchResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const maxRecordBytes = opts.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES;

  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (err) {
    throw new ApiError(
      502,
      ApiCode.REST_API_FETCH_FAILED,
      `Fetch failed: ${(err as Error).message}`,
      { url, cause: (err as Error).message }
    );
  }

  const headers = collectHeaders(response.headers);
  const status = response.status;

  if (!response.ok) {
    throw new ApiError(
      502,
      ApiCode.REST_API_FETCH_FAILED,
      `Endpoint returned HTTP ${status}`,
      { url, status, headers }
    );
  }

  if (!response.body) {
    throw new ApiError(
      502,
      ApiCode.REST_API_FETCH_FAILED,
      "Streaming fetch returned no body",
      { url, status, headers }
    );
  }

  const recordsStream = buildRecordsStream(
    response.body,
    recordsPath,
    maxRecordBytes
  );

  return { status, headers, recordsStream };
}

// ── Internals ─────────────────────────────────────────────────────────

function collectHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/**
 * Wires `response.body` → parser → (optional `Pick`) → `StreamArray`
 * into a single-use `AsyncIterable<unknown>`.
 *
 * Path-existence + array-shape checks aren't native to `stream-json`'s
 * `Pick` — Pick silently drops non-matching tokens. We layer the
 * detection by watching the parser's token stream directly: track
 * whether we saw any `Pick`-matched output and whether the first
 * matched token was an array-start. The judgements fire when the
 * upstream `end` event lands.
 */
function buildRecordsStream(
  body: ReadableStream<Uint8Array>,
  recordsPath: string,
  maxRecordBytes: number
): AsyncIterable<unknown> {
  let consumed = false;

  return {
    [Symbol.asyncIterator]() {
      if (consumed) {
        throw new ApiError(
          500,
          ApiCode.REST_API_STREAM_ALREADY_CONSUMED,
          "recordsStream was already consumed; build a new request to iterate again",
          { recordsPath }
        );
      }
      consumed = true;

      // Set up the parse pipeline. `parserStream` is a Duplex that
      // accepts text/Buffer and emits SAX-style tokens; `Pick`
      // sub-selects matching subtrees by path; `StreamArray` re-emits
      // each array element as an assembled JS value.
      const nodeBody = Readable.fromWeb(body as never);
      const parser = parserStream();

      // Track Pick matches so we can distinguish "path missing" from
      // "path exists but empty array".
      let sawPickMatch = false;
      let firstPickToken: { name: string } | null = null;

      const pick = Pick.asStream({ filter: recordsPath || /^/ });
      const arrayStream = StreamArray.asStream();

      pick.on("data", (token: { name: string }) => {
        sawPickMatch = true;
        if (firstPickToken === null) {
          firstPickToken = token;
          // Guard StreamArray from seeing a non-array root: it would
          // throw a generic parse error that we'd surface as
          // INVALID_JSON, masking the real misconfiguration.
          if (token.name !== "startArray") {
            arrayStream.destroy(
              new ApiError(
                502,
                ApiCode.REST_API_RECORDS_PATH_NOT_ARRAY,
                `recordsPath "${recordsPath}" resolved to a non-array value`,
                { path: recordsPath }
              )
            );
          }
        }
      });

      nodeBody.on("error", (err) => parser.destroy(err));
      parser.on("error", (err) => arrayStream.destroy(err));
      pick.on("error", (err) => arrayStream.destroy(err));

      nodeBody.pipe(parser).pipe(pick).pipe(arrayStream);

      // ── Async iterator state machine ───────────────────────────────
      // We pull from `arrayStream` via its readable events. Each
      // emitted item is `{ key, value }`; we surface `value`. Errors
      // route to either the in-flight `next()` promise or a pending
      // queue. Path-existence + non-array checks fire on `end`.

      type Resolver = (r: IteratorResult<unknown>) => void;
      type Rejecter = (e: unknown) => void;

      const buffered: unknown[] = [];
      const errors: unknown[] = [];
      let ended = false;
      let pendingResolve: Resolver | null = null;
      let pendingReject: Rejecter | null = null;

      const settle = () => {
        if (pendingResolve === null) return;
        if (errors.length > 0) {
          const reject = pendingReject!;
          pendingResolve = null;
          pendingReject = null;
          reject(errors.shift());
          return;
        }
        if (buffered.length > 0) {
          const resolve = pendingResolve;
          pendingResolve = null;
          pendingReject = null;
          resolve({ value: buffered.shift(), done: false });
          return;
        }
        if (ended) {
          const resolve = pendingResolve;
          pendingResolve = null;
          pendingReject = null;
          resolve({ value: undefined, done: true });
        }
      };

      arrayStream.on("data", (item: { key: number; value: unknown }) => {
        try {
          const serialized = JSON.stringify(item.value);
          if (
            typeof serialized === "string" &&
            Buffer.byteLength(serialized) > maxRecordBytes
          ) {
            errors.push(
              new ApiError(
                502,
                ApiCode.REST_API_RECORD_TOO_LARGE,
                `Record at index ${item.key} exceeded ${maxRecordBytes} bytes`,
                { index: item.key, limit: maxRecordBytes }
              )
            );
            arrayStream.destroy();
            settle();
            return;
          }
        } catch {
          // JSON.stringify can throw on circular refs etc. — let the
          // record through; downstream upsert will surface the issue.
        }
        buffered.push(item.value);
        settle();
      });

      arrayStream.on("error", (err: Error) => {
        errors.push(translateParseError(err, recordsPath));
        ended = true;
        settle();
      });

      arrayStream.on("end", () => {
        // Surface path-existence + array-shape failures only here,
        // after the parser has had a chance to walk the full document.
        if (recordsPath !== "" && !sawPickMatch) {
          errors.push(
            new ApiError(
              502,
              ApiCode.REST_API_RECORDS_PATH_NOT_FOUND,
              `recordsPath "${recordsPath}" not found in response body`,
              { path: recordsPath }
            )
          );
        } else if (
          sawPickMatch &&
          firstPickToken !== null &&
          (firstPickToken as { name: string }).name !== "startArray"
        ) {
          errors.push(
            new ApiError(
              502,
              ApiCode.REST_API_RECORDS_PATH_NOT_ARRAY,
              `recordsPath "${recordsPath}" resolved to a non-array value`,
              { path: recordsPath }
            )
          );
        }
        ended = true;
        settle();
      });

      const cancel = () => {
        // Destroying the Node Readable propagates through to the
        // underlying Web ReadableStream's source `cancel` callback.
        // We can't call `body.cancel()` directly here — `Readable.fromWeb`
        // has already locked the stream.
        try {
          nodeBody.destroy();
        } catch {
          /* best-effort */
        }
      };

      return {
        next(): Promise<IteratorResult<unknown>> {
          return new Promise<IteratorResult<unknown>>((resolve, reject) => {
            pendingResolve = resolve;
            pendingReject = reject;
            settle();
          });
        },
        return(value?: unknown): Promise<IteratorResult<unknown>> {
          cancel();
          ended = true;
          return Promise.resolve({ value, done: true });
        },
        throw(err: unknown): Promise<IteratorResult<unknown>> {
          cancel();
          ended = true;
          return Promise.reject(err);
        },
      };
    },
  };
}

function translateParseError(err: Error, recordsPath: string): ApiError {
  // Pre-typed errors (e.g. the non-array guard we inject ourselves)
  // pass through unchanged so the caller sees the specific failure code.
  if (err instanceof ApiError) return err;
  // `stream-json`'s parser throws plain `Error` with a message like
  // "Parser cannot parse input: …". Map to REST_API_INVALID_JSON so the
  // sync loop's telemetry matches the buffered fetchJson failure shape.
  return new ApiError(
    502,
    ApiCode.REST_API_INVALID_JSON,
    `Streaming parse failed: ${err.message}`,
    { path: recordsPath, cause: err.message }
  );
}
