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
 * If `MOCK_TOOLPACK_SIGNING_SECRET` is unset, the server logs each
 * request as Signature: SKIPPED and accepts unsigned requests so
 * existing dev workflows are not broken. This file IS the reference
 * implementation toolpack authors should mirror.
 *
 * Verbose logging: every request prints its method, URL, all headers
 * (with auth + signing headers color-highlighted), the raw body, the
 * signature-verification outcome, and the response status + body.
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

// Cap the in-log body size so a runaway response doesn't flood the
// terminal. The full raw body still passes through to the actual
// HMAC + tool handler — only the log printout gets truncated.
const LOG_BODY_MAX_BYTES = 4096;

// ── ANSI color helpers ────────────────────────────────────────────
//
// Plain ANSI escapes — terminal-only formatting. No `chalk` dep.
// Node honors these on TTY stdout; if the output is piped to a file
// the codes show up as printable bytes (acceptable for a dev tool).

const ESC = String.fromCharCode(27) + "[";
const c = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  gray: `${ESC}90m`,
};

function tone(text: string, code: string): string {
  return `${code}${text}${c.reset}`;
}

function statusTone(code: number): string {
  if (code >= 500) return c.red;
  if (code >= 400) return c.yellow;
  if (code >= 300) return c.cyan;
  return c.green;
}

/**
 * Color-code header names so signing headers + auth headers stand
 * out from the boring HTTP infrastructure ones.
 */
function headerNameTone(name: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith("x-portalai-")) return c.cyan;
  if (lower === "authorization" || lower.startsWith("x-api")) return c.magenta;
  if (lower.startsWith("x-")) return c.magenta;
  return c.gray;
}

function indent(text: string, n = 4): string {
  const pad = " ".repeat(n);
  return text
    .split("\n")
    .map((line) => `${pad}${line}`)
    .join("\n");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n${tone(
    `… [truncated ${text.length - max} more bytes]`,
    c.dim
  )}`;
}

function prettyPrintBody(raw: string, contentType?: string): string {
  if (!raw) return tone("(empty body)", c.dim);
  const isJson = (contentType ?? "").toLowerCase().includes("application/json");
  if (isJson) {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      // fall through to raw
    }
  }
  return raw;
}

function logHeaders(prefix: string, headers: Record<string, unknown>): void {
  const entries = Object.entries(headers).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  console.log(`${prefix} ${tone("Headers", c.bold)}`);
  for (const [name, value] of entries) {
    const v = Array.isArray(value) ? value.join(", ") : String(value);
    console.log(`${prefix}     ${tone(name, headerNameTone(name))}: ${v}`);
  }
}

// ── Tool defaults for the NEO bulk-dispatch suite ────────────────────
//
// Used by the four `nasa_diameter_avg_*` tools — they all wrap the
// same per-record midpoint derivation but vary in their bulkDispatch
// declaration so §4a–d of docs/LARGE_DATA_OPS.smoke.md can exercise:
//   a) happy path                — fast
//   b) cost-acknowledgement gate — expensive
//   c) not-bulk-dispatchable     — no_bulk (no bulkDispatch field)
//   d) partial-failures + retry  — flaky (throws on every 20th c_id)

const NEO_PER_CALL_LATENCY_MS = Number(
  process.env.MOCK_TOOLPACK_LATENCY_MS ?? 50
);
const NEO_FLAKY_MOD = Number(process.env.MOCK_TOOLPACK_FLAKY_MOD ?? 20);

const NEO_PARAM_SCHEMA = {
  type: "object",
  properties: {
    c_id: { type: "number", description: "NEO source id (numeric)." },
    c_diameter_km_min: { type: "number" },
    c_diameter_km_max: { type: "number" },
  },
  required: ["c_id", "c_diameter_km_min", "c_diameter_km_max"],
};

const NEO_TOOL_DESC =
  "Compute the diameter midpoint (km) for one NEO record. Returns " +
  "a single numeric value (the midpoint). The caller decides what to " +
  "do with it — for bulk_transform_entity_records, supply " +
  "`targetColumn` to land the value in a wide-column on the target.";

const tools = [
  {
    name: "echo",
    description:
      "Echo back the provided message. Useful for verifying the round-trip works end-to-end.",
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
  // ── #85 Phase 4 webhook bulkDispatch suite ──────────────────────────
  {
    name: "nasa_diameter_avg_fast",
    description: NEO_TOOL_DESC,
    parameterSchema: NEO_PARAM_SCHEMA,
    bulkDispatch: {
      maxConcurrency: 10,
      timeoutMs: 5_000,
      idempotent: true,
      estimatedMsPerCall: NEO_PER_CALL_LATENCY_MS,
    },
  },
  {
    name: "nasa_diameter_avg_expensive",
    description: `${NEO_TOOL_DESC} Declared as expensive — the API gates dispatch behind \`acknowledgeCost: true\`.`,
    parameterSchema: NEO_PARAM_SCHEMA,
    bulkDispatch: {
      maxConcurrency: 10,
      timeoutMs: 5_000,
      idempotent: true,
      estimatedMsPerCall: NEO_PER_CALL_LATENCY_MS,
      costHint: "expensive" as const,
    },
  },
  {
    name: "nasa_diameter_avg_flaky",
    description: `${NEO_TOOL_DESC} Throws for ~${Math.round(100 / NEO_FLAKY_MOD)}% of records (every \`c_id % ${NEO_FLAKY_MOD} === 0\`). Exercises the partialFailures + retry-failed-only flow.`,
    parameterSchema: NEO_PARAM_SCHEMA,
    bulkDispatch: {
      maxConcurrency: 10,
      timeoutMs: 5_000,
      idempotent: true,
      estimatedMsPerCall: NEO_PER_CALL_LATENCY_MS,
    },
  },
  {
    name: "nasa_diameter_avg_no_bulk",
    description: `${NEO_TOOL_DESC} Same body as fast, but no \`bulkDispatch\` field — covers the §4c BULK_DISPATCH_TOOL_NOT_BULK_DISPATCHABLE rejection path.`,
    parameterSchema: NEO_PARAM_SCHEMA,
  },
];

