import { describe, it, expect } from "@jest/globals";

import { probeInputHash } from "../../utils/probe-hash.util.js";
import type { ProbeHashInput } from "../../utils/probe-hash.util.js";

// Baseline input used by most tests; individual cases mutate fields.
const BASE: ProbeHashInput = {
  organizationId: "org-1",
  baseUrl: "https://api.example.com",
  auth: { mode: "apiKey", keyName: "X-API-Key", placement: "header" },
  credentials: { mode: "apiKey", value: "secret" },
  endpoint: {
    path: "/users",
    method: "GET",
    recordsPath: "data.items",
    transform: undefined,
    idField: "id",
    bodyTemplate: undefined,
    pagination: {
      strategy: "pageOffset",
      style: "page",
      param: "page",
      pageSize: 50,
      startPage: 1,
      stopOnShortPage: true,
    },
  },
};

// Helper: typed deep clone for per-test mutation.
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ── Canonicalization ─────────────────────────────────────────────────

describe("probeInputHash — canonicalization (key order invariance)", () => {
  it("treats different key order on endpoint.pagination as the same input", async () => {
    const a = clone(BASE);
    const b = clone(BASE);
    b.endpoint.pagination = {
      stopOnShortPage: true,
      startPage: 1,
      pageSize: 50,
      param: "page",
      style: "page",
      strategy: "pageOffset",
    };
    expect(await probeInputHash(a)).toBe(await probeInputHash(b));
  });

  it("treats different key order on auth as the same input", async () => {
    const a = clone(BASE);
    const b = clone(BASE);
    b.auth = {
      placement: "header",
      keyName: "X-API-Key",
      mode: "apiKey",
    };
    expect(await probeInputHash(a)).toBe(await probeInputHash(b));
  });
});

// ── Per-field invalidation (endpoint config) ─────────────────────────

describe("probeInputHash — endpoint field invalidation", () => {
  it("changes when endpoint.path changes", async () => {
    const a = clone(BASE);
    const b = clone(BASE);
    b.endpoint.path = "/admins";
    expect(await probeInputHash(a)).not.toBe(await probeInputHash(b));
  });

  it("changes when endpoint.method changes", async () => {
    const a = clone(BASE);
    const b = clone(BASE);
    b.endpoint.method = "POST";
    expect(await probeInputHash(a)).not.toBe(await probeInputHash(b));
  });

  it("changes when endpoint.recordsPath changes", async () => {
    const a = clone(BASE);
    const b = clone(BASE);
    b.endpoint.recordsPath = "data.users";
    expect(await probeInputHash(a)).not.toBe(await probeInputHash(b));
  });

  it("changes when endpoint.transform changes", async () => {
    const a = clone(BASE);
    const b = clone(BASE);
    b.endpoint.transform = "data.items";
    expect(await probeInputHash(a)).not.toBe(await probeInputHash(b));
  });

  it("changes when endpoint.idField changes", async () => {
    const a = clone(BASE);
    const b = clone(BASE);
    b.endpoint.idField = "user_id";
    expect(await probeInputHash(a)).not.toBe(await probeInputHash(b));
  });

  it("changes when endpoint.bodyTemplate changes", async () => {
    const a = clone(BASE);
    a.endpoint.method = "POST";
    a.endpoint.bodyTemplate = '{"q":1}';
    const b = clone(a);
    b.endpoint.bodyTemplate = '{"q":2}';
    expect(await probeInputHash(a)).not.toBe(await probeInputHash(b));
  });
});

describe("probeInputHash — pagination subfield invalidation", () => {
  const cases: Array<[string, () => ProbeHashInput]> = [
    [
      "strategy",
      () => {
        const b = clone(BASE);
        b.endpoint.pagination = { strategy: "none" };
        return b;
      },
    ],
    [
      "param",
      () => {
        const b = clone(BASE);
        if (b.endpoint.pagination.strategy === "pageOffset") {
          b.endpoint.pagination.param = "offset";
        }
        return b;
      },
    ],
    [
      "style",
      () => {
        const b = clone(BASE);
        if (b.endpoint.pagination.strategy === "pageOffset") {
          b.endpoint.pagination.style = "offset";
        }
        return b;
      },
    ],
    [
      "pageSize",
      () => {
        const b = clone(BASE);
        if (b.endpoint.pagination.strategy === "pageOffset") {
          b.endpoint.pagination.pageSize = 100;
        }
        return b;
      },
    ],
    [
      "cursorParam (cursor strategy)",
      () => {
        const b = clone(BASE);
        b.endpoint.pagination = {
          strategy: "cursor",
          cursorParam: "after",
          cursorPlacement: "query",
          cursorResponsePath: "meta.next",
        };
        return b;
      },
    ],
    [
      "cursorPlacement (cursor strategy)",
      () => {
        const b = clone(BASE);
        b.endpoint.pagination = {
          strategy: "cursor",
          cursorParam: "after",
          cursorPlacement: "body",
          cursorResponsePath: "meta.next",
        };
        return b;
      },
    ],
    [
      "cursorResponsePath (cursor strategy)",
      () => {
        const b = clone(BASE);
        b.endpoint.pagination = {
          strategy: "cursor",
          cursorParam: "after",
          cursorPlacement: "query",
          cursorResponsePath: "links.next",
        };
        return b;
      },
    ],
  ];

  for (const [name, build] of cases) {
    it(`changes when pagination.${name} changes`, async () => {
      const baseHash = await probeInputHash(BASE);
      const mutatedHash = await probeInputHash(build());
      expect(baseHash).not.toBe(mutatedHash);
    });
  }
});

