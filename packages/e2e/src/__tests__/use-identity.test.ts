import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { useIdentity } from "../lib/use-identity.js";
import { E2eConfigError, resolveTarget } from "../lib/target.js";

describe("useIdentity", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "e2e-use-"));
  });

  it("makes a local identity's state the active one", () => {
    mkdirSync(path.join(root, ".auth"));
    writeFileSync(path.join(root, ".auth/member.storageState.json"), "M");
    const active = useIdentity(resolveTarget({}), "member", root);
    expect(active).toBe(path.join(root, ".auth/storageState.json"));
    expect(readFileSync(active, "utf8")).toBe("M");
  });

  it("switches a deployed env's active state, leaving the local one alone", () => {
    mkdirSync(path.join(root, ".auth/prod"), { recursive: true });
    writeFileSync(path.join(root, ".auth/storageState.json"), "LOCAL");
    writeFileSync(path.join(root, ".auth/prod/admin.storageState.json"), "A");
    const active = useIdentity(
      resolveTarget({ E2E_TARGET: "prod" }),
      "admin",
      root
    );
    expect(readFileSync(active, "utf8")).toBe("A");
    expect(
      readFileSync(path.join(root, ".auth/storageState.json"), "utf8")
    ).toBe("LOCAL");
  });

  it("names the sign-in to run when the identity has no state yet", () => {
    expect(() =>
      useIdentity(resolveTarget({ E2E_TARGET: "app-dev" }), "member", root)
    ).toThrow(/e2e:auth -- --env app-dev --identity member/);
  });

  it("refuses an identity a deployed env doesn't have", () => {
    expect(() =>
      useIdentity(resolveTarget({ E2E_TARGET: "prod" }), "viewer", root)
    ).toThrow(E2eConfigError);
  });
});
