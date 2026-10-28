import type { Request as ExpressRequest } from "express";

/**
 * Express's `Request` with string route params (#897).
 *
 * Express 5's types widen every route param to `string | string[]`, because a
 * path-to-regexp v8 wildcard (`/*splat`) yields an array. The API registers
 * no wildcards: every dynamic segment is a named `:param`, so each value is a
 * string. `express-route-inventory.util.test.ts` fails if a wildcard route is
 * ever added, which keeps this type true.
 *
 * Route files import `Request` from here instead of `express`; everything
 * else (`Router`, `Response`, `NextFunction`) still comes from `express`.
 * Middleware keeps Express's own `Request`: it doesn't read route params.
 */
export type RouteParams = Record<string, string>;
export type Request = ExpressRequest<RouteParams>;
