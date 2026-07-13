/**
 * Standalone memory smoke for the REST API streaming sync path —
 * slice 5 of `docs/REST_API_STREAM_PARSE.plan.md`.
 *
 * Spins an in-process `node:http` server that streams a large JSON
 * `{"items":[…]}` body under native HTTP backpressure, then drives
 * `streamFetchRecords` against it from a `for await` loop that
 * simulates the sync loop's per-record DB latency with a `setImmediate`
 * yield. The companion jest test spawns this script with
 * `NODE_OPTIONS=--max-old-space-size=256` — success = clean exit 0;
 * failure = signal-9 or `JavaScript heap out of memory` in stderr.
 *
 * Bytes-observed accuracy is covered by the `stream.util.test.ts`
 * unit case; correctness of `syncInstance` wiring is covered by the
 * slice-4 unit + integration tests. This smoke isolates the property
 * the streaming refactor exists to deliver: a payload meaningfully
 * larger than the v1 50 MB cap is parsed without the worker
 * materializing it into V8 heap.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";

import { streamFetchRecords } from "../adapters/rest-api/stream.util.js";

const RECORD_COUNT = 3_000;
// ~100 KB per record × 3,000 = ~300 MB on the wire. Comfortably above
// the v1 cap (50 MB) and the child's heap budget (256 MB). A buffered
// parse would balloon heap past the cap; a streaming parse drains
// records as they arrive and stays bounded.
const PADDING = "x".repeat(100_000);

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });

  let i = 0;
  const writeMore = () => {
    while (i < RECORD_COUNT) {
      const prefix = i === 0 ? "" : ",";
      const ok = res.write(`${prefix}{"id":"r${i}","payload":"${PADDING}"}`);
      i++;
      // `write` returns false when the kernel buffer fills — pause
      // until `drain` so the streaming parser has something real to
      // backpressure against.
      if (!ok) {
        res.once("drain", writeMore);
        return;
      }
    }
    res.end("]}");
  };
  res.write('{"items":[');
  writeMore();
});

await new Promise<void>((resolve) => {
  server.listen(0, () => resolve());
});
const port = (server.address() as AddressInfo).port;

const start = Date.now();
const result = await streamFetchRecords(
  `http://127.0.0.1:${port}/items`,
  {},
  "items"
);

let count = 0;
for await (const record of result.recordsStream) {
  if (
    record === null ||
    typeof record !== "object" ||
    !("id" in (record as Record<string, unknown>))
  ) {
    console.error(`FAIL: malformed record at index ${count}`);
    process.exit(1);
  }
  count++;
  // Simulate per-record DB latency so the consumer is meaningfully
  // slower than the parser; this is what forces the backpressure
  // path to actually engage.
  if (count % 64 === 0) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

const elapsedMs = Date.now() - start;
const bytes = result.recordsStream.getBytesObserved();

if (count !== RECORD_COUNT) {
  console.error(`FAIL: expected ${RECORD_COUNT} records, got ${count}`);
  process.exit(1);
}

// The bytes-observed check doubles as a regression guard for the
// getBytesObserved getter being attached to the wrong object
// (would report 0). Anything > 50 MB also proves we lifted the v1
// buffered cap on the streaming path.
const MIN_BYTES = 200 * 1024 * 1024;
if (bytes < MIN_BYTES) {
  console.error(`FAIL: bytesObserved=${bytes} below ${MIN_BYTES}`);
  process.exit(1);
}

const heapMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
console.log(
  `OK rest-api stream memory smoke: ${count} records, ` +
    `${Math.round(bytes / 1024 / 1024)} MB streamed in ${elapsedMs} ms; ` +
    `heapUsed=${heapMb} MB, rss=${rssMb} MB`
);

await new Promise<void>((resolve) => server.close(() => resolve()));
process.exit(0);
