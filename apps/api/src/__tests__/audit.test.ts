/**
 * Phase 10 audit — compile-time-ish checks that the parser module remains the
 * canonical owner of spreadsheet-parsing concepts.
 *
 * This runs under the unit suite (no DB). It walks the `apps/api/src/` and
 * `apps/web/src/` trees and scans for patterns that indicate drift:
 *
 *   1. A type alias redefining the `Orientation` union locally — all
 *      consumers must import `Orientation` from `@portalai/core/contracts`.
 *   2. Multiple definitions of `RegionDraft` — it must only live at
 *      `apps/web/src/modules/RegionEditor/utils/region-editor.types.ts`.
 *   3. A named `hasHeader` export from `csv-parser.util.ts` — that heuristic
 *      moved into `@portalai/spreadsheet-parsing/interpret/stages/detect-headers`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "@jest/globals";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiSrcRoot = path.resolve(here, "..");
const webSrcRoot = path.resolve(apiSrcRoot, "../../web/src");

function walkTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      if (entry.name === "__tests__") continue;
      if (entry.name === ".storybook") continue;
      if (entry.name === "stories") continue;
      out.push(...walkTsFiles(full));
    } else if (
      entry.isFile() &&
      /\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

const apiFiles = walkTsFiles(apiSrcRoot);
const webFiles = walkTsFiles(webSrcRoot);
// The audit references its own forbidden strings; exclude it from scans
// that would otherwise flag itself.
const AUDIT_SELF = path.resolve(here, "audit.test.ts");

describe("Phase 10 audit — parser module owns spreadsheet-parsing concepts", () => {
  it("no file in apps/api/src/ defines the Orientation union as a local type alias", () => {
    const offenders: string[] = [];
    // `type <Name> = "rows-as-records" | "columns-as-records" | "cells-as-records"` in any order.
    const aliasRe =
      /type\s+\w+\s*=\s*"(?:rows|columns|cells)-as-records"\s*\|\s*"(?:rows|columns|cells)-as-records"/;
    for (const file of apiFiles) {
      const text = fs.readFileSync(file, "utf8");
      if (aliasRe.test(text)) {
        offenders.push(path.relative(apiSrcRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no file in apps/web/src/ defines the Orientation union as a local type alias", () => {
    const offenders: string[] = [];
    const aliasRe =
      /type\s+\w+\s*=\s*"(?:rows|columns|cells)-as-records"\s*\|\s*"(?:rows|columns|cells)-as-records"/;
    for (const file of webFiles) {
      const text = fs.readFileSync(file, "utf8");
      if (aliasRe.test(text)) {
        offenders.push(path.relative(webSrcRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("RegionDraft is defined in exactly one location under apps/web/src/", () => {
    const definitionRe =
      /(?:^|\n)\s*export\s+(?:type|interface)\s+RegionDraft\b/;
    const offenders: string[] = [];
    for (const file of webFiles) {
      const text = fs.readFileSync(file, "utf8");
      if (definitionRe.test(text)) {
        offenders.push(path.relative(webSrcRoot, file));
      }
    }
    expect(offenders).toEqual([
      "modules/RegionEditor/utils/region-editor.types.ts",
    ]);
  });

  it("legacy csv-parser.util.ts is fully removed", () => {
    const file = path.join(apiSrcRoot, "utils", "csv-parser.util.ts");
    expect(fs.existsSync(file)).toBe(false);
  });

  it("legacy upload surface is fully removed from apps/api/src/", () => {
    const removed = [
      "routes/uploads.router.ts",
      "services/uploads.service.ts",
      "services/file-analysis.service.ts",
      "services/csv-import.service.ts",
      "services/xlsx-import.service.ts",
      "queues/processors/file-upload.processor.ts",
      "utils/csv-parser.util.ts",
      "utils/xlsx-parser.util.ts",
      "utils/column-stats.util.ts",
      "utils/heuristic-analyzer.util.ts",
      "prompts/file-analysis.prompt.ts",
      "middleware/deprecation.middleware.ts",
    ];
    const survivors = removed.filter((p) =>
      fs.existsSync(path.join(apiSrcRoot, p))
    );
    expect(survivors).toEqual([]);
  });

  it("no file in apps/api/src/ references the deleted legacy services", () => {
    const forbidden = [
      "uploads.service",
      "csv-import.service",
      "xlsx-import.service",
      "file-analysis.service",
      "file-upload.processor",
      "heuristic-analyzer",
      "column-stats.util",
      "file-analysis.prompt",
    ];
    const offenders: Array<{ file: string; needle: string }> = [];
    for (const file of apiFiles) {
      const text = fs.readFileSync(file, "utf8");
      for (const needle of forbidden) {
        if (text.includes(needle)) {
          offenders.push({ file: path.relative(apiSrcRoot, file), needle });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no file in apps/api/src/ redeclares a Region, LayoutPlan, SkipRule, ColumnBinding, HeaderStrategy, IdentityStrategy, Warning, DriftReport, Workbook, or ExtractedRecord *type* locally", () => {
    const canonicalNames = [
      "Region",
      "LayoutPlan",
      "SkipRule",
      "ColumnBinding",
      "HeaderStrategy",
      "IdentityStrategy",
      "Warning",
      "DriftReport",
      "Workbook",
      "ExtractedRecord",
    ];
    const offenders: Array<{ file: string; name: string }> = [];
    for (const file of apiFiles) {
      const text = fs.readFileSync(file, "utf8");
      for (const name of canonicalNames) {
        // Match `export type Region = ` or `export interface Region {` but
        // skip any identifier that legitimately EXTENDS the canonical name
        // (e.g., `type ConnectorRegion`). We require an exact word boundary.
        const defRe = new RegExp(
          `(?:^|\\n)\\s*export\\s+(?:type|interface)\\s+${name}\\b`
        );
        if (defRe.test(text)) {
          offenders.push({ file: path.relative(apiSrcRoot, file), name });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
