import path from "node:path";

import {
  E2eConfigError,
  resolveCredentials,
  resolveTarget,
  storageStatePath,
} from "../lib/target.js";

describe("resolveTarget", () => {
  it("defaults to the local stack, signing in through the dev affordance", () => {
    expect(resolveTarget({})).toEqual({
      name: "local",
      baseUrl: "http://localhost:3000",
      apiBaseUrl: "http://localhost:3001",
      via: "dev",
      deployed: false,
    });
  });

  it("resolves a deployed env from cli-env, signing in through the QA path", () => {
    expect(resolveTarget({ E2E_TARGET: "prod" })).toEqual({
      name: "prod",
      baseUrl: "https://app.portalsai.io",
      apiBaseUrl: "https://api.portalsai.io",
      via: "qa",
      deployed: true,
    });
    expect(resolveTarget({ E2E_TARGET: "app-dev" }).baseUrl).toBe(
      "https://app-dev.portalsai.io"
    );
  });

  it("lets E2E_BASE_URL point the local target elsewhere", () => {
    expect(
      resolveTarget({ E2E_BASE_URL: "http://localhost:4173" }).baseUrl
    ).toBe("http://localhost:4173");
  });

  // Deployed credentials must only ever be typed into that env's own app,
  // and a developer's .env commonly sets E2E_BASE_URL for the local stack.
  it("ignores E2E_BASE_URL on a deployed target", () => {
    expect(
      resolveTarget({ E2E_TARGET: "prod", E2E_BASE_URL: "http://evil.test" })
        .baseUrl
    ).toBe("https://app.portalsai.io");
  });

  it("lets E2E_SIGN_IN_VIA pick the QA path locally (the preview-build CI stack)", () => {
    expect(resolveTarget({ E2E_SIGN_IN_VIA: "qa" }).via).toBe("qa");
  });

  it("refuses the dev affordance on a deployed target, which has none", () => {
    expect(() =>
      resolveTarget({ E2E_TARGET: "app-dev", E2E_SIGN_IN_VIA: "dev" })
    ).toThrow(/dev affordance/);
  });

  it("rejects an unknown target or sign-in path", () => {
    expect(() => resolveTarget({ E2E_TARGET: "staging" })).toThrow(
      /local \| app-dev \| prod/
    );
    expect(() => resolveTarget({ E2E_SIGN_IN_VIA: "google" })).toThrow(
      E2eConfigError
    );
  });
});

describe("storageStatePath", () => {
  const root = "/pkg";
  const local = resolveTarget({});
  const prod = resolveTarget({ E2E_TARGET: "prod" });

  it("keeps the #304/#620 local paths", () => {
    expect(storageStatePath(local, undefined, root)).toBe(
      path.join(root, ".auth/storageState.json")
    );
    expect(storageStatePath(local, "Admin", root)).toBe(
      path.join(root, ".auth/admin.storageState.json")
    );
  });

  it("puts a deployed env's session in its own directory", () => {
    expect(storageStatePath(prod, undefined, root)).toBe(
      path.join(root, ".auth/prod/owner.storageState.json")
    );
  });

  it("refuses a named identity on a deployed target (only the QA owner exists)", () => {
    expect(() => storageStatePath(prod, "admin", root)).toThrow(E2eConfigError);
  });
});

describe("resolveCredentials", () => {
  const local = resolveTarget({});
  const appDev = resolveTarget({ E2E_TARGET: "app-dev" });
  const noSecrets = () => Promise.reject(new Error("unexpected secret read"));

  it("reads a local identity from its env vars", async () => {
    await expect(
      resolveCredentials(local, {
        env: {
          E2E_AUTH0_USERNAME_ADMIN: "a@x.test",
          E2E_AUTH0_PASSWORD_ADMIN: "pw",
        },
        identity: "admin",
        getSecret: noSecrets,
      })
    ).resolves.toEqual({ username: "a@x.test", password: "pw" });
  });

  it("names the missing vars, never their values", async () => {
    const err = await resolveCredentials(local, {
      env: { E2E_AUTH0_USERNAME: "u@x.test" },
      getSecret: noSecrets,
    }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(E2eConfigError);
    expect((err as Error).message).toMatch(/E2E_AUTH0_PASSWORD/);
    expect((err as Error).message).not.toMatch(/u@x\.test/);
  });

  it("prefers env vars on a deployed target (the CI deploy job exports them)", async () => {
    await expect(
      resolveCredentials(appDev, {
        env: { E2E_AUTH0_USERNAME: "qa@x.test", E2E_AUTH0_PASSWORD: "pw" },
        getSecret: noSecrets,
      })
    ).resolves.toEqual({ username: "qa@x.test", password: "pw" });
  });

  it("otherwise reads the QA identity from the env's Secrets Manager", async () => {
    const reads: string[] = [];
    const getSecret = async (def: { name: string }, name: string) => {
      reads.push(`${def.name}:${name}`);
      return name === "qa-auth0-username" ? "qa@x.test" : "pw";
    };
    await expect(
      resolveCredentials(appDev, { env: {}, getSecret })
    ).resolves.toEqual({ username: "qa@x.test", password: "pw" });
    expect(reads.sort()).toEqual([
      "app-dev:qa-auth0-password",
      "app-dev:qa-auth0-username",
    ]);
  });
});
