import { describe, it, expect, jest } from "@jest/globals";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import request from "supertest";

import { rejectNul } from "../../middleware/reject-nul.middleware.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";

/**
 * #805: Postgres can't store U+0000 in text or jsonb, so a request carrying
 * one used to pass its contract and 500 at the insert. The middleware refuses
 * it with a typed 400 before any route runs.
 */
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(rejectNul);
  app.use("/echo", (req: Request, res: Response) => {
    res.status(200).json({ body: req.body ?? null, query: req.query });
  });
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const apiErr = err as ApiError;
    res.status(apiErr.status ?? 500).json({
      code: apiErr.code,
      message: err.message,
      details: apiErr.details,
    });
  });
  return app;
}

const NUL = "\u0000";

describe("rejectNul", () => {
  describe("JSON bodies", () => {
    it("refuses a NUL in a body value, naming the field", async () => {
      const res = await request(makeApp())
        .post("/echo")
        .send({ name: `Ops${NUL}x`, toolPacks: ["data_query"] });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.REQUEST_INVALID_CHARACTERS);
      expect(res.body.details).toEqual({ location: "body", path: "name" });
      expect(res.body.message).toBe(
        "`name` contains a NUL character (U+0000), which can't be stored"
      );
    });

    it.each([
      ["a nested value", { data: { notes: `a${NUL}` } }, "data.notes"],
      ["an array element", { items: ["a", `b${NUL}`] }, "items.1"],
      ["a key", { data: { [`k${NUL}`]: 1 } }, "data.k"],
    ])("refuses a NUL in %s", async (_label, body, path) => {
      const res = await request(makeApp()).patch("/echo").send(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.REQUEST_INVALID_CHARACTERS);
      expect(res.body.details).toEqual({ location: "body", path });
    });

    it("refuses a body with no path (a root string) with the bodyless message", () => {
      // express.json()'s strict mode never yields a root string, but the
      // middleware doesn't depend on that.
      const next = jest.fn<(err?: unknown) => void>();
      rejectNul(
        { originalUrl: "/echo", body: `x${NUL}` } as Request,
        {} as Response,
        next as unknown as NextFunction
      );

      const err = next.mock.calls[0]![0] as unknown as ApiError;
      expect(err.code).toBe(ApiCode.REQUEST_INVALID_CHARACTERS);
      expect(err.message).toBe(
        "The request body contains a NUL character (U+0000), which can't be stored"
      );
      expect(err.details).toEqual({ location: "body", path: "" });
    });

    it("never echoes the offending value", async () => {
      const res = await request(makeApp())
        .post("/echo")
        .send({ secret: `do-not-echo-me${NUL}` });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain("do-not-echo-me");
    });

    it("passes the escaped text \\u0000, tabs and newlines", async () => {
      const res = await request(makeApp())
        .post("/echo")
        .set("Content-Type", "application/json")
        .send('{"code":"\\\\u0000","tsv":"a\\tb\\nc"}');

      expect(res.status).toBe(200);
      expect(res.body.body).toEqual({ code: "\\u0000", tsv: "a\tb\nc" });
    });
  });

  describe("URLs", () => {
    it.each([
      ["the path", "/echo/a%00b"],
      ["the query", "/echo?search=a%00b"],
    ])("refuses %00 in %s", async (_label, url) => {
      const res = await request(makeApp()).get(url);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ApiCode.REQUEST_INVALID_CHARACTERS);
      expect(res.body.details).toEqual({ location: "url" });
      expect(res.body.message).toBe(
        "The request URL contains a NUL character (%00), which can't be stored"
      );
    });

    it("passes %2500, which decodes to the text %00", async () => {
      const res = await request(makeApp()).get("/echo?search=%2500");

      expect(res.status).toBe(200);
      expect(res.body.query).toEqual({ search: "%00" });
    });
  });

  // Code review on #805: webhook staging carries org-hosted tool output, which
  // the route strips instead of refusing (like every other tool output).
  it("doesn't check the body of POST /api/webhook/handle/:sessionId", () => {
    const next = jest.fn<(err?: unknown) => void>();
    rejectNul(
      {
        method: "POST",
        path: "/api/webhook/handle/sess-1",
        originalUrl: "/api/webhook/handle/sess-1",
        body: { rows: [{ k: `a${NUL}` }] },
      } as Request,
      {} as Response,
      next as unknown as NextFunction
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("still checks that route's URL", () => {
    const next = jest.fn<(err?: unknown) => void>();
    rejectNul(
      {
        method: "POST",
        path: "/api/webhook/handle/s\u0000",
        originalUrl: "/api/webhook/handle/s%00",
        body: {},
      } as Request,
      {} as Response,
      next as unknown as NextFunction
    );
    expect((next.mock.calls[0]![0] as unknown as ApiError).code).toBe(
      ApiCode.REQUEST_INVALID_CHARACTERS
    );
  });

  it("passes clean requests through", async () => {
    const app = makeApp();

    const post = await request(app).post("/echo").send({ name: "Ops" });
    expect(post.status).toBe(200);
    expect(post.body.body).toEqual({ name: "Ops" });

    const get = await request(app).get("/echo?search=ops");
    expect(get.status).toBe(200);
  });
});
