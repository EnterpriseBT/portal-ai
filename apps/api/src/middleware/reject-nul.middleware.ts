import type { Request, Response, NextFunction } from "express";

import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { findNul } from "../utils/nul-character.util.js";

/**
 * Refuse a request carrying U+0000 (#805).
 *
 * JSON (`"\u0000"`) and URLs (`%00`) can carry a NUL, but no Postgres `text`
 * or `jsonb` value can hold one, so such a request passed its contract and
 * failed at the database as a route's 500 (a search filter fails the same
 * way). Refusing it here covers every route's body, params and query with
 * one typed 400 that names where the NUL is, before any write starts.
 *
 * The URL test is exact: Node's HTTP parser refuses a literal NUL, and
 * `%2500` decodes to the text `%00`, not a NUL. The body test runs on the
 * parsed value, so the escaped text `\\u0000` passes. The value itself is
 * never echoed. Mounted after `jsonBodyOnly`, ahead of every router and of
 * auth, like body-parser's own 400s.
 */
export const rejectNul = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (req.originalUrl.includes("%00")) {
    return next(
      new ApiError(
        400,
        ApiCode.REQUEST_INVALID_CHARACTERS,
        "The request URL contains a NUL character (%00), which can't be stored",
        { location: "url" }
      )
    );
  }

  const hit = req.body === undefined ? null : findNul(req.body);
  if (!hit) return next();
  next(
    new ApiError(
      400,
      ApiCode.REQUEST_INVALID_CHARACTERS,
      hit.path === ""
        ? "The request body contains a NUL character (U+0000), which can't be stored"
        : `\`${hit.path}\` contains a NUL character (U+0000), which can't be stored`,
      { location: "body", path: hit.path }
    )
  );
};
