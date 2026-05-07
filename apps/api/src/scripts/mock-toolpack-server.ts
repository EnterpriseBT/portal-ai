#!/usr/bin/env node
/**
 * Mock custom-toolpack webhook server — for manual testing of the
 * toolpack registration flow. Exposes the three endpoints that the
 * registration contract expects:
 *
 *   GET  /schema    — tool definitions
 *   GET  /metadata  — optional human-readable descriptions + examples
 *   POST /runtime   — invoke a tool by name (body: { tool, input })
 *
 * Phase 6: also demonstrates the receiving end of the HMAC outbound
 * signing contract. When `MOCK_TOOLPACK_SIGNING_SECRET` is set, the
 * server verifies three headers on every request:
 *
 *   X-Portalai-Timestamp   unix seconds (rejected if older than 300 s
 *                           or more than 60 s in the future)
 *   X-Portalai-Webhook-Id  uuid (must be present; not enforced for dedupe)
 *   X-Portalai-Signature   v1=<hex of HMAC-SHA256 over
 *                            `<ts>.<id>.<rawBody>` with the secret>
 *
 * Failure modes (`401`):
 *   - SIGNATURE_MISSING   any of the three headers absent
 *   - TIMESTAMP_STALE     ts older than 300 s / more than 60 s ahead
 *   - SIGNATURE_INVALID   recomputed HMAC doesn't match
 *
 * If `MOCK_TOOLPACK_SIGNING_SECRET` is unset, the server prints a
 * warning and accepts unsigned requests so existing dev workflows
 * aren't broken. This file IS the reference implementation toolpack
 * authors should mirror.
 *
 * Run from the apps/api directory:
 *
 *   npm run mock-toolpack            # listens on http://localhost:4100
 *   PORT=4500 MOCK_TOOLPACK_SIGNING_SECRET=whsec_xxx npm run mock-toolpack
 *
 * Then register a custom toolpack in the UI pointing at:
 *   schema:   http://localhost:4100/schema
 *   runtime:  http://localhost:4100/runtime
 *   metadata: http://localhost:4100/metadata
 */

import express, {
  type Application,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import crypto from "crypto";

const REPLAY_WINDOW_SEC = 300;
const FORWARD_SKEW_SEC = 60;

const tools = [
  {
    name: "echo",
    description: "Echo back the provided message. Useful for verifying the round-trip works end-to-end.",
    parameterSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
      },
      required: ["message"],
    },
  },
  {
    name: "add_numbers",
    description: "Add two numbers together and return the sum.",
    parameterSchema: {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
      },
      required: ["a", "b"],
    },
  },
  {
    name: "random_int",
    description: "Return a random integer in the inclusive range [min, max].",
    parameterSchema: {
      type: "object",
      properties: {
        min: { type: "integer" },
        max: { type: "integer" },
      },
      required: ["min", "max"],
    },
  },
];

const metadata = {
  summary:
    "Mock toolpack used for manually exercising the custom-toolpack registration and runtime flow.",
  tools: [
    {
      name: "echo",
      description: "Returns the message unchanged.",
      examples: [
        {
          title: "Echo a greeting",
          input: { message: "hello" },
          output: { echoed: "hello" },
        },
      ],
    },
    {
      name: "add_numbers",
      description: "Sums two numbers.",
      examples: [
        {
          title: "Add two integers",
          input: { a: 2, b: 3 },
          output: { sum: 5 },
        },
      ],
    },
    {
      name: "random_int",
      description: "Random integer between min and max, inclusive.",
      examples: [
        {
          title: "Roll a d20",
          input: { min: 1, max: 20 },
          output: { value: 14 },
        },
      ],
    },
  ],
};

/**
 * Capture the raw request body via `express.json()`'s `verify`
 * callback. The HMAC verification step needs the byte-exact body
 * that the sender signed; once the JSON parser has consumed the
 * stream, the raw bytes are gone. The `verify` callback fires while
 * the buffer is still in memory, before parsing.
 */
function captureRawBodyVerify(
  req: Request,
  _res: Response,
  buf: Buffer
): void {
  // Express's req.rawBody is typed as Buffer (see types/express.d.ts).
  req.rawBody = buf;
}

/**
 * Verify the three X-Portalai-* signing headers against the raw body
 * using the shared signing secret. Demonstrates the canonical
 * receiver-side verification — toolpack authors should mirror this
 * pattern in their own server.
 *
 * If `MOCK_TOOLPACK_SIGNING_SECRET` is unset, the middleware prints
 * a warning and skips verification so existing dev workflows that
 * predate phase 6 keep working.
 */
