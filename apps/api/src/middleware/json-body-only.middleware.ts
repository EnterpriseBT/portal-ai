import type { Request, Response, NextFunction } from "express";

import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";

/**
 * Refuse a request body that `express.json()` did not parse (#775).
 *
 * `express.json()` is the API's only body parser, and it skips any other
 * content type, leaving `req.body` empty. A route's strict schema then sees
 * `{}`, so `-d 'force=true'` (form-encoded) passed a route whose schema
 * accepts an empty body and the key was silently dropped. A body that
 * would not be read is a 415 instead.
 *
 * "Has a body" is a non-zero `Content-Length` or any `Transfer-Encoding`:
 * a bodiless POST commonly carries `Content-Length: 0` and no content type,
 * and that must pass. Mounted after `express.json()`; the webhook router,
 * which parses its own raw body, is mounted before both.
 */
export const jsonBodyOnly = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const length = req.headers["content-length"];
  const hasBody =
    req.headers["transfer-encoding"] !== undefined ||
    (length !== undefined && Number(length) > 0);
  if (!hasBody || req.is("application/json")) return next();

  next(
    new ApiError(
      415,
      ApiCode.REQUEST_UNSUPPORTED_MEDIA_TYPE,
      `Request bodies must be application/json (got ${
        req.headers["content-type"] ?? "no content type"
      })`
    )
  );
};
