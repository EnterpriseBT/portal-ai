import { jest } from "@jest/globals";

// ── Mocks: the composed modules (each already unit-tested) ───────────

const getDatabaseUrlMock = jest.fn<() => Promise<string>>();
jest.unstable_mockModule("../aws.js", () => ({
  getDatabaseUrl: getDatabaseUrlMock,
}));

const tunnelClose = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const openDbTunnelMock = jest.fn<
  (def: unknown, opts: unknown) => Promise<{ localPort: number; close: () => Promise<void> }>
>();
jest.unstable_mockModule("../tunnel.js", () => ({
  openDbTunnel: openDbTunnelMock,
}));

const getTokenMock = jest.fn<(env: string) => Promise<string>>();
jest.unstable_mockModule("../auth0.js", () => ({
  getToken: getTokenMock,
}));

const { resolveEnvConnection } = await import("../connection.js");
const { EnvNotConfiguredError } = await import("../errors.js");

beforeEach(() => {
  getDatabaseUrlMock.mockReset();
  openDbTunnelMock.mockReset();
  tunnelClose.mockClear();
  getTokenMock.mockReset();
  delete process.env.DATABASE_URL;
});

describe("resolveEnvConnection", () => {
  it("is lazy: resolving does registry lookup only — no AWS/tunnel/token I/O", async () => {
    const conn = await resolveEnvConnection("app-dev");
    expect(conn.env).toBe("app-dev");
    expect(conn.kind).toBe("staging");
    expect(conn.apiBaseUrl).toBe("https://api-dev.portalsai.io");
    expect(getDatabaseUrlMock).not.toHaveBeenCalled();
    expect(openDbTunnelMock).not.toHaveBeenCalled();
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it("local db() reads DATABASE_URL from the process env — zero AWS", async () => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/portalai";
    const conn = await resolveEnvConnection("local");
    const db = await conn.db();
    expect(db.connectionString).toBe("postgresql://u:p@localhost:5432/portalai");
    expect(getDatabaseUrlMock).not.toHaveBeenCalled();
    expect(openDbTunnelMock).not.toHaveBeenCalled();
  });

  it("local db() without DATABASE_URL → ENV_NOT_CONFIGURED", async () => {
    const conn = await resolveEnvConnection("local");
    await expect(conn.db()).rejects.toBeInstanceOf(EnvNotConfiguredError);
  });

  it("AWS db(): parses the secret URL, tunnels to its endpoint, rewrites to localhost — and reuses the handle", async () => {
    getDatabaseUrlMock.mockResolvedValue(
      "postgresql://portal:s3cr%40t@db.cluster.internal:5432/portalai?sslmode=require"
    );
    openDbTunnelMock.mockResolvedValue({ localPort: 15432, close: tunnelClose });

    const conn = await resolveEnvConnection("app-dev");
    const db = await conn.db();

    expect(openDbTunnelMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "app-dev" }),
      expect.objectContaining({ remoteHost: "db.cluster.internal", remotePort: 5432 })
    );
    // Credentials, db name and query survive; the endpoint becomes the tunnel.
    expect(db.connectionString).toBe(
      "postgresql://portal:s3cr%40t@localhost:15432/portalai?sslmode=require"
    );

    // Second db() reuses the open tunnel.
    await conn.db();
    expect(openDbTunnelMock).toHaveBeenCalledTimes(1);
  });

  it("token() delegates to the env's cached session", async () => {
    getTokenMock.mockResolvedValue("at-123");
    const conn = await resolveEnvConnection("app-dev");
    await expect(conn.token()).resolves.toBe("at-123");
    expect(getTokenMock).toHaveBeenCalledWith("app-dev");
  });

  it("dispose() closes the tunnel and is idempotent", async () => {
    getDatabaseUrlMock.mockResolvedValue("postgresql://u:p@h:5432/db");
    openDbTunnelMock.mockResolvedValue({ localPort: 15432, close: tunnelClose });

    const conn = await resolveEnvConnection("app-dev");
    await conn.db();
    await conn.dispose();
    await conn.dispose();
    expect(tunnelClose).toHaveBeenCalledTimes(1);
  });
});
