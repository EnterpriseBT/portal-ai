import { describe, it, expect } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Guards against regressions of the legacy `sdk.uploads` / `useFileUpload`
 * surface retired by `SPREADSHEET_PARSING.frontend.plan.md` §Phase 6.8.
 *
 * This is an AST-lite scan — it walks the web source tree and greps for
 * forbidden patterns. A single intentional reference inside `api/uploads.api.ts`
 * is allowed until `FILE_UPLOAD_DEPRECATION.plan.md` §Phase 4 removes the
 * module after the 410-gate bake window.
 */

const WEB_SRC = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo"]);
const ALLOWED_SDK_UPLOADS_FILE = path.resolve(WEB_SRC, "api", "uploads.api.ts");
const ALLOWED_SDK_BARREL = path.resolve(WEB_SRC, "api", "sdk.ts");
// The audit references forbidden strings in its own source; exclude itself
// so the guard doesn't flag its own test descriptions.
const AUDIT_SELF = path.resolve(__dirname, "file-upload.legacy-audit.test.ts");

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
}

const files = (() => {
  const out: string[] = [];
  walk(WEB_SRC, out);
  return out;
})();

describe("legacy file-upload surface audit", () => {
  it("no file under apps/web/src/ imports from utils/file-upload.util", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const content = readFileSync(f, "utf-8");
      if (
        /from\s+["'][^"']*utils\/file-upload\.util(?:["'.])/u.test(content)
      ) {
        offenders.push(path.relative(WEB_SRC, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no file (except api/uploads.api.ts + api/sdk.ts) references sdk.uploads", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f === ALLOWED_SDK_UPLOADS_FILE) continue;
      if (f === ALLOWED_SDK_BARREL) continue;
      if (f === AUDIT_SELF) continue;
      const content = readFileSync(f, "utf-8");
      if (/\bsdk\.uploads\b/.test(content)) {
        offenders.push(path.relative(WEB_SRC, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no file under workflows/FileUploadConnector/ still contains a TODO(API wiring) marker", () => {
    const offenders: string[] = [];
    const root = path.resolve(WEB_SRC, "workflows", "FileUploadConnector");
    for (const f of files) {
      if (!f.startsWith(root)) continue;
      if (f === AUDIT_SELF) continue;
      const content = readFileSync(f, "utf-8");
      if (/TODO\(API wiring\):/.test(content)) {
        offenders.push(path.relative(WEB_SRC, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no file imports the deleted useFileUpload hook", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f === AUDIT_SELF) continue;
      const content = readFileSync(f, "utf-8");
      if (/\buseFileUpload\b/.test(content)) {
        offenders.push(path.relative(WEB_SRC, f));
      }
    }
    expect(offenders).toEqual([]);
  });
});
