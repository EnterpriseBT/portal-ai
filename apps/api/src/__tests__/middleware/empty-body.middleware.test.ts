import { describe, it, expect } from "@jest/globals";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import request from "supertest";

import { emptyBodyAsObject } from "../../middleware/empty-body.middleware.js";
import { jsonBodyOnly } from "../../middleware/json-body-only.middleware.js";
import { rejectNul } from "../../middleware/reject-nul.middleware.js";
import type { ApiError } from "../../services/http.service.js";

/**
 * #897: Express 4 handed routes `{}` for a bodiless write; Express 5 hands
 * them `undefined`. Routes `safeParse(req.body)`, so the middleware keeps an
 * empty-schema write a success.
 */
const run = (method: string, body: unknown): unknown => {
  const req = { method, body } as Request;
  let nextCalled = false;
  emptyBodyAsObject(req, {} as Response, () => {
    nextCalled = true;
  });
  expect(nextCalled).toBe(true);
  return req.body;
};

describe("emptyBodyAsObject", () => {
  it.each(["POST", "PUT", "PATCH"])("gives a bodiless %s `{}`", (method) => {
    expect(run(method, undefined)).toEqual({});
  });

  it("leaves a parsed body untouched", () => {
    const body = { name: "x" };
    expect(run("POST", body)).toBe(body);
  });

  it.each(["GET", "DELETE"])("leaves a bodiless %s undefined", (method) => {
    expect(run(method, undefined)).toBeUndefined();
  });

  describe("in the app's body stack", () => {
    // The order app.ts mounts them in.
    const app = express();
    app.use(express.json());
    app.use(jsonBodyOnly);
    app.use(rejectNul);
    app.use(emptyBodyAsObject);
    app.post("/echo", (req: Request, res: Response) => {
      res.status(200).json({ body: req.body ?? null });
    });
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      res
        .status((err as ApiError).status ?? 500)
        .json({ message: err.message });
    });

    it("hands a Content-Length: 0 POST `{}`", async () => {
      const res = await request(app).post("/echo").set("Content-Length", "0");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ body: {} });
    });

    it("still refuses a form-encoded body with 415", async () => {
      const res = await request(app)
        .post("/echo")
        .type("form")
        .send("force=true");
      expect(res.status).toBe(415);
    });
  });
});
