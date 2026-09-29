import { describe, it, expect } from "@jest/globals";

import { resolveScopeHash } from "../../services/portal-sql.service.js";
import type { SessionViewBuild } from "../../services/portal-sql.service.js";

const build = (views: string[]): SessionViewBuild => ({
  views,
  viewMap: new Map(),
});

describe("resolveScopeHash (#643)", () => {
  it("is deterministic for the same resolved build", () => {
    const ddl = ["CREATE TEMP VIEW contacts AS SELECT c_email FROM er__1"];
    expect(resolveScopeHash(build(ddl))).toBe(
      resolveScopeHash(build([...ddl]))
    );
  });

  it("differs when a view's row filter differs", () => {
    expect(resolveScopeHash(build(["... WHERE region = 'NE'"]))).not.toBe(
      resolveScopeHash(build(["... WHERE region = 'SW'"]))
    );
  });

  it("differs when the column projection differs", () => {
    expect(resolveScopeHash(build(["SELECT c_email FROM er__1"]))).not.toBe(
      resolveScopeHash(build(["SELECT c_email, c_age FROM er__1"]))
    );
  });

  it("is a stable 32-char hash for an empty build (fail-closed scope)", () => {
    const h = resolveScopeHash(build([]));
    expect(h).toHaveLength(32);
    expect(h).toBe(resolveScopeHash(build([])));
  });
});
