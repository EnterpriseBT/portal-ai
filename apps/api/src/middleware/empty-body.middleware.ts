import type { Request, Response, NextFunction } from "express";

import { BODY_METHODS } from "./json-body-only.middleware.js";

/**
 * Give a bodiless write `{}` (#897).
 *
 * Express 4's body parser set `req.body` to `{}` when there was nothing to
 * parse; Express 5's leaves it `undefined`. Routes `safeParse(req.body)`, so
 * without this a bodiless POST to a route whose schema accepts an empty
 * object would turn from a success into a 400 (or a crash where a handler
 * destructures the body).
 *
 * Mounted after `jsonBodyOnly` and `rejectNul`: by then any body that has
 * content but wasn't JSON has been refused with a 415, so only a genuinely
 * bodiless write is normalized, and `rejectNul` still sees the raw value.
 */
export const emptyBodyAsObject = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (req.body === undefined && BODY_METHODS.has(req.method)) req.body = {};
  next();
};
