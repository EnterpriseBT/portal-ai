import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// In-memory Redis stand-in.
const store = new Map<string, string>();

jest.unstable_mockModule("../../utils/redis.util.js", () => ({
  getRedisClient: () => ({
    async set(key: string, value: string, _ex: string, ttl: number) {
      store.set(key, value);
      store.set(`__ttl:${key}`, String(ttl));
      return "OK";
    },
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async del(key: string) {
      const had = store.has(key);
      store.delete(key);
      return had ? 1 : 0;
    },
  }),
}));

const refreshAccessTokenMock =
  jest.fn<
    (
      refreshToken: string
    ) => Promise<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      scope: string;
    }>
  >();
const updateInstanceMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const findByIdMock = jest.fn<(id: string) => Promise<unknown>>();

class MockMicrosoftAuthError extends Error {
  override readonly name = "MicrosoftAuthError" as const;
  readonly kind: string;
  constructor(kind: string, message?: string) {
    super(message ?? kind);
    this.kind = kind;
  }
}

jest.unstable_mockModule("../../services/microsoft-auth.service.js", () => ({
  MicrosoftAuthService: { refreshAccessToken: refreshAccessTokenMock },
  MicrosoftAuthError: MockMicrosoftAuthError,
}));

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      connectorInstances: {
        findById: findByIdMock,
        update: updateInstanceMock,
      },
    },
  },
}));

const { MicrosoftAuthError } = await import(
  "../../services/microsoft-auth.service.js"
);
const { MicrosoftAccessTokenCacheService } = await import(
  "../../services/microsoft-access-token-cache.service.js"
);

const INSTANCE_ID = "ci-msft-1";
const cacheKey = `connector:access:microsoft-excel:${INSTANCE_ID}`;

const baselineCredentials = {
  refresh_token: "0.AX-old",
  scopes: ["openid", "offline_access", "Files.Read.All"],
  microsoftAccountUpn: "alice@contoso.com",
  microsoftAccountEmail: "alice@contoso.com",
  microsoftAccountDisplayName: "Alice Smith",
  tenantId: "tenant-1",
  lastRefreshedAt: 0,
};

beforeEach(() => {
  store.clear();
  refreshAccessTokenMock.mockReset();
  updateInstanceMock.mockReset();
  findByIdMock.mockReset();
  MicrosoftAccessTokenCacheService.__resetInflightForTests();
  findByIdMock.mockResolvedValue({
    id: INSTANCE_ID,
    credentials: { ...baselineCredentials },
  });
  updateInstanceMock.mockResolvedValue({});
});

