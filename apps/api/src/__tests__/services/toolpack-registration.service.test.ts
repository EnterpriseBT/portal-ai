/* eslint-disable @typescript-eslint/no-explicit-any */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch =
  jest.fn<(url: string, options?: Record<string, any>) => Promise<unknown>>();
(globalThis as any).fetch = mockFetch;

// Silence the logger
jest.unstable_mockModule("../../utils/logger.util.js", () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const { ToolpackRegistrationService } =
  await import("../../services/toolpack-registration.service.js");
const { ApiCode } = await import("../../constants/api-codes.constants.js");
const { environment } = await import("../../environment.js");
const { OutboundFetchBlockedError } =
  await import("../../utils/guarded-fetch.util.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fetchOk(body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    headers: new Map([["content-length", String(text.length)]]),
    text: async () => text,
  };
}

const VALID_SCHEMA_RESPONSE = {
  tools: [
    {
      name: "lookup_company",
      description: "Look up a company by domain.",
      parameterSchema: { type: "object", properties: {} },
    },
    {
      name: "lookup_person",
      description: "Look up a person by email.",
      parameterSchema: { type: "object", properties: {} },
    },
  ],
};

const BUILTIN_NAMES = new Set(["sql_query", "hypothesis_test"]);

const SECRET = "whsec_" + "A".repeat(43);

