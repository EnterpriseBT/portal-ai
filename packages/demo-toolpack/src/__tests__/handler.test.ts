import { handler, type FunctionUrlEvent } from "../handler.js";
import { sign } from "../signing.js";

const SECRET = "whsec_handler_test";
const ID = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  process.env.PORTALAI_SIGNING_SECRETS = SECRET;
});
afterEach(() => {
  delete process.env.PORTALAI_SIGNING_SECRETS;
});

function getEvent(path: string): FunctionUrlEvent {
  return { requestContext: { http: { method: "GET" } }, rawPath: path };
}

function runtimeEvent(
  body: string,
  opts: { sign?: boolean; secret?: string } = {}
): FunctionUrlEvent {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (opts.sign !== false) {
    const ts = String(Math.floor(Date.now() / 1000));
    headers["x-portalai-timestamp"] = ts;
    headers["x-portalai-webhook-id"] = ID;
    headers["x-portalai-signature"] = sign(opts.secret ?? SECRET, ts, ID, body);
  }
  return {
    requestContext: { http: { method: "POST" } },
    rawPath: "/runtime",
    headers,
    body,
  };
}

const parse = (r: { body: string }) => JSON.parse(r.body);

describe("handler — open catalog endpoints", () => {
  it("serves GET /schema without a signature", async () => {
    const res = await handler(getEvent("/schema"));
    expect(res.statusCode).toBe(200);
    expect(parse(res).tools.map((t: { name: string }) => t.name)).toEqual([
      "quote_shipping_rate",
      "credit_check",
    ]);
  });

  it("serves GET /metadata without a signature", async () => {
    const res = await handler(getEvent("/metadata"));
    expect(res.statusCode).toBe(200);
    expect(parse(res).summary).toContain("Harborview");
  });

  it("tolerates a base path prefix and trailing slash", async () => {
    const res = await handler(getEvent("/demo-toolpack/schema/"));
    expect(res.statusCode).toBe(200);
  });
});

describe("handler — POST /runtime", () => {
  const body = JSON.stringify({
    tool: "credit_check",
    input: { customer_id: "CUST-00001" },
  });

  it("returns the tool result for a valid signed request", async () => {
    const res = await handler(runtimeEvent(body));
    expect(res.statusCode).toBe(200);
    expect(parse(res)).toMatchObject({ credit_score: 719, approved: true });
  });

  it("401s an unsigned request", async () => {
    const res = await handler(runtimeEvent(body, { sign: false }));
    expect(res.statusCode).toBe(401);
    expect(parse(res).error).toBe("SIGNATURE_MISSING");
  });

  it("401s a request signed with the wrong secret", async () => {
    const res = await handler(runtimeEvent(body, { secret: "whsec_wrong" }));
    expect(res.statusCode).toBe(401);
    expect(parse(res).error).toBe("SIGNATURE_INVALID");
  });

  it("401s when the allow-list is empty (fail-closed)", async () => {
    delete process.env.PORTALAI_SIGNING_SECRETS;
    const res = await handler(runtimeEvent(body));
    expect(res.statusCode).toBe(401);
  });

  it("404s an unknown tool", async () => {
    const b = JSON.stringify({ tool: "nope", input: {} });
    const res = await handler(runtimeEvent(b));
    expect(res.statusCode).toBe(404);
  });

  it("400s an invalid JSON body (signed over the raw bytes)", async () => {
    const res = await handler(runtimeEvent("{not json"));
    expect(res.statusCode).toBe(400);
  });

  it("decodes a base64-encoded body", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await handler({
      requestContext: { http: { method: "POST" } },
      rawPath: "/runtime",
      isBase64Encoded: true,
      body: Buffer.from(body, "utf8").toString("base64"),
      headers: {
        "x-portalai-timestamp": ts,
        "x-portalai-webhook-id": ID,
        // signature is over the decoded raw body, per the contract
        "x-portalai-signature": sign(SECRET, ts, ID, body),
      },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("handler — unknown route", () => {
  it("404s an unknown path", async () => {
    const res = await handler(getEvent("/nope"));
    expect(res.statusCode).toBe(404);
  });
});
