import { jest, describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import {
  UnauthorizedError,
  InvalidTokenError,
  InsufficientScopeError,
} from "express-oauth2-jwt-bearer";

import { ApiCode } from "../../constants/api-codes.constants.js";
import { environment } from "../../environment.js";

/**
 * Integration tests against the Express app to verify middleware, routing,
 * and error handling work together correctly.
 *
 * Note: Protected routes are excluded here because they require JWT
 * validation which is tested separately with mocked auth middleware.
 */

// Sentinel header values that drive the mocked jwtCheck into specific
// rejection paths of the real `express-oauth2-jwt-bearer` error hierarchy.
const INVALID_TOKEN = "Bearer invalid-token";
const INSUFFICIENT_SCOPE_TOKEN = "Bearer insufficient-scope";

// Mock the auth middleware so the real app can be imported without JWT config.
// It mirrors the real `express-oauth2-jwt-bearer` behavior of rejecting via
// next(err) so the app's real error handler is exercised (#216): no
// Authorization header → UnauthorizedError (401); the invalid-token sentinel →
// InvalidTokenError (401); the insufficient-scope sentinel →
// InsufficientScopeError (403); otherwise pass through. Unprotected routes
// (health, body-parser tests) never invoke this, so they stay green.
jest.unstable_mockModule("../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    const authz = req.headers.authorization;
    if (authz === INSUFFICIENT_SCOPE_TOKEN) {
      return next(new InsufficientScopeError());
    }
    if (authz === INVALID_TOKEN) {
      return next(new InvalidTokenError("Invalid or expired token"));
    }
    if (!authz) {
      return next(new UnauthorizedError("Missing or invalid access token"));
    }
    next();
  },
}));

const { app } = await import("../../app.js");

