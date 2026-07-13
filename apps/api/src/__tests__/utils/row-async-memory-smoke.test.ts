/**
 * Memory smoke test for the row-async refactor — case 6 from
 * `docs/SPREADSHEET_PARSER_ROW_ASYNC.spec.md` §Tests.
 *
 * Spawns `src/scripts/row-async-memory-smoke.ts` as a child Node
 * process with `NODE_OPTIONS=--max-old-space-size=512`. The child
 * drives a 50,000-row × 20-col `replay()` through the lazy
 * workbook adapter. Success = clean exit 0; failure = signal-9 or
 * `JavaScript heap out of memory` in stderr.
 *
 * Gated behind `RUN_SLOW_TESTS=1` so the ~3 s child startup +
 * 1-2 s replay don't run on every dev `npm run test:unit`.
 */

import { describe, it, expect } from "@jest/globals";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPT_PATH = path.resolve(
  __dirname,
  "../../scripts/row-async-memory-smoke.ts"
);

const SHOULD_RUN = process.env.RUN_SLOW_TESTS === "1";
const describeOrSkip = SHOULD_RUN ? describe : describe.skip;

// Worst case the worker takes ~5s; allow generous headroom for
// CI startup noise. Without a per-test override the default
// unit-test timeout (~5s) would trip on warm-cache.
const SMOKE_TIMEOUT_MS = 60_000;

describeOrSkip("row-async memory smoke — RUN_SLOW_TESTS gated", () => {
  it(
    "50k-row × 20-col replay completes under --max-old-space-size=512",
    async () => {
      const child = spawn("node", ["--import", "tsx/esm", SCRIPT_PATH], {
        env: {
          ...process.env,
          NODE_OPTIONS: "--import tsx/esm --max-old-space-size=512",
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
        child.on("exit", (code, sig) =>
          resolve({ exitCode: code, signal: sig })
        );
      });

      // Signal-9 indicates the kernel OOM-killed the process; `JavaScript
      // heap out of memory` indicates V8's heap allocator gave up.
      // Either is the smoke's failure mode — the row-async path is
      // supposed to keep the process under the cap.
      expect(signal).toBeNull();
      expect(stderr).not.toMatch(/JavaScript heap out of memory/);
      expect(stdout).toMatch(/OK row-async memory smoke: 50000 records/);
      expect(exitCode).toBe(0);
    },
    SMOKE_TIMEOUT_MS
  );
});
