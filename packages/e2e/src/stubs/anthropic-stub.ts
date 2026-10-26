/**
 * A deterministic stand-in for Anthropic's Messages API (#489).
 *
 * The CSV import's interpret step calls a model twice (a column classifier
 * and an axis-name recommender, via `generateObject`). The e2e stack points
 * the API's `ANTHROPIC_BASE_URL` here so the core loop runs with no key, no
 * cost and no nondeterminism. Each answer is the schema-valid "no confident
 * match", so interpret binds every column to the seeded `text` definition.
 *
 * Recognises a request by its JSON schema's top-level properties, from either
 * native structured output (`output_config.format.schema`, what the AI SDK
 * sends today) or tool mode (one tool's `input_schema`). Anything else is a
 * 400, so a new model call site fails the walk loudly rather than passing on a
 * guess.
 */

import http from "node:http";
import { pathToFileURL } from "node:url";

type Json = Record<string, unknown>;

/** The canned "no confident match" per known schema, keyed by its properties. */
function answerFor(schema: unknown): Json | null {
  const props = Object.keys(
    ((schema as Json | undefined)?.properties as Json | undefined) ?? {}
  );
  if (props.includes("classifications")) return { classifications: [] };
  if (props.includes("name") && props.includes("confidence")) {
    return { name: "value", confidence: 0 };
  }
  return null;
}

const message = (body: Json, content: Json[], stopReason: string): Json => ({
  id: "msg_e2e_stub",
  type: "message",
  role: "assistant",
  model: typeof body.model === "string" ? body.model : "e2e-stub",
  content,
  stop_reason: stopReason,
  stop_sequence: null,
  usage: { input_tokens: 0, output_tokens: 0 },
});

function respond(body: Json): { status: number; payload: Json } {
  const format = (body.output_config as Json | undefined)?.format as
    | Json
    | undefined;
  if (format?.schema) {
    const answer = answerFor(format.schema);
    if (answer) {
      return {
        status: 200,
        payload: message(
          body,
          [{ type: "text", text: JSON.stringify(answer) }],
          "end_turn"
        ),
      };
    }
  }

  const tools = body.tools as Json[] | undefined;
  if (tools?.length === 1) {
    const answer = answerFor(tools[0].input_schema);
    if (answer) {
      return {
        status: 200,
        payload: message(
          body,
          [
            {
              type: "tool_use",
              id: "toolu_e2e_stub",
              name: tools[0].name,
              input: answer,
            },
          ],
          "tool_use"
        ),
      };
    }
  }

  return {
    status: 400,
    payload: {
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "e2e stub: unrecognized schema",
      },
    },
  };
}

export function createAnthropicStub(): http.Server {
  return http.createServer((req, res) => {
    const send = (status: number, payload: Json) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (req.method === "GET" && req.url === "/health") {
      return send(200, { ok: true });
    }
    if (req.method !== "POST" || !req.url?.endsWith("/messages")) {
      return send(404, { error: "e2e stub: only POST /v1/messages" });
    }

    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body: Json;
      try {
        body = JSON.parse(raw) as Json;
      } catch {
        return send(400, { error: "e2e stub: body is not JSON" });
      }
      const { status, payload } = respond(body);
      send(status, payload);
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.E2E_ANTHROPIC_STUB_PORT ?? 4010);
  createAnthropicStub().listen(port, () =>
    console.log(`[e2e:stub:anthropic] listening on :${port}`)
  );
}
