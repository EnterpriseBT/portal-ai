import type { Request, Response, NextFunction } from "express";

/**
 * Give a request with no parsed body `{}` (#897).
 *
 * Express 4's body parser set `req.body` to `{}` for every request it had
 * nothing to parse; Express 5's leaves it `undefined`. Routes
 * `safeParse(req.body)` (DELETE `/organization/:id` included), so without
 * this a bodiless write to a route whose schema accepts an empty object would
 * turn from a success into a 400, and a handler that destructures the body
 * would crash. Every method, as Express 4 did.
 *
 * Mounted after `jsonBodyOnly` and `rejectNul`: by then any POST/PUT/PATCH
 * body that has content but wasn't JSON has been refused with a 415, so only
 * an absent body is normalized, and `rejectNul` still sees the raw value.
 */
export const emptyBodyAsObject = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (req.body === undefined) req.body = {};
  next();
};
