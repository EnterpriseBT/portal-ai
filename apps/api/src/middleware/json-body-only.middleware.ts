import type { Request, Response, NextFunction } from "express";

import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";

/** The methods whose non-JSON bodies are refused. A body on any other method
 *  is ignored, not refused (DELETE `/organization/:id` reads a JSON one). */
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

/** Cap on the media type echoed in the refusal, so the response and its log
 *  line can't scale with a caller-controlled header (#745). */
const MAX_ECHOED_TYPE_LENGTH = 100;

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
 * a bodiless POST commonly carries `Content-Length: 0`, with or without a
 * content type, and that must pass. Mounted after `express.json()` and
 * `cors()` (so a cross-origin caller can read the 415); the webhook
 * router, which parses its own raw body, is mounted before both.
 */
export const jsonBodyOnly = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (!BODY_METHODS.has(req.method)) return next();
  const length = req.headers["content-length"];
  const hasBody =
    req.headers["transfer-encoding"] !== undefined ||
    (length !== undefined && Number(length) > 0);
  if (!hasBody || req.is("application/json")) return next();

  const mediaType = (req.headers["content-type"] ?? "")
    .split(";")[0]!
    .trim()
    .slice(0, MAX_ECHOED_TYPE_LENGTH);
  next(
    new ApiError(
      415,
      ApiCode.REQUEST_UNSUPPORTED_MEDIA_TYPE,
      `Request bodies must be application/json (got ${
        mediaType || "no content type"
      })`
    )
  );
};
