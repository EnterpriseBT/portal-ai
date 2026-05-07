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
 * Run from the apps/api directory:
 *
 *   npm run mock-toolpack            # listens on http://localhost:4100
 *   PORT=4500 npm run mock-toolpack  # custom port
 *
 * Then register a custom toolpack in the UI pointing at:
 *   schema:   http://localhost:4100/schema
 *   runtime:  http://localhost:4100/runtime
 *   metadata: http://localhost:4100/metadata
 */

import express, { Request, Response } from "express";

const PORT = Number(process.env.PORT ?? 4100);

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

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use((req, _res, next) => {
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
  console.log(`  tool=${tool} input=${JSON.stringify(input)}`);

  if (typeof tool !== "string") {
    res.status(400).json({ error: "Body must include a string `tool` field." });
    return;
  }

  switch (tool) {
    case "echo": {
      const message = (input as { message?: unknown })?.message;
      if (typeof message !== "string") {
        res.status(400).json({ error: "`input.message` must be a string." });
        return;
      }
      res.json({ echoed: message });
      return;
    }
    case "add_numbers": {
      const { a, b } = (input ?? {}) as { a?: unknown; b?: unknown };
      if (typeof a !== "number" || typeof b !== "number") {
        res.status(400).json({ error: "`input.a` and `input.b` must be numbers." });
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
          error: "`input.min` and `input.max` must be integers with min <= max.",
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

app.listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log(`Mock toolpack server listening on ${base}`);
  console.log(`  schema:   ${base}/schema`);
  console.log(`  runtime:  ${base}/runtime`);
  console.log(`  metadata: ${base}/metadata`);
});
