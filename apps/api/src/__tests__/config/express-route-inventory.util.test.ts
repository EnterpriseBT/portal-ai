import { describe, it, expect } from "@jest/globals";

// The recorder must be installed before any app is built: imported first.
import {
  installRouteRecorder,
  registeredRoutes,
} from "./express-route-inventory.util.js";
import express from "express";

import { app } from "../../app.js";

/** A handler that is never called; registration is all these tests need. */
const noop = (): void => undefined;

describe("registeredRoutes (#897: recorded at registration)", () => {
  it("joins mount prefixes through nested routers", () => {
    const nested = express.Router();
    nested.post("/x", noop);
    const api = express.Router();
    api.get("/items/:id", noop);
    api.delete("/items/:id", noop);
    api.use("/nested", nested);
    const root = express();
    root.use("/api", api);

    expect(registeredRoutes(root)).toEqual(
      new Set([
        "GET /api/items/{id}",
        "DELETE /api/items/{id}",
        "POST /api/nested/x",
      ])
    );
  });

  it("sees methods chained after route()", () => {
    const router = express.Router();
    router.route("/r").get(noop).post(noop);
    const root = express();
    root.use(router);

    expect(registeredRoutes(root)).toEqual(new Set(["GET /r", "POST /r"]));
  });

  it("records mergeParams routers like any other", () => {
    const child = express.Router({ mergeParams: true });
    child.get("/", noop);
    const root = express();
    root.use("/entities/:entityId/records", child);

    expect(registeredRoutes(root)).toEqual(
      new Set(["GET /entities/{entityId}/records"])
    );
  });

  it("records each route once when installed twice", () => {
    installRouteRecorder();
    installRouteRecorder();
    const root = express();
    root.get("/once", noop);

    expect(registeredRoutes(root)).toEqual(new Set(["GET /once"]));
  });

  it("finds nothing for an object that isn't a recorded app", () => {
    expect(registeredRoutes({})).toEqual(new Set());
  });

  // `types/request.ts` types every route param as a string, which holds only
  // while no route uses a path-to-regexp wildcard (`*splat`), whose value is
  // an array (#897).
  it("registers no wildcard routes on the real app", () => {
    const routes = [...registeredRoutes(app)];
    expect(routes.length).toBeGreaterThan(180);
    expect(routes.filter((route) => route.includes("*"))).toEqual([]);
  });
});