function verifySignature(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const secret = process.env.MOCK_TOOLPACK_SIGNING_SECRET;
  if (!secret) {
    // eslint-disable-next-line no-console
    console.warn(
      "[33m⚠️  MOCK_TOOLPACK_SIGNING_SECRET not set — accepting " +
        "unsigned requests. Configure the env var to demonstrate phase-6 " +
        "verification.[0m"
    );
    next();
    return;
  }

  const ts = req.header("X-Portalai-Timestamp");
  const id = req.header("X-Portalai-Webhook-Id");
  const sig = req.header("X-Portalai-Signature");

  if (!ts || !id || !sig) {
    res.status(401).json({ error: "SIGNATURE_MISSING" });
    return;
  }

  const tsNum = Number(ts);
  if (Number.isNaN(tsNum)) {
    res.status(401).json({ error: "SIGNATURE_MISSING" });
    return;
  }
  const ageSec = Math.floor(Date.now() / 1000) - tsNum;
  if (ageSec > REPLAY_WINDOW_SEC || ageSec < -FORWARD_SKEW_SEC) {
    res.status(401).json({ error: "TIMESTAMP_STALE", ageSec });
    return;
  }

  const rawBody = req.rawBody?.toString("utf8") ?? "";
  const expectedHex = crypto
    .createHmac("sha256", secret)
    .update(`${ts}.${id}.${rawBody}`)
    .digest("hex");
  const providedHex = sig.startsWith("v1=") ? sig.slice(3) : "";

  const expectedBuf = Buffer.from(expectedHex, "hex");
  const providedBuf = Buffer.from(providedHex, "hex");

  if (
    expectedBuf.length === 0 ||
    expectedBuf.length !== providedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, providedBuf)
  ) {
    res.status(401).json({ error: "SIGNATURE_INVALID" });
    return;
  }

  next();
}

export function createMockApp(): Application {
  const app = express();
  app.use(express.json({ limit: "1mb", verify: captureRawBodyVerify }));
  app.use(verifySignature);

  app.use((req, _res, next) => {
    // eslint-disable-next-line no-console
    console.log(`→ ${req.method} ${req.url}`);
    next();
  });

  app.get("/schema", (_req: Request, res: Response) => {
    res.json({ tools });
  });

  app.get("/metadata", (_req: Request, res: Response) => {
    res.json(metadata);
  });

  app.post("/runtime", (req: Request, res: Response) => {
    const { tool, input } = req.body ?? {};
    // eslint-disable-next-line no-console
    console.log(`  tool=${tool} input=${JSON.stringify(input)}`);

    if (typeof tool !== "string") {
      res
        .status(400)
        .json({ error: "Body must include a string `tool` field." });
      return;
    }

    switch (tool) {
      case "echo": {
        const message = (input as { message?: unknown })?.message;
        if (typeof message !== "string") {
          res
            .status(400)
            .json({ error: "`input.message` must be a string." });
          return;
        }
        res.json({ echoed: message });
        return;
      }
      case "add_numbers": {
        const { a, b } = (input ?? {}) as { a?: unknown; b?: unknown };
        if (typeof a !== "number" || typeof b !== "number") {
          res
            .status(400)
            .json({ error: "`input.a` and `input.b` must be numbers." });
          return;
        }
        res.json({ sum: a + b });
        return;
      }
      case "random_int": {
        const { min, max } = (input ?? {}) as { min?: unknown; max?: unknown };
        if (
          typeof min !== "number" ||
          typeof max !== "number" ||
          !Number.isInteger(min) ||
          !Number.isInteger(max) ||
          min > max
        ) {
          res.status(400).json({
            error:
              "`input.min` and `input.max` must be integers with min <= max.",
          });
          return;
        }
        const value = Math.floor(Math.random() * (max - min + 1)) + min;
        res.json({ value });
        return;
      }
      default:
        res.status(404).json({ error: `Unknown tool "${tool}".` });
        return;
    }
  });

  return app;
}

// Auto-listen when invoked as a script (not when imported by tests).
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1]);
if (isMain) {
  const PORT = Number(process.env.PORT ?? 4100);
  const app = createMockApp();
  app.listen(PORT, () => {
    const base = `http://localhost:${PORT}`;
    // eslint-disable-next-line no-console
    console.log(`Mock toolpack server listening on ${base}`);
    // eslint-disable-next-line no-console
    console.log(`  schema:   ${base}/schema`);
    // eslint-disable-next-line no-console
    console.log(`  runtime:  ${base}/runtime`);
    // eslint-disable-next-line no-console
    console.log(`  metadata: ${base}/metadata`);
  });
}
