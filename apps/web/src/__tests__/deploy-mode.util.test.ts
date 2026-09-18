import { resolveDeployMode } from "../utils/deploy-mode.util";

describe("resolveDeployMode (#577)", () => {
  it("defaults to saas when unset", () => {
    expect(resolveDeployMode(undefined)).toBe("saas");
  });

  it("returns self_hosted for 'self_hosted'", () => {
    expect(resolveDeployMode("self_hosted")).toBe("self_hosted");
  });

  it("falls back to saas for saas or any unrecognized value", () => {
    expect(resolveDeployMode("saas")).toBe("saas");
    expect(resolveDeployMode("garbage")).toBe("saas");
    expect(resolveDeployMode("")).toBe("saas");
  });
});
