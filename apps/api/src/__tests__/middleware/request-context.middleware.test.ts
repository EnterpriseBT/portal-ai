import { EventEmitter } from "node:events";

import { describe, it, expect } from "@jest/globals";
import type { Request, Response } from "express";

import { requestContextMiddleware } from "../../middleware/request-context.middleware.js";
import {
  getRequestSignal,
  requestContext,
  type RequestContext,
} from "../../utils/request-context.util.js";

/** A response stand-in: an emitter with the one flag the middleware reads. */
function fakeRes(): Response & EventEmitter & { writableFinished: boolean } {
  const res = new EventEmitter() as Response &
    EventEmitter & { writableFinished: boolean };
  res.writableFinished = false;
  return res;
}

/** Run the middleware and capture the store `next()` sees. */
function runMiddleware(res: Response): RequestContext {
  let store: RequestContext | undefined;
  requestContextMiddleware(
    { log: undefined } as unknown as Request,
    res,
    () => {
      store = requestContext.getStore();
      // The signal is reachable through the public getter inside the request.
      expect(getRequestSignal()).toBe(store?.signal);
    }
  );
  if (!store) throw new Error("next() was not called inside the context");
  return store;
}

describe("requestContextMiddleware — request abort signal (#698)", () => {
  it("aborts the request signal when the client disconnects before the response finished", () => {
    const res = fakeRes();
    const store = runMiddleware(res);
    expect(store.signal?.aborted).toBe(false);
    res.emit("close");
    expect(store.signal?.aborted).toBe(true);
    expect(store.signal?.reason).toBe("client_gone");
  });

  it("does not abort when `close` follows a finished response", () => {
    const res = fakeRes();
    const store = runMiddleware(res);
    res.writableFinished = true;
    res.emit("close");
    expect(store.signal?.aborted).toBe(false);
  });

  it("defaults the DB cancel policy to before-start with no cancel reason", () => {
    const store = runMiddleware(fakeRes());
    expect(store.dbCancelPolicy).toBe("before-start");
    expect(store.dbCancelReason).toBeUndefined();
    expect(store.dbStarted).toBe(false);
  });
});
