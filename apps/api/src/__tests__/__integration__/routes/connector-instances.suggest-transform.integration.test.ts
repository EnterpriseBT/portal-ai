/**
 * Integration tests for the slice-5 JSONata transform suggest route:
 *   POST /api/connector-instances/suggest-transform
 *
 * Exercises the route's validate-then-retry orchestration with a stub
 * JsonataSuggester swapped in via `__setJsonataSuggesterForTesting`.
 * Pinning behaviors:
 *   - The route runs `truncateForPrompt` on the sample before invoking
 *     the suggester (the suggester does not re-truncate).
 *   - Validation runs `applyTransform` against the *full* sample (not
 *     the truncated one).
 *   - First-attempt-invalid retries once with the prior failure
 *     injected into the prompt; second-attempt-invalid surfaces a
 *     `warning` in the 200 response.
 *   - `JsonataSuggestError` from either attempt maps to 502 with
 *     `REST_API_TRANSFORM_SUGGEST_FAILED`.
 *
 * Mirrors the probe-endpoint-draft integration test's structure
 * (auth + metadata mocked at the middleware boundary, org seeded for
 * getApplicationMetadata).
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import request from "supertest";
import type {
  Request,
  Response as ExpressResponse,
  NextFunction,
} from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../../db/schema/index.js";
import { seedUserAndOrg, teardownOrg } from "../utils/application.util.js";

const AUTH0_ID = "auth0|ci-test-suggest-transform";

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: ExpressResponse, next: NextFunction) => {
    req.auth = { payload: { sub: AUTH0_ID } } as never;
    next();
  },
}));

jest.unstable_mockModule("../../../services/auth0.service.js", () => ({
  Auth0Service: {
    hasAccessToken: jest.fn(),
    getAccessToken: jest.fn(),
    getAuth0UserProfile: jest.fn(),
  },
}));

const { app } = await import("../../../app.js");
const { __setJsonataSuggesterForTesting } =
  await import("../../../adapters/rest-api/jsonata-suggest.haiku.js");
const { JsonataSuggestError } =
  await import("../../../adapters/rest-api/jsonata-suggest.types.js");

let connection!: ReturnType<typeof postgres>;
let db!: ReturnType<typeof drizzle>;

beforeEach(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  connection = postgres(process.env.DATABASE_URL, { max: 1 });
  db = drizzle(connection, { schema });
  await teardownOrg(db);
  await seedUserAndOrg(db, AUTH0_ID);
  __setJsonataSuggesterForTesting(null);
});

afterEach(async () => {
  __setJsonataSuggesterForTesting(null);
  await connection.end();
});

// ── Happy path ───────────────────────────────────────────────────────

describe("POST /api/connector-instances/suggest-transform — happy paths", () => {
  it("returns the expression with warning: null when the first attempt validates", async () => {
    const suggestSpy = jest
      .fn<(input: unknown) => Promise<{ expression: string }>>()
      .mockResolvedValueOnce({ expression: "data.items" });
    __setJsonataSuggesterForTesting({ suggest: suggestSpy } as never);

    const res = await request(app)
      .post("/api/connector-instances/suggest-transform")
      .send({
        sampleResponse: {
          data: { items: [{ id: 1 }, { id: 2 }] },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.payload).toEqual({
      expression: "data.items",
      warning: null,
    });
    expect(suggestSpy).toHaveBeenCalledTimes(1);
  });

  it("retries once with previousAttempt populated when the first expression is invalid; succeeds on attempt 2", async () => {
    const suggestSpy = jest
      .fn<(input: unknown) => Promise<{ expression: string }>>()
      .mockResolvedValueOnce({ expression: "$count(data.items)" }) // primitive result
      .mockResolvedValueOnce({ expression: "data.items" });
    __setJsonataSuggesterForTesting({ suggest: suggestSpy } as never);

    const res = await request(app)
      .post("/api/connector-instances/suggest-transform")
      .send({
        sampleResponse: { data: { items: [{ id: 1 }] } },
      });

    expect(res.status).toBe(200);
    expect(res.body.payload.expression).toBe("data.items");
    expect(res.body.payload.warning).toBeNull();
    expect(suggestSpy).toHaveBeenCalledTimes(2);

    const secondCallInput = suggestSpy.mock.calls[1]![0] as {
      previousAttempt?: { expression: string; error: string };
    };
    expect(secondCallInput.previousAttempt?.expression).toBe(
      "$count(data.items)"
    );
    expect(secondCallInput.previousAttempt?.error).toBeDefined();
  });

  it("returns the second expression with a warning when both attempts fail validation", async () => {
    const suggestSpy = jest
      .fn<(input: unknown) => Promise<{ expression: string }>>()
      .mockResolvedValueOnce({ expression: "$count(data.items)" })
      .mockResolvedValueOnce({ expression: '"a literal string"' });
    __setJsonataSuggesterForTesting({ suggest: suggestSpy } as never);

    const res = await request(app)
      .post("/api/connector-instances/suggest-transform")
      .send({
        sampleResponse: { data: { items: [{ id: 1 }] } },
      });

    expect(res.status).toBe(200);
    expect(res.body.payload.expression).toBe('"a literal string"');
    expect(res.body.payload.warning).toEqual({
      kind: "validation-failed",
      message: expect.any(String),
    });
    expect(suggestSpy).toHaveBeenCalledTimes(2);
  });

  it("passes the TRUNCATED sample to the suggester and the FULL sample to validation", async () => {
    // 6-element items array. After truncateForPrompt, the suggester
    // sees 5 objects + the "__truncated__" sentinel. Validation runs
    // against the full 6 objects, so `data.items` produces 6 records
    // (all objects) and passes the strict array-of-objects check.
    //
    // If validation had (incorrectly) run on the truncated sample,
    // the sentinel string would fail the every-record-is-object check
    // and the route would return a warning. The assertion below proves
    // it didn't.
    const suggestSpy = jest
      .fn<(input: unknown) => Promise<{ expression: string }>>()
      .mockResolvedValueOnce({ expression: "data.items" });
    __setJsonataSuggesterForTesting({ suggest: suggestSpy } as never);

    const fullSample = {
      data: {
        items: Array.from({ length: 6 }, (_, i) => ({ id: i + 1 })),
      },
    };

    const res = await request(app)
      .post("/api/connector-instances/suggest-transform")
      .send({ sampleResponse: fullSample });

    expect(res.status).toBe(200);
    expect(res.body.payload.warning).toBeNull();

    const callArg = suggestSpy.mock.calls[0]![0] as {
      sampleResponse: { data: { items: unknown[] } };
    };
    expect(callArg.sampleResponse.data.items.length).toBe(6);
    expect(callArg.sampleResponse.data.items[5]).toBe("__truncated__");
    expect(callArg.sampleResponse.data.items.slice(0, 5)).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
      { id: 5 },
    ]);
  });
});

// ── Validation / auth errors ─────────────────────────────────────────

describe("POST /api/connector-instances/suggest-transform — errors", () => {
  it("returns 400 REST_API_INVALID_CONFIG when sampleResponse is missing", async () => {
    const suggestSpy = jest.fn<() => Promise<{ expression: string }>>();
    __setJsonataSuggesterForTesting({ suggest: suggestSpy } as never);

    const res = await request(app)
      .post("/api/connector-instances/suggest-transform")
      .send({ promptHint: "anything" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("REST_API_INVALID_CONFIG");
    expect(suggestSpy).not.toHaveBeenCalled();
  });

  it("returns 400 when promptHint exceeds the 2000-char cap", async () => {
    __setJsonataSuggesterForTesting({
      suggest: jest.fn<() => Promise<{ expression: string }>>(),
    } as never);

    const res = await request(app)
      .post("/api/connector-instances/suggest-transform")
      .send({
        promptHint: "x".repeat(2001),
        sampleResponse: {},
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("REST_API_INVALID_CONFIG");
  });

  it("returns 502 REST_API_TRANSFORM_SUGGEST_FAILED on JsonataSuggestError (first attempt)", async () => {
    const suggestSpy = jest
      .fn<() => Promise<{ expression: string }>>()
      .mockRejectedValueOnce(
        new JsonataSuggestError("timeout", "request aborted")
      );
    __setJsonataSuggesterForTesting({ suggest: suggestSpy } as never);

    const res = await request(app)
      .post("/api/connector-instances/suggest-transform")
      .send({ sampleResponse: {} });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("REST_API_TRANSFORM_SUGGEST_FAILED");
    expect(suggestSpy).toHaveBeenCalledTimes(1);
  });

  it("returns 502 when the retry attempt throws JsonataSuggestError", async () => {
    const suggestSpy = jest
      .fn<() => Promise<{ expression: string }>>()
      // First attempt returns an invalid expression so the route retries.
      .mockResolvedValueOnce({ expression: "$count(data)" })
      // Retry throws — route maps to 502.
      .mockRejectedValueOnce(
        new JsonataSuggestError("network-error", "ECONNRESET")
      );
    __setJsonataSuggesterForTesting({ suggest: suggestSpy } as never);

    const res = await request(app)
      .post("/api/connector-instances/suggest-transform")
      .send({ sampleResponse: { data: [{ id: 1 }] } });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("REST_API_TRANSFORM_SUGGEST_FAILED");
    expect(suggestSpy).toHaveBeenCalledTimes(2);
  });

  // The 401 path is delegated to `getApplicationMetadata`, which is
  // exercised by its own dedicated middleware test
  // (apps/api/src/__tests__/middleware/metadata.middleware.test.ts).
  // Asserting it again here would require swapping the auth-middleware
  // mock mid-suite, which jest.unstable_mockModule's ESM module
  // records don't permit cleanly. Skipped here on purpose.
});
