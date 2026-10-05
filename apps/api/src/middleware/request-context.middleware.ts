import type { Request, Response, NextFunction } from "express";
import { requestContext } from "../utils/request-context.util.js";

/**
 * Binds the pino-http per-request logger (`req.log`) into an
 * AsyncLocalStorage store so that `createLogger()` call sites deep in the
 * service layer inherit `reqId`, `userId`, and other request-scoped bindings
 * without needing to thread a logger argument through every call.
 *
 * Also carries the per-request abort signal and DB cancel state (#698).
 *
 * Must be mounted after `httpLogger` so that `req.log` is populated.
 */
export const requestContextMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // #698: one abort signal per request, fired when the client disconnects
  // before the response finished. `close` also fires after a normal finish,
  // hence the `writableFinished` guard. The SQL instrumentation reads it (via
  // the store) to cancel DB work nobody is waiting for any more.
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort("client_gone");
  });
  requestContext.run(
    {
      log: req.log,
      signal: controller.signal,
      dbCancelPolicy: "before-start",
      dbStarted: false,
    },
    () => next()
  );
};
