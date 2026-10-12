import { describe, it, expect } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * #769: one 409 for "a running job holds this". BULK_JOB_TARGET_LOCKED and
 * REVALIDATION_ACTIVE were retired with no aliases; nothing in the API, web
 * or core source may name them again.
 */
const RETIRED = ["BULK_JOB_TARGET_LOCKED", "REVALIDATION_ACTIVE"];
const ROOTS = ["src", "../web/src", "../../packages/core/src"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("retired job-lock codes (#769)", () => {
  it("are named nowhere in the source", () => {
    const files = ROOTS.flatMap(sourceFiles);
    // Not vacuous: all three trees are scanned.
    expect(files.length).toBeGreaterThan(1_000);
    const hits = files
      .filter((f) => !f.endsWith("job-lock-codes.guard.test.ts"))
      .flatMap((f) =>
        RETIRED.filter((code) => readFileSync(f, "utf8").includes(code)).map(
          (code) => `${f}: ${code}`
        )
      );
    expect(hits).toEqual([]);
  });
});
