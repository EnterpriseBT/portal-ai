import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { recordAudit } from "../audit.js";

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-env-audit-"));
  process.env.PORTALAI_HOME = tmpDir;
});
afterEach(() => {
  delete process.env.PORTALAI_HOME;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("recordAudit", () => {
  it("appends timestamped JSONL entries (who / what / which-env)", async () => {
    await recordAudit({
      env: "app-dev",
      operator: "auth0|abc123",
      command: "org update",
      args: { id: "org-1", tier: "standard" },
    });
    await recordAudit({ env: "local", operator: "unknown", command: "seed" });

    const lines = fs
      .readFileSync(path.join(tmpDir, "audit.log"), "utf8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first).toMatchObject({
      env: "app-dev",
      operator: "auth0|abc123",
      command: "org update",
      args: { id: "org-1", tier: "standard" },
    });
    expect(new Date(first.ts).getTime()).toBeGreaterThan(0);
  });

  it("never throws when the append fails (audit is best-effort, ops proceed)", async () => {
    // Point ~/.portalai at a path that is a FILE, so mkdir/append must fail.
    const blocker = path.join(tmpDir, "blocker");
    fs.writeFileSync(blocker, "");
    process.env.PORTALAI_HOME = blocker;

    await expect(
      recordAudit({ env: "local", operator: "unknown", command: "noop" })
    ).resolves.toBeUndefined();
  });
});