function neoDiameterAvg(input: Record<string, unknown>): number {
  // Tools are pure functions — return the value, not a target-shaped
  // record. The agent decides which wide-column receives it via
  // `bulk_transform_entity_records`' `targetColumn` parameter.
  const min = Number(input.c_diameter_km_min);
  const max = Number(input.c_diameter_km_max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error(
      "c_diameter_km_min / c_diameter_km_max must be numeric"
    );
  }
  return (min + max) / 2;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
 * Verbose request/response logger. Emits a per-request log block
 * showing every incoming header, the raw request body, the
 * eventual response status + body, and the round-trip latency.
 *
 * Monkey-patches `res.status` + `res.json` (per-request only) so
 * we can capture the values the route handler hands back without
 * Express having already serialized them. The captured outcome is
 * printed in a `res.on("finish")` listener so all log lines for
 * one request stay grouped together.
 *
 * Must run *before* `verifySignature` so that 401 responses from
 * the verifier are also captured + printed.
 */
function verboseLog(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const reqId = crypto.randomBytes(3).toString("hex");
  const tag = tone(`[req ${reqId}]`, c.dim);

  // Capture status + body the route eventually emits.
  let capturedStatus = 200;
  let capturedBody: unknown = undefined;
  let capturedBodyKind: "json" | "send" | null = null;

  const origStatus = res.status.bind(res);
  res.status = (code: number) => {
    capturedStatus = code;
    return origStatus(code);
  };

  const origJson = res.json.bind(res);
  res.json = (body: unknown) => {
    capturedStatus = res.statusCode || capturedStatus;
    capturedBody = body;
    capturedBodyKind = "json";
    return origJson(body);
  };

  const origSend = res.send.bind(res);
  res.send = ((body: unknown) => {
    if (capturedBody === undefined) {
      capturedStatus = res.statusCode || capturedStatus;
      capturedBody = body;
      capturedBodyKind = "send";
    }
    return origSend(body as never);
  }) as typeof res.send;

  // Print the request half immediately so the operator can see what
  // landed even if the response is delayed.
  console.log(
    `\n${tag} ${tone("→", c.blue)} ${tone(req.method, c.bold)} ${req.url}`
  );
  logHeaders(tag, req.headers as Record<string, unknown>);

  const rawBody = req.rawBody?.toString("utf8") ?? "";
  if (rawBody.length > 0) {
    console.log(
      `${tag} ${tone("Body", c.bold)} ${tone(
        `(${rawBody.length} bytes)`,
        c.dim
      )}`
    );
    console.log(
      indent(
        truncate(
          prettyPrintBody(rawBody, req.header("content-type") ?? undefined),
          LOG_BODY_MAX_BYTES
        ),
        4
      )
    );
  }

  // Print the response half once the response has been flushed.
  res.on("finish", () => {
    const ms = Date.now() - start;
    const status = capturedStatus || res.statusCode;
    console.log(
      `${tag} ${tone("←", statusTone(status))} ${tone(
        String(status),
        statusTone(status) + c.bold
      )} ${tone(`(${ms}ms)`, c.dim)}`
    );

    if (capturedBody !== undefined) {
      let bodyText = "";
      if (capturedBodyKind === "json") {
        bodyText = JSON.stringify(capturedBody, null, 2);
      } else if (typeof capturedBody === "string") {
        bodyText = capturedBody;
      } else if (Buffer.isBuffer(capturedBody)) {
        bodyText = `<Buffer ${capturedBody.length} bytes>`;
      } else {
        bodyText = JSON.stringify(capturedBody);
      }
      if (bodyText.length > 0) {
        console.log(`${tag} ${tone("Body", c.bold)}`);
        console.log(indent(truncate(bodyText, LOG_BODY_MAX_BYTES), 4));
      }
    }
  });

  next();
}

/**
 * Verify the three X-Portalai-* signing headers against the raw body
 * using the shared signing secret. Demonstrates the canonical
 * receiver-side verification — toolpack authors should mirror this
 * pattern in their own server.
 *
 * If `MOCK_TOOLPACK_SIGNING_SECRET` is unset, logs `Signature: SKIPPED`
 * and proceeds so existing dev workflows that predate phase 6 keep
 * working.
 */
function verifySignature(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const logOutcome = (
    color: string,
    label: string,
    detail?: string
  ): void => {
    console.log(
      `    ${tone("Signature:", c.bold)} ${tone(label, color)}${
        detail ? ` ${tone(detail, c.dim)}` : ""
      }`
    );
  };

  const secret = process.env.MOCK_TOOLPACK_SIGNING_SECRET;
  if (!secret) {
    logOutcome(
      c.yellow,
      "SKIPPED",
      "MOCK_TOOLPACK_SIGNING_SECRET not set — set it to verify"
    );
    next();
    return;
  }

  const ts = req.header("X-Portalai-Timestamp");
  const id = req.header("X-Portalai-Webhook-Id");
  const sig = req.header("X-Portalai-Signature");

  if (!ts || !id || !sig) {
    logOutcome(
      c.red,
      "SIGNATURE_MISSING",
      "one or more X-Portalai-* headers absent"
    );
    res.status(401).json({ error: "SIGNATURE_MISSING" });
    return;
  }

  const tsNum = Number(ts);
  if (Number.isNaN(tsNum)) {
    logOutcome(c.red, "SIGNATURE_MISSING", `timestamp "${ts}" is not numeric`);
    res.status(401).json({ error: "SIGNATURE_MISSING" });
    return;
  }
  const ageSec = Math.floor(Date.now() / 1000) - tsNum;
  if (ageSec > REPLAY_WINDOW_SEC || ageSec < -FORWARD_SKEW_SEC) {
    logOutcome(c.red, "TIMESTAMP_STALE", `ageSec=${ageSec}`);
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
    logOutcome(
      c.red,
      "SIGNATURE_INVALID",
      `expected v1=${expectedHex.slice(0, 12)}… got ${sig.slice(0, 15)}…`
    );
    res.status(401).json({ error: "SIGNATURE_INVALID" });
    return;
  }

  logOutcome(
    c.green,
    "VERIFIED",
    `ageSec=${ageSec} bodyBytes=${rawBody.length}`
  );
  next();
}

export function createMockApp(): Application {
  const app = express();
  app.use(express.json({ limit: "1mb", verify: captureRawBodyVerify }));
  // verboseLog must run BEFORE verifySignature so a 401 from the
  // verifier still has its response body captured + printed.
  app.use(verboseLog);
  app.use(verifySignature);

  app.get("/schema", (_req: Request, res: Response) => {
    res.json({ tools });
  });

  app.get("/metadata", (_req: Request, res: Response) => {
    res.json(metadata);
  });

  app.post("/runtime", (req: Request, res: Response) => {
    const { tool, input } = req.body ?? {};

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
      case "nasa_diameter_avg_fast":
      case "nasa_diameter_avg_expensive":
      case "nasa_diameter_avg_no_bulk": {
        (async () => {
          try {
            await sleep(NEO_PER_CALL_LATENCY_MS);
            res.json(neoDiameterAvg(input as Record<string, unknown>));
          } catch (err) {
            res.status(400).json({
              error: err instanceof Error ? err.message : "bad_input",
            });
          }
        })();
        return;
      }
      case "nasa_diameter_avg_flaky": {
        (async () => {
          try {
            await sleep(NEO_PER_CALL_LATENCY_MS);
            const id = Number(
              (input as Record<string, unknown>)?.c_id
            );
            if (Number.isFinite(id) && id % NEO_FLAKY_MOD === 0) {
              res.status(500).json({
                error: `Flaky failure injected for c_id=${id} (every ${NEO_FLAKY_MOD}th).`,
              });
              return;
            }
            res.json(neoDiameterAvg(input as Record<string, unknown>));
          } catch (err) {
            res.status(400).json({
              error: err instanceof Error ? err.message : "bad_input",
            });
          }
        })();
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
    console.log(`Mock toolpack server listening on ${base}`);
    console.log(`  schema:   ${base}/schema`);
    console.log(`  runtime:  ${base}/runtime`);
    console.log(`  metadata: ${base}/metadata`);
    if (!process.env.MOCK_TOOLPACK_SIGNING_SECRET) {
      console.log(
        tone(
          "  WARN: MOCK_TOOLPACK_SIGNING_SECRET unset — accepting unsigned requests.",
          c.yellow
        )
      );
    }
  });
}
