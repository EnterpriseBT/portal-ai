import { jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Mocks: SSM param lookup (AWS envs) + global fetch ────────────────

const getParamMock = jest.fn<(def: unknown, name: string) => Promise<string>>();
jest.unstable_mockModule("../aws.js", () => ({
  getParam: getParamMock,
}));

const fetchMock = jest.fn<typeof fetch>();
globalThis.fetch = fetchMock as unknown as typeof fetch;

const { login, logout, getToken } = await import("../auth0.js");
const { EnvNotAuthorizedError } = await import("../errors.js");

const json = (body: unknown, status = 200) =>
  ({
    ok: status < 400,
    status,
    json: async () => body,
  }) as Response;

// local env's Auth0 config comes from .env-style process env vars.
const LOCAL_AUTH0 = {
  AUTH0_DOMAIN: "dev-tenant.us.auth0.com",
  AUTH0_AUDIENCE: "https://api.local.test",
  AUTH0_CLI_CLIENT_ID: "cli-client-123",
};

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-env-auth0-"));
  process.env.PORTALAI_HOME = tmpDir;
  Object.assign(process.env, LOCAL_AUTH0);
  fetchMock.mockReset();
  getParamMock.mockReset();
});
afterEach(() => {
  delete process.env.PORTALAI_HOME;
  for (const k of Object.keys(LOCAL_AUTH0)) delete process.env[k];
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const credsFile = () => path.join(tmpDir, "credentials.json");
const readCreds = () => JSON.parse(fs.readFileSync(credsFile(), "utf8"));
const writeCreds = (creds: unknown) => {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(credsFile(), JSON.stringify(creds), { mode: 0o600 });
};

describe("login (device authorization grant)", () => {
  it("surfaces the user code, polls through pending/slow_down, and caches the session 0600", async () => {
    fetchMock
      // POST /oauth/device/code
      .mockResolvedValueOnce(
        json({
          device_code: "dev-code",
          user_code: "ABCD-EFGH",
          verification_uri_complete:
            "https://dev-tenant.us.auth0.com/activate?user_code=ABCD-EFGH",
          interval: 0, // fixture: no wait between polls
          expires_in: 900,
        })
      )
      // poll 1 → pending, poll 2 → slow_down, poll 3 → tokens
      .mockResolvedValueOnce(json({ error: "authorization_pending" }, 403))
      .mockResolvedValueOnce(json({ error: "slow_down" }, 429))
      .mockResolvedValueOnce(
        json({
          access_token: "at-1",
          refresh_token: "rt-1",
          expires_in: 86400,
        })
      );

    // slow_down legitimately backs off 5s (RFC 8628) — fake timers keep the
    // test instant without weakening the backoff behavior.
    jest.useFakeTimers();
    const onUserCode = jest.fn();
    try {
      const pending = login("local", { onUserCode });
      await jest.advanceTimersByTimeAsync(30_000);
      await pending;
    } finally {
      jest.useRealTimers();
    }

    expect(onUserCode).toHaveBeenCalledWith(
      "https://dev-tenant.us.auth0.com/activate?user_code=ABCD-EFGH",
      "ABCD-EFGH"
    );
    // Device-code request went to the env's tenant with the CLI client id.
    const [deviceUrl, deviceInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(deviceUrl).toBe("https://dev-tenant.us.auth0.com/oauth/device/code");
    expect(String(deviceInit.body)).toContain("cli-client-123");

    const creds = readCreds();
    expect(creds.local.accessToken).toBe("at-1");
    expect(creds.local.refreshToken).toBe("rt-1");
    expect(creds.local.expiresAt).toBeGreaterThan(Date.now());
    // 0600 — owner-only.
    expect(fs.statSync(credsFile()).mode & 0o777).toBe(0o600);
  });

  it("resolves AWS envs' Auth0 config from SSM params", async () => {
    getParamMock.mockImplementation(
      async (_def, name) =>
        ({
          "auth0-domain": "dev-tenant.us.auth0.com",
          "auth0-audience": "https://api.mcp-ui.dev",
          "auth0-cli-client-id": "cli-appdev-456",
        })[name]!
    );
    fetchMock
      .mockResolvedValueOnce(
        json({
          device_code: "d",
          user_code: "U",
          verification_uri_complete: "https://x/activate",
          interval: 0,
          expires_in: 900,
        })
      )
      .mockResolvedValueOnce(
        json({ access_token: "at", refresh_token: "rt", expires_in: 60 })
      );

    await login("app-dev", { onUserCode: jest.fn() });

    expect(getParamMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "app-dev" }),
      "auth0-cli-client-id"
    );
    expect(readCreds()["app-dev"].accessToken).toBe("at");
  });

  it("a rejected device/code request (missing client grant) → ENV_NOT_AUTHORIZED with Auth0's description, no polling", async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          error: "invalid_request",
          error_description:
            'Client "cli-client-123" is not authorized to access resource server "https://api.local.test".',
        },
        403
      )
    );
    const p = login("local", { onUserCode: jest.fn() });
    await expect(p).rejects.toBeInstanceOf(EnvNotAuthorizedError);
    await expect(p).rejects.toThrow(/not authorized to access resource server/);
    expect(fetchMock).toHaveBeenCalledTimes(1); // never polled blind
  });

  it("denied authorization → ENV_NOT_AUTHORIZED", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          device_code: "d",
          user_code: "U",
          verification_uri_complete: "https://x/activate",
          interval: 0,
          expires_in: 900,
        })
      )
      .mockResolvedValueOnce(json({ error: "access_denied" }, 403));

    await expect(
      login("local", { onUserCode: jest.fn() })
    ).rejects.toBeInstanceOf(EnvNotAuthorizedError);
  });
});

