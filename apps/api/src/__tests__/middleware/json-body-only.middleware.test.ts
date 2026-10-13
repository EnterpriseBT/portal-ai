import { describe, it, expect } from "@jest/globals";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import http from "http";
import type { AddressInfo } from "net";
import request from "supertest";

import { jsonBodyOnly } from "../../middleware/json-body-only.middleware.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";

/**
 * #775: a body `express.json()` skips would reach routes as `{}`. The
 * middleware refuses it with a 415 and lets bodiless requests through.
 */
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(jsonBodyOnly);
  app.all("/echo", (req: Request, res: Response) => {
    res.status(200).json({ body: req.body ?? null });
  });
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const apiErr = err as ApiError;
    res
      .status(apiErr.status ?? 500)
      .json({ code: apiErr.code, message: err.message });
  });
  return app;
}

/** Send a chunked body (no Content-Length), which supertest can't. */
function sendChunked(
  app: express.Express,
  method: string,
  contentType: string,
  body: string
): Promise<number> {
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  return new Promise<number>((resolve, reject) => {
    const req = http.request(
      {
        port,
        method,
        path: "/echo",
        headers: { "Content-Type": contentType },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  }).finally(() => server.close());
}

describe("jsonBodyOnly (#775)", () => {
  const app = makeApp();

  it("passes a JSON body", async () => {
    const res = await request(app).post("/echo").send({ a: 1 });
    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ a: 1 });
  });

  it("passes JSON with a charset", async () => {
    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "application/json; charset=utf-8")
      .send('{"a":1}');
    expect(res.status).toBe(200);
  });

  it("passes a bodiless POST", async () => {
    const res = await request(app).post("/echo");
    expect(res.status).toBe(200);
  });

  it("passes Content-Length: 0 with a non-JSON type", async () => {
    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "text/plain")
      .set("Content-Length", "0");
    expect(res.status).toBe(200);
  });

  it.each(["PUT", "PATCH"] as const)(
    "refuses a form-encoded %s body",
    async (method) => {
      const agent = request(app);
      const res = await (
        method === "PUT" ? agent.put("/echo") : agent.patch("/echo")
      )
        .type("form")
        .send("force=true");
      expect(res.status).toBe(415);
      expect(res.body.code).toBe(ApiCode.REQUEST_UNSUPPORTED_MEDIA_TYPE);
    }
  );

  it("refuses a +json type express.json() doesn't parse", async () => {
    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "application/vnd.foo+json")
      .send('{"a":1}');
    expect(res.status).toBe(415);
  });

  it("refuses a chunked body with no length", async () => {
    expect(await sendChunked(app, "POST", "text/plain", "force=true")).toBe(
      415
    );
  });

  it.each(["GET", "DELETE"])(
    "ignores a %s body, which no route reads",
    async (method) => {
      expect(await sendChunked(app, method, "text/plain", "x")).toBe(200);
    }
  );

  it("echoes only the media type, capped, never the raw header", async () => {
    const long = `text/${"x".repeat(5000)}; boundary=${"y".repeat(5000)}`;
    const res = await request(app)
      .post("/echo")
      .set("Content-Type", long)
      .send("abc");
    expect(res.status).toBe(415);
    expect(res.body.message.length).toBeLessThan(200);
    expect(res.body.message).not.toContain("boundary");
  });
});