describe("MicrosoftAccessTokenCacheService.getOrRefresh", () => {
  it("returns the cached token without calling refreshAccessToken (cache hit)", async () => {
    store.set(cacheKey, "cached-token");
    const out = await MicrosoftAccessTokenCacheService.getOrRefresh(INSTANCE_ID);
    expect(out).toBe("cached-token");
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
    expect(updateInstanceMock).not.toHaveBeenCalled();
  });

  it("refreshes on cache miss and stores access token with TTL = expiresIn - 600", async () => {
    refreshAccessTokenMock.mockResolvedValue({
      accessToken: "eyJ.fresh",
      refreshToken: "0.AX-rotated",
      expiresIn: 3600,
      scope: "openid offline_access Files.Read.All",
    });
    const out = await MicrosoftAccessTokenCacheService.getOrRefresh(INSTANCE_ID);
    expect(out).toBe("eyJ.fresh");
    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(refreshAccessTokenMock).toHaveBeenCalledWith("0.AX-old");
    expect(store.get(cacheKey)).toBe("eyJ.fresh");
    expect(store.get(`__ttl:${cacheKey}`)).toBe(String(3600 - 600));
  });

  it("clamps the TTL to a 60s floor when expiresIn is unusually small", async () => {
    refreshAccessTokenMock.mockResolvedValue({
      accessToken: "eyJ.short",
      refreshToken: "0.AX-rotated",
      expiresIn: 30,
      scope: "openid",
    });
    await MicrosoftAccessTokenCacheService.getOrRefresh(INSTANCE_ID);
    expect(store.get(`__ttl:${cacheKey}`)).toBe("60");
  });

  it("persists the rotated refresh_token back into credentials, preserving the other fields", async () => {
    refreshAccessTokenMock.mockResolvedValue({
      accessToken: "eyJ.fresh",
      refreshToken: "0.AX-rotated",
      expiresIn: 3600,
      scope: "openid offline_access Files.Read.All",
    });
    const before = Date.now();
    await MicrosoftAccessTokenCacheService.getOrRefresh(INSTANCE_ID);
    expect(updateInstanceMock).toHaveBeenCalledTimes(1);
    const [calledId, calledData] = updateInstanceMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(calledId).toBe(INSTANCE_ID);
    const updatedCreds = calledData.credentials as Record<string, unknown>;
    expect(updatedCreds.refresh_token).toBe("0.AX-rotated");
    expect(updatedCreds.microsoftAccountUpn).toBe("alice@contoso.com");
    expect(updatedCreds.microsoftAccountEmail).toBe("alice@contoso.com");
    expect(updatedCreds.microsoftAccountDisplayName).toBe("Alice Smith");
    expect(updatedCreds.tenantId).toBe("tenant-1");
    expect(updatedCreds.scopes).toEqual([
      "openid",
      "offline_access",
      "Files.Read.All",
    ]);
    expect(typeof updatedCreds.lastRefreshedAt).toBe("number");
    expect(updatedCreds.lastRefreshedAt as number).toBeGreaterThanOrEqual(
      before
    );
  });

  it("single-flights concurrent misses (refresh + persist called exactly once)", async () => {
    let resolveRefresh!: (v: {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      scope: string;
    }) => void;
    refreshAccessTokenMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      })
    );

    const p1 = MicrosoftAccessTokenCacheService.getOrRefresh(INSTANCE_ID);
    const p2 = MicrosoftAccessTokenCacheService.getOrRefresh(INSTANCE_ID);
    const p3 = MicrosoftAccessTokenCacheService.getOrRefresh(INSTANCE_ID);

    resolveRefresh({
      accessToken: "eyJ.shared",
      refreshToken: "0.AX-rotated-once",
      expiresIn: 3600,
      scope: "openid",
    });

    const [a, b, c] = await Promise.all([p1, p2, p3]);
    expect(a).toBe("eyJ.shared");
    expect(b).toBe("eyJ.shared");
    expect(c).toBe("eyJ.shared");
    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
    // Persist write happens once per refresh — not per concurrent caller.
    expect(updateInstanceMock).toHaveBeenCalledTimes(1);
  });

  it("on refresh failure, marks instance status=error with lastErrorMessage and rethrows", async () => {
    refreshAccessTokenMock.mockRejectedValue(
      new MicrosoftAuthError(
        "refresh_failed",
        "AADSTS70008: refresh token expired"
      )
    );

    await expect(
      MicrosoftAccessTokenCacheService.getOrRefresh(INSTANCE_ID)
    ).rejects.toMatchObject({
      name: "MicrosoftAuthError",
      kind: "refresh_failed",
    });

    expect(updateInstanceMock).toHaveBeenCalledTimes(1);
    const [calledId, calledData] = updateInstanceMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(calledId).toBe(INSTANCE_ID);
    expect(calledData.status).toBe("error");
    expect(calledData.lastErrorMessage).toContain("AADSTS70008");
  });

  it("throws when the instance has no refresh_token in its credentials", async () => {
    findByIdMock.mockResolvedValue({
      id: INSTANCE_ID,
      credentials: { microsoftAccountUpn: "alice@contoso.com" },
    });
    await expect(
      MicrosoftAccessTokenCacheService.getOrRefresh(INSTANCE_ID)
    ).rejects.toThrow(/refresh_token/);
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
  });

  it("throws when the instance does not exist", async () => {
    findByIdMock.mockResolvedValue(undefined);
    await expect(
      MicrosoftAccessTokenCacheService.getOrRefresh(INSTANCE_ID)
    ).rejects.toThrow(/not found/i);
  });
});
