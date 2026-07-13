/**
 * Memory smoke test for the REST API streaming sync path — slice 5 of
 * `docs/REST_API_STREAM_PARSE.plan.md` §Tests.
 *
 * Spawns `src/scripts/rest-api-stream-memory-smoke.ts` as a child Node
 * process with `NODE_OPTIONS=--max-old-space-size=256`. The child
 * streams a ~300 MB JSON body through `streamFetchRecords` — a
 * buffered parse would OOM the cap; the streaming primitive must
 * keep heap bounded as records arrive. Success = clean exit 0;
 * failure = signal-9 (kernel OOM kill) or `JavaScript heap out of
 * memory` in stderr.
 *
 * Gated behind `RUN_SLOW_TESTS=1`: the child takes ~5 s and exercises
 * the wire-level streaming path, which doesn't need to run on every
 * dev `npm run test:unit`.
 */

import { describe, it, expect } from "@jest/globals";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPT_PATH = path.resolve(
  __dirname,
  "../../scripts/rest-api-stream-memory-smoke.ts"
);

const SHOULD_RUN = process.env.RUN_SLOW_TESTS === "1";
const describeOrSkip = SHOULD_RUN ? describe : describe.skip;

describeOrSkip("REST API streaming memory smoke — RUN_SLOW_TESTS gated", () => {
  it("~300 MB streamed body parses under --max-old-space-size=256", async () => {
    const child = spawn("node", ["--import", "tsx/esm", SCRIPT_PATH], {
      env: {
        ...process.env,
        NODE_OPTIONS: "--import tsx/esm --max-old-space-size=256",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const { exitCode, signal } = await new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      child.on("exit", (code, sig) => resolve({ exitCode: code, signal: sig }));
    });

    // Signal-9 = kernel OOM kill; "heap out of memory" = V8
    // refused to grow further. Either means streaming failed
    // and we materialized the payload.
    expect(signal).toBeNull();
    expect(stderr).not.toMatch(/JavaScript heap out of memory/);
    expect(stdout).toMatch(/OK rest-api stream memory smoke: 3000 records/);
    expect(exitCode).toBe(0);
  }, 120_000);
});
