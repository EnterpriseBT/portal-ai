import type { Request, Response, NextFunction } from "express";
import { requestContext } from "../utils/request-context.util.js";

/**
 * Binds the pino-http per-request logger (`req.log`) into an
 * AsyncLocalStorage store so that `createLogger()` call sites deep in the
 * service layer inherit `reqId`, `userId`, and other request-scoped bindings
 * without needing to thread a logger argument through every call.
 *
 * Must be mounted after `httpLogger` so that `req.log` is populated.
 */
export const requestContextMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  requestContext.run({ log: req.log }, () => next());
};
