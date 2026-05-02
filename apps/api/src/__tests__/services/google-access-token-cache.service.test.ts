import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// In-memory Redis stand-in.
const store = new Map<string, string>();

jest.unstable_mockModule("../../utils/redis.util.js", () => ({
  getRedisClient: () => ({
    async set(key: string, value: string, _ex: string, ttl: number) {
      store.set(key, value);
      // Track TTL via a sidecar key so tests can assert it.
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
    ) => Promise<{ accessToken: string; expiresIn: number }>
  >();
const updateInstanceMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const findByIdMock = jest.fn<(id: string) => Promise<unknown>>();

class MockGoogleAuthError extends Error {
  override readonly name = "GoogleAuthError" as const;
  readonly kind: string;
  constructor(kind: string, message?: string) {
    super(message ?? kind);
    this.kind = kind;
  }
}

jest.unstable_mockModule("../../services/google-auth.service.js", () => ({
  GoogleAuthService: { refreshAccessToken: refreshAccessTokenMock },
  GoogleAuthError: MockGoogleAuthError,
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

const { GoogleAuthError } = await import(
  "../../services/google-auth.service.js"
);
const { GoogleAccessTokenCacheService } = await import(
  "../../services/google-access-token-cache.service.js"
);

const INSTANCE_ID = "ci-instance-1";
const cacheKey = `connector:access:google-sheets:${INSTANCE_ID}`;

beforeEach(() => {
  store.clear();
  refreshAccessTokenMock.mockReset();
  updateInstanceMock.mockReset();
  findByIdMock.mockReset();
  GoogleAccessTokenCacheService.__resetInflightForTests();
  findByIdMock.mockResolvedValue({
    id: INSTANCE_ID,
    credentials: { refresh_token: "1//refresh-token" },
  });
});

describe("GoogleAccessTokenCacheService.getOrRefresh", () => {
  it("returns the cached token without calling refreshAccessToken (cache hit)", async () => {
    store.set(cacheKey, "cached-token");
    const out = await GoogleAccessTokenCacheService.getOrRefresh(INSTANCE_ID);
    expect(out).toBe("cached-token");
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
  });

  it("refreshes on cache miss and stores with TTL = expiresIn - 600", async () => {
    refreshAccessTokenMock.mockResolvedValue({
      accessToken: "ya29.fresh",
      expiresIn: 3600,
    });
    const out = await GoogleAccessTokenCacheService.getOrRefresh(INSTANCE_ID);
    expect(out).toBe("ya29.fresh");
    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(refreshAccessTokenMock).toHaveBeenCalledWith("1//refresh-token");
    expect(store.get(cacheKey)).toBe("ya29.fresh");
    expect(store.get(`__ttl:${cacheKey}`)).toBe(String(3600 - 600));
  });

  it("clamps the TTL to a 60s floor when expiresIn is unusually small", async () => {
    refreshAccessTokenMock.mockResolvedValue({
      accessToken: "ya29.short",
      expiresIn: 30,
    });
    await GoogleAccessTokenCacheService.getOrRefresh(INSTANCE_ID);
    expect(store.get(`__ttl:${cacheKey}`)).toBe("60");
  });

  it("single-flights concurrent misses (refresh called exactly once)", async () => {
    let resolveRefresh: (v: { accessToken: string; expiresIn: number }) => void;
    refreshAccessTokenMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      })
    );

    const p1 = GoogleAccessTokenCacheService.getOrRefresh(INSTANCE_ID);
    const p2 = GoogleAccessTokenCacheService.getOrRefresh(INSTANCE_ID);
    const p3 = GoogleAccessTokenCacheService.getOrRefresh(INSTANCE_ID);

    resolveRefresh!({ accessToken: "ya29.shared", expiresIn: 3600 });

    const [a, b, c] = await Promise.all([p1, p2, p3]);
    expect(a).toBe("ya29.shared");
    expect(b).toBe("ya29.shared");
    expect(c).toBe("ya29.shared");
    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
  });

  it("on refresh failure, marks instance status=error with lastErrorMessage and rethrows", async () => {
    refreshAccessTokenMock.mockRejectedValue(
      new GoogleAuthError("refresh_failed", "Token has been expired")
    );
    updateInstanceMock.mockResolvedValue({});

    await expect(
      GoogleAccessTokenCacheService.getOrRefresh(INSTANCE_ID)
    ).rejects.toMatchObject({
      name: "GoogleAuthError",
      kind: "refresh_failed",
    });

    expect(updateInstanceMock).toHaveBeenCalledTimes(1);
    const [calledId, calledData] = updateInstanceMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(calledId).toBe(INSTANCE_ID);
    expect(calledData.status).toBe("error");
    expect(calledData.lastErrorMessage).toContain("Token has been expired");
  });

  it("throws when the instance has no refresh_token in its credentials", async () => {
    findByIdMock.mockResolvedValue({
      id: INSTANCE_ID,
      credentials: { googleAccountEmail: "alice@example.com" }, // no refresh_token
    });
    await expect(
      GoogleAccessTokenCacheService.getOrRefresh(INSTANCE_ID)
    ).rejects.toThrow(/refresh_token/);
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
  });

  it("throws when the instance does not exist", async () => {
    findByIdMock.mockResolvedValue(undefined);
    await expect(
      GoogleAccessTokenCacheService.getOrRefresh(INSTANCE_ID)
    ).rejects.toThrow(/not found/i);
  });
});