function fetchStatus(status: number, statusText = "") {
  return {
    ok: false,
    status,
    statusText,
    headers: new Map(),
    text: async () => "",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ToolpackRegistrationService", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // ── fetchSchema ───────────────────────────────────────────────────

  describe("fetchSchema", () => {
    // Case 80
    it("posts/gets the URL with the right headers and parses a valid response", async () => {
      mockFetch.mockResolvedValue(fetchOk(VALID_SCHEMA_RESPONSE));
      const tools = await ToolpackRegistrationService.fetchSchema(
        "https://example.com/schema",
        { "X-Api-Key": "secret" }
      );
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("lookup_company");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://example.com/schema");
      expect(options!.method).toBe("GET");
      expect(options!.headers["X-Api-Key"]).toBe("secret");
    });

    // Case 81
    it("rejects oversize bodies with TOOLPACK_SCHEMA_TOO_LARGE", async () => {
      const huge = "x".repeat(300_000);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-length", String(huge.length)]]),
        text: async () => huge,
      });

      await expect(
        ToolpackRegistrationService.fetchSchema(
          "https://example.com/schema",
          undefined
        )
      ).rejects.toMatchObject({ code: ApiCode.TOOLPACK_SCHEMA_TOO_LARGE });
    });

    // Case 82
    it("rejects malformed JSON with TOOLPACK_SCHEMA_INVALID", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([["content-length", "10"]]),
        text: async () => "not json",
      });

      await expect(
        ToolpackRegistrationService.fetchSchema(
          "https://example.com/schema",
          undefined
        )
      ).rejects.toMatchObject({ code: ApiCode.TOOLPACK_SCHEMA_INVALID });
    });

    // Case 83
    it("rejects HTTP errors with TOOLPACK_SCHEMA_FETCH_FAILED", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        headers: new Map(),
        text: async () => "",
      });

      await expect(
        ToolpackRegistrationService.fetchSchema(
          "https://example.com/schema",
          undefined
        )
      ).rejects.toMatchObject({
        code: ApiCode.TOOLPACK_SCHEMA_FETCH_FAILED,
      });
    });

    // #911: a server that refuses the signature gets a code that says so.
    it.each([401, 403])(
      "rejects a %i with TOOLPACK_SIGNATURE_REJECTED (502, details.status)",
      async (status) => {
        mockFetch.mockResolvedValue(fetchStatus(status, "Unauthorized"));

        const err = await ToolpackRegistrationService.fetchSchema(
          "https://example.com/schema",
          undefined,
          SECRET
        ).catch((e: unknown) => e);

        expect(err).toMatchObject({
          status: 502,
          code: ApiCode.TOOLPACK_SIGNATURE_REJECTED,
          details: { url: "https://example.com/schema", status },
        });
        expect((err as Error).message).toContain("Verifying requests");
        expect(JSON.stringify(err)).not.toContain(SECRET);
        expect((err as Error).message).not.toContain(SECRET);
      }
    );

    // A 401/403 is only a signature rejection when a signature was sent.
    it("keeps TOOLPACK_SCHEMA_FETCH_FAILED for a 401 to an unsigned fetch", async () => {
      mockFetch.mockResolvedValue(fetchStatus(401));
      await expect(
        ToolpackRegistrationService.fetchSchema(
          "https://example.com/schema",
          undefined
        )
      ).rejects.toMatchObject({ code: ApiCode.TOOLPACK_SCHEMA_FETCH_FAILED });
    });

    it("keeps TOOLPACK_SCHEMA_FETCH_FAILED when signing is disabled", async () => {
      const env = environment as { TOOLPACK_DISABLE_SIGNING: boolean };
      env.TOOLPACK_DISABLE_SIGNING = true;
      try {
        mockFetch.mockResolvedValue(fetchStatus(403));
        await expect(
          ToolpackRegistrationService.fetchSchema(
            "https://example.com/schema",
            undefined,
            SECRET
          )
        ).rejects.toMatchObject({
          code: ApiCode.TOOLPACK_SCHEMA_FETCH_FAILED,
        });
      } finally {
        env.TOOLPACK_DISABLE_SIGNING = false;
      }
    });

    it("names the auth headers as a possible cause when they were sent", async () => {
      mockFetch.mockResolvedValue(fetchStatus(401));
      const err = await ToolpackRegistrationService.fetchSchema(
        "https://example.com/schema",
        { Authorization: "Bearer expired-token" },
        SECRET
      ).catch((e: unknown) => e);
      expect(err).toMatchObject({ code: ApiCode.TOOLPACK_SIGNATURE_REJECTED });
      expect((err as Error).message).toMatch(/auth headers/);
      expect((err as Error).message).not.toContain("expired-token");
    });

    it("keeps TOOLPACK_SCHEMA_FETCH_FAILED for a 500", async () => {
      mockFetch.mockResolvedValue(fetchStatus(500, "Internal"));
      await expect(
        ToolpackRegistrationService.fetchSchema(
          "https://example.com/schema",
          undefined,
          SECRET
        )
      ).rejects.toMatchObject({ code: ApiCode.TOOLPACK_SCHEMA_FETCH_FAILED });
    });

    // Case 84
    it("rejects schema responses missing the tools array", async () => {
      mockFetch.mockResolvedValue(fetchOk({ notTools: [] }));
      await expect(
        ToolpackRegistrationService.fetchSchema(
          "https://example.com/schema",
          undefined
        )
      ).rejects.toMatchObject({ code: ApiCode.TOOLPACK_SCHEMA_INVALID });
    });

    // Case 85
    it("rejects when a tool name fails the slug regex", async () => {
      mockFetch.mockResolvedValue(
        fetchOk({
          tools: [
            {
              name: "Bad Tool",
              description: "x",
              parameterSchema: { type: "object", properties: {} },
            },
          ],
        })
      );
      await expect(
        ToolpackRegistrationService.fetchSchema(
          "https://example.com/schema",
          undefined
        )
      ).rejects.toMatchObject({ code: ApiCode.TOOLPACK_SCHEMA_INVALID });
    });

    // Case 86
    it("enforces the 30s timeout via AbortController", async () => {
      // Inspect the AbortController signal passed to fetch
      mockFetch.mockImplementation(async (_url, opts) => {
        expect(opts!.signal).toBeDefined();
        return fetchOk(VALID_SCHEMA_RESPONSE);
      });

      await ToolpackRegistrationService.fetchSchema(
        "https://example.com/schema",
        undefined
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // ── capability subset (#121 child I) ────────────────────────────
    const toolWithCapability = (capability: Record<string, unknown>) => ({
      tools: [
        {
          name: "summarize",
          description: "Summarize the records.",
          parameterSchema: { type: "object", properties: {} },
          capability,
        },
      ],
    });

    const pureConsumerCapability = {
      pure: true,
      reads: [],
      writes: [],
      consumption: { mode: "none" },
      computeShape: "reduce",
      costHint: "free",
      locks: [],
      resultKind: "data-table",
      production: { kind: "rows", onLarge: "handle" },
      alwaysAvailable: false,
    };

    it("accepts a tool declaring a valid pure-consumer capability", async () => {
      mockFetch.mockResolvedValue(
        fetchOk(toolWithCapability(pureConsumerCapability))
      );
      const tools = await ToolpackRegistrationService.fetchSchema(
        "https://example.com/schema",
        undefined
      );
      expect(tools[0].capability).toMatchObject({ pure: true });
    });

    it("accepts a tool with no capability (legacy inline tool)", async () => {
      mockFetch.mockResolvedValue(fetchOk(VALID_SCHEMA_RESPONSE));
      const tools = await ToolpackRegistrationService.fetchSchema(
        "https://example.com/schema",
        undefined
      );
      expect(tools[0].capability).toBeUndefined();
    });

    it("rejects a capability outside the subset (non-pure) with TOOLPACK_CAPABILITY_INVALID", async () => {
      mockFetch.mockResolvedValue(
        fetchOk(
          toolWithCapability({
            ...pureConsumerCapability,
            pure: false,
            reads: ["entity_records"],
            consumption: { mode: "engine-pushdown" },
          })
        )
      );
      await expect(
        ToolpackRegistrationService.fetchSchema(
          "https://example.com/schema",
          undefined
        )
      ).rejects.toMatchObject({ code: ApiCode.TOOLPACK_CAPABILITY_INVALID });
    });

    it("accepts a bounded consumption mode (#124 slice 3 — records-in-body)", async () => {
      mockFetch.mockResolvedValue(
        fetchOk(
          toolWithCapability({
            ...pureConsumerCapability,
            consumption: {
              mode: "bounded",
              maxRows: 1000,
              onOverflow: "error",
            },
          })
        )
      );
      const tools = await ToolpackRegistrationService.fetchSchema(
        "https://example.com/schema",
        undefined
      );
      expect(tools[0].capability?.consumption).toMatchObject({
        mode: "bounded",
        maxRows: 1000,
      });
    });

    it("accepts a streaming consumption mode (#124 slice 4 — pull-on-read)", async () => {
      mockFetch.mockResolvedValue(
        fetchOk(
          toolWithCapability({
            ...pureConsumerCapability,
            consumption: { mode: "streaming" },
          })
        )
      );
      const tools = await ToolpackRegistrationService.fetchSchema(
        "https://example.com/schema",
        undefined
      );
      expect(tools[0].capability?.consumption).toMatchObject({
        mode: "streaming",
      });
    });

    it("still rejects engine-pushdown for custom tools (no backend access)", async () => {
      mockFetch.mockResolvedValue(
        fetchOk(
          toolWithCapability({
            ...pureConsumerCapability,
            pure: false,
            reads: ["entity_records"],
            consumption: { mode: "engine-pushdown" },
          })
        )
      );
      await expect(
        ToolpackRegistrationService.fetchSchema(
          "https://example.com/schema",
          undefined
        )
      ).rejects.toMatchObject({ code: ApiCode.TOOLPACK_CAPABILITY_INVALID });
    });
  });

  // ── fetchMetadata ─────────────────────────────────────────────────

  describe("fetchMetadata", () => {
    // Case 87
    it("returns null on HTTP errors (best-effort)", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal",
        headers: new Map(),
        text: async () => "",
      });
      const result = await ToolpackRegistrationService.fetchMetadata(
        "https://example.com/metadata",
        undefined
      );
      expect(result).toBeNull();
    });

    // #911: a refused signature fails the registration rather than
    // registering silently without metadata.
    it.each([401, 403])(
      "throws TOOLPACK_SIGNATURE_REJECTED on a %i",
      async (status) => {
        mockFetch.mockResolvedValue(fetchStatus(status));

        const err = await ToolpackRegistrationService.fetchMetadata(
          "https://example.com/metadata",
          undefined,
          SECRET
        ).catch((e: unknown) => e);

        expect(err).toMatchObject({
          status: 502,
          code: ApiCode.TOOLPACK_SIGNATURE_REJECTED,
          details: { url: "https://example.com/metadata", status },
        });
        expect((err as Error).message).not.toContain(SECRET);
      }
    );

    it("returns null on a 401 to an unsigned fetch", async () => {
      mockFetch.mockResolvedValue(fetchStatus(401));
      const result = await ToolpackRegistrationService.fetchMetadata(
        "https://example.com/metadata",
        undefined
      );
      expect(result).toBeNull();
    });

    it("still returns null on a 404", async () => {
      mockFetch.mockResolvedValue(fetchStatus(404, "Not Found"));
      const result = await ToolpackRegistrationService.fetchMetadata(
        "https://example.com/metadata",
        undefined,
        SECRET
      );
      expect(result).toBeNull();
    });

    // Case 88
    it("returns null on validation errors", async () => {
      mockFetch.mockResolvedValue(fetchOk("not an object"));
      const result = await ToolpackRegistrationService.fetchMetadata(
        "https://example.com/metadata",
        undefined
      );
      expect(result).toBeNull();
    });

    // Case 89
    it("returns the parsed object on success", async () => {
      const meta = {
        summary: "External customer intelligence calls.",
        tools: [
          {
            name: "lookup_company",
            description: "Looks up a company by domain.",
            examples: [
              {
                title: "Example",
                input: { domain: "example.com" },
              },
            ],
          },
        ],
      };
      mockFetch.mockResolvedValue(fetchOk(meta));

      const result = await ToolpackRegistrationService.fetchMetadata(
        "https://example.com/metadata",
        undefined
      );
      expect(result).not.toBeNull();
      expect(result!.summary).toBe(meta.summary);
      expect(result!.tools).toHaveLength(1);
    });
  });

  // ── validateNoBuiltinCollision ────────────────────────────────────

  // ── #931: fetches go through guardedFetch ─────────────────────────

  describe("outbound guard (#931)", () => {
    function redirectTo(status: number, location: string) {
      return {
        ok: false,
        status,
        statusText: "",
        headers: new Map([["location", location]]),
        text: async () => "",
      };
    }

    it("fetches with manual redirects and the guarded dispatcher", async () => {
      mockFetch.mockResolvedValue(fetchOk(VALID_SCHEMA_RESPONSE));
      await ToolpackRegistrationService.fetchSchema(
        "https://example.com/schema",
        undefined
      );
      const [, options] = mockFetch.mock.calls[0];
      expect(options!.redirect).toBe("manual");
      expect(options!.dispatcher).toBeDefined();
    });

    it("refuses a redirect from the schema endpoint", async () => {
      mockFetch.mockResolvedValue(
        redirectTo(302, "http://169.254.169.254/latest/meta-data/")
      );
      const err = await ToolpackRegistrationService.fetchSchema(
        "https://example.com/schema",
        undefined
      ).catch((e: unknown) => e);

      expect(err).toMatchObject({
        status: 502,
        code: ApiCode.TOOLPACK_REDIRECT_REFUSED,
        details: { url: "https://example.com/schema", status: 302 },
      });
      expect(JSON.stringify(err)).not.toContain("169.254");
      expect((err as Error).message).not.toContain("169.254");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("throws, rather than skipping metadata, on a metadata redirect", async () => {
      mockFetch.mockResolvedValue(redirectTo(301, "https://elsewhere.test/m"));
      await expect(
        ToolpackRegistrationService.fetchMetadata(
          "https://example.com/metadata",
          undefined
        )
      ).rejects.toMatchObject({ code: ApiCode.TOOLPACK_REDIRECT_REFUSED });
    });

    it("maps a connect-time refusal to TOOLPACK_URL_PRIVATE_HOST", async () => {
      mockFetch.mockRejectedValue(
        new TypeError("fetch failed", {
          cause: new OutboundFetchBlockedError(
            "private-address",
            "https://example.com/schema"
          ),
        })
      );
      for (const call of [
        () =>
          ToolpackRegistrationService.fetchSchema(
            "https://example.com/schema",
            undefined
          ),
        () =>
          ToolpackRegistrationService.fetchMetadata(
            "https://example.com/metadata",
            undefined
          ),
      ]) {
        await expect(call()).rejects.toMatchObject({
          status: 502,
          code: ApiCode.TOOLPACK_URL_PRIVATE_HOST,
        });
      }
    });

    it("doesn't quote the body of a response that isn't JSON", async () => {
      mockFetch.mockResolvedValue(fetchOk("SECRET-BODY ami-0abc"));
      const err = await ToolpackRegistrationService.fetchSchema(
        "https://example.com/schema",
        undefined
      ).catch((e: unknown) => e);
      expect(err).toMatchObject({ code: ApiCode.TOOLPACK_SCHEMA_INVALID });
      expect((err as Error).message).not.toContain("SECRET");
    });
  });

  describe("validateNoBuiltinCollision", () => {
    // Case 90
    it("throws TOOLPACK_TOOL_NAME_CONFLICT for a collision", () => {
      expect(() =>
        ToolpackRegistrationService.validateNoBuiltinCollision(
          [
            {
              name: "sql_query",
              description: "x",
              parameterSchema: { type: "object", properties: {} },
            },
          ],
          BUILTIN_NAMES
        )
      ).toThrow(
        expect.objectContaining({
          code: ApiCode.TOOLPACK_TOOL_NAME_CONFLICT,
        })
      );
    });

    it("does not throw when there is no collision", () => {
      expect(() =>
        ToolpackRegistrationService.validateNoBuiltinCollision(
          [
            {
              name: "lookup_company",
              description: "x",
              parameterSchema: { type: "object", properties: {} },
            },
          ],
          BUILTIN_NAMES
        )
      ).not.toThrow();
    });
  });

  // ── Phase 6: HMAC outbound signing ─────────────────────────────────

  describe("HMAC outbound signing", () => {
    // Case 152
    it("fetchSchema sends X-Portalai-* signing headers when given a secret", async () => {
      mockFetch.mockResolvedValue(fetchOk(VALID_SCHEMA_RESPONSE));
      const secret = "whsec_test152";
      await ToolpackRegistrationService.fetchSchema(
        "https://example.com/schema",
        undefined,
        secret
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0]!;
      const headers = (options as { headers: Record<string, string> }).headers;

      expect(headers["X-Portalai-Webhook-Id"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(headers["X-Portalai-Timestamp"]).toMatch(/^\d+$/);
      expect(headers["X-Portalai-Signature"]).toMatch(/^v1=[0-9a-f]{64}$/);

      // Independently recompute the signature over `<ts>.<id>.<""body>` —
      // GETs sign over the empty body — and assert byte-equality.
      const ts = headers["X-Portalai-Timestamp"];
      const id = headers["X-Portalai-Webhook-Id"];
      const sig = headers["X-Portalai-Signature"]!.replace(/^v1=/, "");
      const crypto = await import("crypto");
      const expected = crypto
        .createHmac("sha256", secret)
        .update(`${ts}.${id}.`)
        .digest("hex");
      expect(sig).toBe(expected);
    });

    // Case 153
    it("fetchSchema omits signing headers when no secret is provided", async () => {
      mockFetch.mockResolvedValue(fetchOk(VALID_SCHEMA_RESPONSE));
      await ToolpackRegistrationService.fetchSchema(
        "https://example.com/schema",
        undefined,
        undefined
      );

      const [, options] = mockFetch.mock.calls[0]!;
      const headers = (options as { headers: Record<string, string> }).headers;
      expect(headers["X-Portalai-Webhook-Id"]).toBeUndefined();
      expect(headers["X-Portalai-Timestamp"]).toBeUndefined();
      expect(headers["X-Portalai-Signature"]).toBeUndefined();
    });
  });
});