describe("getToken", () => {
  it("returns the cached token silently while it's fresh (no network)", async () => {
    writeCreds({
      local: {
        accessToken: "at-cached",
        refreshToken: "rt",
        expiresAt: Date.now() + 3_600_000,
      },
    });
    await expect(getToken("local")).resolves.toBe("at-cached");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("transparently refreshes an expired token and rewrites the cache", async () => {
    writeCreds({
      local: {
        accessToken: "at-old",
        refreshToken: "rt-old",
        expiresAt: Date.now() - 1000,
      },
    });
    fetchMock.mockResolvedValueOnce(
      json({
        access_token: "at-new",
        refresh_token: "rt-new",
        expires_in: 86400,
      })
    );

    await expect(getToken("local")).resolves.toBe("at-new");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://dev-tenant.us.auth0.com/oauth/token");
    expect(String(init.body)).toContain("refresh_token");
    const creds = readCreds();
    expect(creds.local.accessToken).toBe("at-new");
    expect(creds.local.refreshToken).toBe("rt-new");
    expect(fs.statSync(credsFile()).mode & 0o777).toBe(0o600);
  });

  it("no session → ENV_NOT_AUTHORIZED pointing at login", async () => {
    const p = getToken("local");
    await expect(p).rejects.toBeInstanceOf(EnvNotAuthorizedError);
    await expect(p).rejects.toThrow(/login/);
  });

  it("failed refresh → ENV_NOT_AUTHORIZED (re-login required)", async () => {
    writeCreds({
      local: {
        accessToken: "at-old",
        refreshToken: "rt-dead",
        expiresAt: Date.now() - 1000,
      },
    });
    fetchMock.mockResolvedValueOnce(json({ error: "invalid_grant" }, 403));
    await expect(getToken("local")).rejects.toBeInstanceOf(
      EnvNotAuthorizedError
    );
  });
});

describe("logout", () => {
  it("clears the env's entry, leaving other envs' sessions intact", async () => {
    writeCreds({
      local: {
        accessToken: "a",
        refreshToken: "r",
        expiresAt: Date.now() + 1000,
      },
      "app-dev": {
        accessToken: "b",
        refreshToken: "s",
        expiresAt: Date.now() + 1000,
      },
    });
    await logout("local");
    const creds = readCreds();
    expect(creds.local).toBeUndefined();
    expect(creds["app-dev"].accessToken).toBe("b");
  });
});