// ── Display-only fields (rename-only) ────────────────────────────────

describe("probeInputHash — display-only fields excluded from the hash", () => {
  it("ignores `endpoint.key` (rename-only field, not in projection)", async () => {
    const a = clone(BASE);
    const b = clone(BASE);
    // Inject a rogue `key` field via cast — defense in depth.
    (b.endpoint as Record<string, unknown>).key = "different-key";
    expect(await probeInputHash(a)).toBe(await probeInputHash(b));
  });

  it("ignores `endpoint.label` (rename-only field, not in projection)", async () => {
    const a = clone(BASE);
    const b = clone(BASE);
    (b.endpoint as Record<string, unknown>).label = "different label";
    expect(await probeInputHash(a)).toBe(await probeInputHash(b));
  });
});

// ── Instance-level invalidation ──────────────────────────────────────

describe("probeInputHash — instance-level invalidation", () => {
  it("changes when baseUrl changes", async () => {
    const b = clone(BASE);
    b.baseUrl = "https://api.example.org";
    expect(await probeInputHash(BASE)).not.toBe(await probeInputHash(b));
  });

  it("changes when auth.mode changes", async () => {
    const b = clone(BASE);
    b.auth = { mode: "none" };
    expect(await probeInputHash(BASE)).not.toBe(await probeInputHash(b));
  });

  it("changes when auth.keyName changes (apiKey mode)", async () => {
    const b = clone(BASE);
    b.auth = { mode: "apiKey", keyName: "X-Other-Key", placement: "header" };
    expect(await probeInputHash(BASE)).not.toBe(await probeInputHash(b));
  });

  it("changes when auth.placement changes (apiKey mode)", async () => {
    const b = clone(BASE);
    b.auth = { mode: "apiKey", keyName: "X-API-Key", placement: "query" };
    expect(await probeInputHash(BASE)).not.toBe(await probeInputHash(b));
  });
});

// ── Credentials ──────────────────────────────────────────────────────

describe("probeInputHash — credentials invalidation", () => {
  it("changes when a credentials secret changes", async () => {
    const b = clone(BASE);
    b.credentials = { mode: "apiKey", value: "different-secret" };
    expect(await probeInputHash(BASE)).not.toBe(await probeInputHash(b));
  });

  it("distinguishes credentials = null from credentials = {}", async () => {
    const a = clone(BASE);
    a.credentials = null;
    const b = clone(BASE);
    // Cast — `{}` is not a valid ApiCredentials value, but defense in
    // depth: missing-credentials and empty-credentials must hash apart.
    b.credentials = {} as unknown as ProbeHashInput["credentials"];
    expect(await probeInputHash(a)).not.toBe(await probeInputHash(b));
  });
});

// ── organizationId ───────────────────────────────────────────────────

describe("probeInputHash — organization scope", () => {
  it("changes when organizationId changes (server cache must not collide across orgs)", async () => {
    const b = clone(BASE);
    b.organizationId = "org-2";
    expect(await probeInputHash(BASE)).not.toBe(await probeInputHash(b));
  });
});

// ── Defense in depth ─────────────────────────────────────────────────

describe("probeInputHash — defense in depth", () => {
  it("ignores extra unrelated keys at the top level", async () => {
    const baseHash = await probeInputHash(BASE);
    const polluted = {
      ...BASE,
      bogusField: "should be ignored",
      anotherBogus: { nested: 42 },
    } as unknown as ProbeHashInput;
    expect(await probeInputHash(polluted)).toBe(baseHash);
  });
});

// ── Output shape + determinism ───────────────────────────────────────

describe("probeInputHash — output shape", () => {
  it("returns 64 hex characters and is deterministic across consecutive calls", async () => {
    const first = await probeInputHash(BASE);
    const second = await probeInputHash(BASE);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });
});