describe("App Integration", () => {
  describe("Health endpoint", () => {
    it("should respond to GET /health with status 200", async () => {
      const res = await request(app).get("/api/health");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        payload: {
          sha: "local",
          version: "dev",
          timestamp: expect.any(String),
        },
      });
    });
  });

  describe("Unknown routes", () => {
    it("should return 404 for non-existent routes", async () => {
      const res = await request(app).get("/nonexistent");

      expect(res.status).toBe(404);
    });
  });

  describe("Auth middleware error mapping (#216)", () => {
    it("maps an anonymous request to a protected route to a typed 401, not a 500 UNKNOWN", async () => {
      const res = await request(app).get("/api/organization/current");

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.AUTH_UNAUTHORIZED);
      expect(res.body.code).not.toBe("UNKNOWN");
    });

    it("maps an invalid/expired token (InvalidTokenError subclass) to a typed 401", async () => {
      const res = await request(app)
        .get("/api/stations")
        .set("Authorization", INVALID_TOKEN);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.AUTH_UNAUTHORIZED);
      expect(res.body.code).not.toBe("UNKNOWN");
    });

    it("maps an insufficient-scope rejection to a typed 403", async () => {
      const res = await request(app)
        .get("/api/organization/current")
        .set("Authorization", INSUFFICIENT_SCOPE_TOKEN);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.AUTH_FORBIDDEN);
    });
  });

  describe("JSON parsing", () => {
    it("should accept requests with JSON content type", async () => {
      const res = await request(app)
        .get("/api/health")
        .set("Content-Type", "application/json");

      expect(res.status).toBe(200);
    });
  });

  describe("Body-parser error mapping", () => {
    let originalLimit: number;
    beforeAll(() => {
      originalLimit = environment.REQUEST_JSON_LIMIT_BYTES;
    });
    afterAll(() => {
      environment.REQUEST_JSON_LIMIT_BYTES = originalLimit;
    });

    it("returns 413 with REQUEST_PAYLOAD_TOO_LARGE when the JSON body exceeds the limit", async () => {
      // The limit is captured at express.json() construction (app load), so a
      // big-enough payload always trips it regardless of runtime overrides.
      const limit = environment.REQUEST_JSON_LIMIT_BYTES;
      const oversized = { blob: "a".repeat(limit + 1024) };

      const res = await request(app)
        .post("/nonexistent")
        .set("Content-Type", "application/json")
        .send(oversized);

      expect(res.status).toBe(413);
      expect(res.body.code).toBe(ApiCode.REQUEST_PAYLOAD_TOO_LARGE);
    });

    it("returns 400 with REQUEST_BODY_INVALID_JSON for malformed JSON", async () => {
      const res = await request(app)
        .post("/nonexistent")
        .set("Content-Type", "application/json")
        .send("{not valid json");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.REQUEST_BODY_INVALID_JSON);
    });
  });

  // #805: Postgres can't store U+0000, so a request carrying one is refused
  // before any route (and before auth, like the body-parser errors above).
  describe("NUL characters", () => {
    it("refuses a NUL in a JSON body with 400 REQUEST_INVALID_CHARACTERS", async () => {
      const res = await request(app)
        .post("/nonexistent")
        .set("Content-Type", "application/json")
        .send({ name: "Ops\u0000x" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.REQUEST_INVALID_CHARACTERS);
      expect(res.body.details).toEqual({ location: "body", path: "name" });
    });

    it("refuses %00 in a query string with 400 REQUEST_INVALID_CHARACTERS", async () => {
      const res = await request(app).get("/api/health?x=%00");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.REQUEST_INVALID_CHARACTERS);
      expect(res.body.details).toEqual({ location: "url" });
    });
  });

  // #805 adversarial walk: Express's param decoding throws a URIError
  // (status 400) on malformed percent-encoding, which fell through to a 500.
  describe("Malformed URL encoding", () => {
    it.each(["/api/stations/%C0%80", "/api/stations/%E0%A4%A"])(
      "answers %s with 400 REQUEST_URL_INVALID_ENCODING, not a 500",
      async (url) => {
        const res = await request(app)
          .get(url)
          .set("Authorization", "Bearer test-token");

        expect(res.status).toBe(400);
        expect(res.body.code).toBe(ApiCode.REQUEST_URL_INVALID_ENCODING);
        expect(res.body.message).toBe(
          "The request URL isn't valid percent-encoded UTF-8"
        );
      }
    );
  });

  // #897: an error after headers were sent (an SSE route failing mid-stream;
  // Express 5 forwards async rejections here) must not write a JSON body on
  // top of them, which throws ERR_HTTP_HEADERS_SENT inside the handler.
  describe("Errors after headers are sent", () => {
    it("closes the connection without writing an error body", async () => {
      const { apiErrorHandler } = await import("../../app.js");
      const express = (await import("express")).default;
      const http = await import("node:http");
      const bare = express();
      bare.get(
        "/stream",
        (_req: Request, res: Response, next: NextFunction) => {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.write("data: first\n\n");
          next(new Error("failed mid-stream"));
        }
      );
      bare.use(apiErrorHandler);
      // Anything that leaves the handler: an ERR_HTTP_HEADERS_SENT it threw by
      // writing anyway, or an error handed on to Express's default handler
      // (which would print the raw stack to stderr). Neither should happen.
      const escaped: Error[] = [];
      bare.use(
        (err: Error, _req: Request, _res: Response, next: NextFunction) => {
          escaped.push(err);
          next(err);
        }
      );

      const server = bare.listen(0);
      const { port } = server.address() as { port: number };
      const { status, text, complete } = await new Promise<{
        status: number;
        text: string;
        complete: boolean;
      }>((resolve) => {
        let status = 0;
        let text = "";
        let complete = true;
        const done = () => resolve({ status, text, complete });
        // The handler destroys the socket, so the client sees the partial
        // stream end in a reset ("socket hang up") rather than a clean end.
        const req = http.get({ port, path: "/stream" }, (res) => {
          status = res.statusCode ?? 0;
          res.on("data", (chunk: Buffer) => (text += chunk.toString()));
          const settle = () => {
            complete = res.complete;
            done();
          };
          res.on("error", settle);
          res.on("close", settle);
        });
        req.on("error", done);
      }).finally(() => server.close());

      expect(status).toBe(200);
      expect(text).toBe("data: first\n\n");
      expect(complete).toBe(false);
      expect(escaped).toEqual([]);
    });
  });

  // #897: Express 5 forwards a rejected async handler to the error handler.
  // Under Express 4 the rejection escaped to process `unhandledRejection` and
  // the request hung.
  describe("Rejected async handlers", () => {
    it("answers through the error handler", async () => {
      const { apiErrorHandler } = await import("../../app.js");
      const express = (await import("express")).default;
      const { ApiError } = await import("../../services/http.service.js");
      const bare = express();
      bare.get("/reject", async () => {
        throw new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found");
      });
      bare.use(apiErrorHandler);

      const res = await request(bare).get("/reject").timeout(3000);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.STATION_NOT_FOUND);
    });
  });

  // #775: express.json() skips other content types, leaving req.body empty,
  // so a strict route saw `{}` and dropped every key. Such a body is a 415.
  describe("Non-JSON bodies", () => {
    it.each([
      ["application/x-www-form-urlencoded", "force=true"],
      ["text/plain", '{"force":true}'],
      ["multipart/form-data; boundary=x", "--x\r\n\r\nforce\r\n--x--"],
    ])("refuses a %s body with 415", async (contentType, body) => {
      const res = await request(app)
        .post("/api/connector-instances/any/sync")
        .set("Content-Type", contentType)
        .send(body);

      expect(res.status).toBe(415);
      expect(res.body.code).toBe(ApiCode.REQUEST_UNSUPPORTED_MEDIA_TYPE);
    });

    it("refuses a body with no content type", async () => {
      const res = await request(app)
        .post("/nonexistent")
        .set("Content-Length", "3")
        .send(Buffer.from("abc"));

      expect(res.status).toBe(415);
    });

    it("lets a bodiless POST through", async () => {
      const res = await request(app).post("/nonexistent");

      expect(res.status).toBe(404);
    });

    it("lets a JSON body with a charset through", async () => {
      const res = await request(app)
        .post("/nonexistent")
        .set("Content-Type", "application/json; charset=utf-8")
        .send("{}");

      expect(res.status).toBe(404);
    });
  });
});
