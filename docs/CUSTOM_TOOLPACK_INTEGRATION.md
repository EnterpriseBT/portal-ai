# Custom Toolpack Integration Guide

This guide is for developers building a **toolpack server** — an HTTP service that Portal.ai calls to fetch a tool catalog and execute tool invocations during portal sessions. If you're an org admin enabling an existing toolpack, you don't need this guide.

A reference implementation lives at `apps/api/src/scripts/mock-toolpack-server.ts`. Run it with `npm run webhook:toolpack` from `apps/api/` and point a registration at `http://localhost:4100` to see the contract end-to-end.

---

## Contract overview

**Precondition (#214):** custom toolpacks are a subscription-tier entitlement. Registering one when the organization's plan doesn't include them returns `403 TOOLPACK_NOT_ENTITLED` — nothing is fetched or stored. Existing registrations are never deleted on a plan downgrade: they show as *Inactive on your plan*, their tools stop being offered in portal sessions, management (edit/refresh/delete) stays available, and everything reactivates automatically when the plan allows them again.

Your server exposes three HTTP endpoints. Portal.ai calls them as the registering org admin, signing every request with a per-toolpack HMAC secret your server can verify.

| Method | Path | When called | Required |
|---|---|---|---|
| `GET` | `/schema` | At registration time and on every refresh. Returns the list of tools. | Yes |
| `GET` | `/metadata` | Best-effort during registration / refresh. Returns descriptions + examples shown in the UI. | No |
| `POST` | `/runtime` | Once per tool invocation during a portal session. Body: `{ tool: string, input: object }`. | Yes |

You pick the URL paths. The three endpoints can live on the same host or on different hosts; you supply each URL during registration.

---

## What Portal.ai sends on every request

Three signing headers are added to every outbound call (schema, metadata, runtime):

```
X-Portalai-Timestamp: 1779148800
X-Portalai-Webhook-Id: 11111111-1111-4111-8111-111111111111
X-Portalai-Signature: v1=8c2a3f...
```

The signature is `HMAC-SHA256` over the string `<timestamp>.<webhook-id>.<body>`, hex-encoded, prefixed with `v1=` (the version field is reserved so we can swap algorithms without breaking receivers). For `GET` requests, the body is the empty string — the timestamp + webhook id still bind into the digest, so a captured request cannot be replayed past your acceptance window.

In addition, any custom auth headers you configured during registration (e.g. `Authorization: Bearer <token>`) are forwarded verbatim. The signing headers are added on top — verify both layers if you want defense in depth.

---

## Verifying signatures

Your server should verify three things on every request, in this order:

1. **Headers are present.** Reject `401 SIGNATURE_MISSING` if any of the three signing headers are absent.
2. **Timestamp is fresh.** Reject `401 TIMESTAMP_STALE` if `X-Portalai-Timestamp` is more than 300 seconds old or more than 60 seconds in the future. The 300-second replay window matches Stripe / Slack / Svix.
3. **Signature is valid.** Recompute the HMAC over `<timestamp>.<webhook-id>.<rawBody>`, hex-encode, and compare against the `v1=` portion of `X-Portalai-Signature` using a constant-time equality check. Reject `401 SIGNATURE_INVALID` on mismatch.

**Critical: verify against the *raw* request body, not a re-stringified version.** If your framework parses JSON before you can hash, capture the raw bytes upstream of the parser.

### Node.js / TypeScript (Express)

```ts
import crypto from "crypto";
import express from "express";

const SIGNING_SECRET = process.env.TOOLPACK_SIGNING_SECRET!;

const app = express();

// Capture the raw body before express.json() consumes it.
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use((req, res, next) => {
  const ts = req.header("X-Portalai-Timestamp");
  const id = req.header("X-Portalai-Webhook-Id");
  const sig = req.header("X-Portalai-Signature");

  if (!ts || !id || !sig) {
    return res.status(401).json({ error: "SIGNATURE_MISSING" });
  }
  const ageSec = Math.floor(Date.now() / 1000) - Number(ts);
  if (Number.isNaN(ageSec) || ageSec > 300 || ageSec < -60) {
    return res.status(401).json({ error: "TIMESTAMP_STALE" });
  }

  const rawBody = (req as any).rawBody?.toString("utf8") ?? "";
  const expected = crypto
    .createHmac("sha256", SIGNING_SECRET)
    .update(`${ts}.${id}.${rawBody}`)
    .digest("hex");
  const provided = sig.startsWith("v1=") ? sig.slice(3) : "";

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "SIGNATURE_INVALID" });
  }
  next();
});
```

### Python (Flask)

```python
import hmac, hashlib, os, time
from flask import Flask, request, abort

SIGNING_SECRET = os.environ["TOOLPACK_SIGNING_SECRET"].encode()
app = Flask(__name__)

@app.before_request
def verify_signature():
    ts = request.headers.get("X-Portalai-Timestamp")
    wid = request.headers.get("X-Portalai-Webhook-Id")
    sig = request.headers.get("X-Portalai-Signature", "")
    if not (ts and wid and sig):
        abort(401, "SIGNATURE_MISSING")

    age = int(time.time()) - int(ts)
    if age > 300 or age < -60:
        abort(401, "TIMESTAMP_STALE")

    raw = request.get_data()  # raw bytes, before JSON parsing
    payload = f"{ts}.{wid}.".encode() + raw
    expected = hmac.new(SIGNING_SECRET, payload, hashlib.sha256).hexdigest()
    provided = sig[3:] if sig.startswith("v1=") else ""
    if not hmac.compare_digest(expected, provided):
        abort(401, "SIGNATURE_INVALID")
```

### Go (net/http)

```go
package main

import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
    "io"
    "net/http"
    "os"
    "strconv"
    "strings"
    "time"
)

var signingSecret = []byte(os.Getenv("TOOLPACK_SIGNING_SECRET"))

func verifySignature(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ts := r.Header.Get("X-Portalai-Timestamp")
        id := r.Header.Get("X-Portalai-Webhook-Id")
        sig := r.Header.Get("X-Portalai-Signature")
        if ts == "" || id == "" || sig == "" {
            http.Error(w, "SIGNATURE_MISSING", http.StatusUnauthorized)
            return
        }
        tsNum, err := strconv.ParseInt(ts, 10, 64)
        if err != nil {
            http.Error(w, "SIGNATURE_MISSING", http.StatusUnauthorized)
            return
        }
        age := time.Now().Unix() - tsNum
        if age > 300 || age < -60 {
            http.Error(w, "TIMESTAMP_STALE", http.StatusUnauthorized)
            return
        }

        body, _ := io.ReadAll(r.Body)
        r.Body = io.NopCloser(strings.NewReader(string(body)))

        mac := hmac.New(sha256.New, signingSecret)
        mac.Write([]byte(ts + "." + id + "."))
        mac.Write(body)
        expected := hex.EncodeToString(mac.Sum(nil))
        provided := strings.TrimPrefix(sig, "v1=")

        a, _ := hex.DecodeString(expected)
        b, _ := hex.DecodeString(provided)
        if !hmac.Equal(a, b) {
            http.Error(w, "SIGNATURE_INVALID", http.StatusUnauthorized)
            return
        }
        next.ServeHTTP(w, r)
    })
}
```

---

## Endpoint shapes

### `GET /schema`

Returns the catalog of tools your toolpack provides.

```json
{
  "tools": [
    {
      "name": "lookup_company",
      "description": "Look up a company by domain.",
      "parameterSchema": {
        "type": "object",
        "properties": {
          "domain": { "type": "string" }
        },
        "required": ["domain"]
      }
    }
  ]
}
```

- `name` is `snake_case`, ≤ 63 chars, must not collide with built-in tool names (the registration step rejects collisions).
- `description` and `parameterSchema` are passed verbatim to the model — quality matters for tool-selection accuracy.
- 1–32 tools per pack. The schema response is capped at **256 KB**.

#### `capability` (optional)

A tool may declare a `capability` object describing how Portal.ai consumes it. Custom tools run third-party with no backend access, so they may declare only the **pure-consumer subset** — registration rejects anything outside it with `TOOLPACK_CAPABILITY_INVALID`:

| Field | Allowed for a custom tool |
|---|---|
| `pure` | must be `true` |
| `reads` / `writes` / `locks` | must be empty (`[]`) |
| `alwaysAvailable` | must be `false` |
| `computeShape` | `map` \| `reduce` \| `pure` |
| `consumption.mode` | `none` (inline), `bounded` (records-in-body), or `streaming` (pull-on-read) — see [Scaling over large datasets](#scaling-over-large-datasets). `engine-pushdown` is rejected (no backend access) |
| `production` | **output cardinality** — `{ "kind": "value" }` (a scalar/summary, always returned inline) or `{ "kind": "rows", "onLarge": "handle" \| "sample" \| "error", "inlineThreshold"?: number }` (a row set: returned inline when small, otherwise handled per `onLarge`). The mirror of `consumption`, for output. |
| `resultKind` | `scalar` \| `data-table` \| `vega-lite` \| `vega` \| `d3` \| `geo` (not `mutation-result` / `progress`). Must agree with `production`: `scalar` ⇒ `production.kind: "value"`. |
| `costHint` | `free` \| `metered` \| `expensive`. **Advisory for custom tools** — never billed against the org's Portal allocation (see the note below). |

> **`costHint` is advisory for custom tools (#169).** Portal.ai meters *its own* cost — the paid third-party APIs and heavy compute behind **built-in** tools — against an organization's subscription usage allocation. A custom toolpack runs on **your** endpoint and bills **you**, so a custom tool is **never charged against the org's Portal usage**, whatever its `costHint`. Declaring `metered`/`expensive` does **not** gate or deny the call; it only surfaces advisory context to the agent (it's told the tool "may be costly — call it only when needed") so it uses your endpoint judiciously. (Built-in `metered`/`expensive` tools *are* server-enforced against the allocation; the `expensive` bulk cost-acknowledgement handshake is unchanged.)

`consumption` (input) and `production` (output) are **independent**: any combination is valid. In particular `production.onLarge: "handle"` works for **any** input mode — declaring it earns your tool an `output` write-grant (see [Scaling over large datasets](#scaling-over-large-datasets)), so even a `consumption: none` tool can stage a large result handle.

```json
"capability": {
  "pure": true, "reads": [], "writes": [], "locks": [],
  "consumption": { "mode": "none" },
  "computeShape": "pure",
  "costHint": "free",
  "resultKind": "scalar",
  "production": { "kind": "value" },
  "alwaysAvailable": false
}
```

A row-producing tool that should stage large results past the inline limit instead declares, e.g.:

```json
"production": { "kind": "rows", "onLarge": "handle" }
```

A declared `capability` must include `production`. A tool that omits `capability` entirely is treated as a pure inline tool.

### `GET /metadata` (optional)

Returns human-readable descriptions, summaries, and worked examples shown in the in-app help.

```json
{
  "summary": "Customer-intelligence lookups against our internal CRM.",
  "tools": [
    {
      "name": "lookup_company",
      "description": "Returns CRM data keyed by domain.",
      "examples": [
        {
          "title": "Acme lookup",
          "input": { "domain": "acme.com" },
          "output": { "name": "Acme", "industry": "Software" }
        }
      ]
    }
  ]
}
```

If unconfigured or any failure (HTTP, oversize, malformed), Portal.ai registers without metadata — the toolpack still works at runtime. Capped at **256 KB**.

### `POST /runtime`

Called once per tool invocation during a portal session. Body:

```json
{
  "tool": "lookup_company",
  "input": { "domain": "acme.com" }
}
```

Return JSON. The shape is opaque to Portal.ai — it's handed straight to the model. Examples:

```json
{ "name": "Acme", "industry": "Software", "employees": 250 }
```

```json
{ "error": "domain not found" }
```

- 30-second timeout enforced upstream.
- Response body capped at **1 MB** by default (configurable per environment via `TOOLPACK_RUNTIME_MAX_RESPONSE_BYTES`). To return more, declare `streaming` consumption and stage your result — see [Scaling over large datasets](#scaling-over-large-datasets).
- Non-2xx responses surface as runtime errors in the portal.
- The runtime body carries extra fields when the tool declares a dataset-consuming `consumption` (`records`, `source`, `output`) — see the next section.

---

## Scaling over large datasets

A tool that reduces or maps over a dataset shouldn't force every row through the model's context, and its result shouldn't be capped at 1 MB. Declare a `consumption.mode` and Portal.ai handles the transport — **rows never enter the agent's context**, in either direction. The mode you declare *is* the tier:

### `bounded` — records in the request body

Portal.ai resolves the dataset (a query handle the agent already has, or inline rows) up to your `maxRows` and POSTs them alongside the input. Declare:

```json
"consumption": { "mode": "bounded", "maxRows": 50000, "onOverflow": "error" }
```

`onOverflow` (`error` | `sample`) decides what happens when the source exceeds `maxRows`. Your `/runtime` then receives:

```json
{ "tool": "sum_revenue", "input": { "column": "amount" },
  "records": [ { "amount": 12.5 }, { "amount": 9.0 } ] }
```

Compute over `records` and return your result inline (≤ 1 MB).

### `streaming` — pull-on-read (any N)

For datasets past the in-memory limit, declare:

```json
"consumption": { "mode": "streaming" }
```

Instead of rows, the body carries a **short-lived, scoped grant** — your server pulls pages itself:

```json
{ "tool": "count_rows", "input": {},
  "source": {
    "readUrl": "https://<portal>/api/webhook/handle/qh-abc123",
    "readToken": "<opaque>", "rowCount": 2400000,
    "schema": [ { "name": "id", "type": "uuid" } ], "pageLimit": 5000
  },
  "output": { "writeUrl": "https://<portal>/api/webhook/handle/<session>", "writeToken": "<opaque>" } }
```

**Pull the input** by paging `readUrl` with the read token until you've seen `rowCount` rows:

```
GET {source.readUrl}?offset=0&limit=5000
Authorization: Bearer {source.readToken}
→ { "success": true, "payload": { "rows": [...], "total": 2400000, "offset": 0, "limit": 5000 } }
```

- The token is **scoped to this one handle, read-only, and expires** with the call (and is revoked when your tool returns). Never the user's credentials.
- `offset`/`limit` page the result; `limit` is clamped to ≤ 5000.

**Return a large result** (past the 1 MB inline cap) by staging it to `output.writeUrl`, then returning the handle:

```
POST {output.writeUrl}
Authorization: Bearer {output.writeToken}
{ "rows": [ ...your result rows... ], "schema": [ { "name": "bucket", "type": "text" } ] }
→ { "success": true, "payload": { "resultHandle": "qh-def456", "rowCount": 80000 } }
```

then your `/runtime` response is simply:

```json
{ "resultHandle": "qh-def456" }
```

Portal.ai verifies the handle was the one staged for *this* call and hands the agent a query handle (it reads/charts it like any other). Small results still return inline — staging is opt-in.

> Auth failures on the read/write endpoints are `401` (`WEBHOOK_READ_TOKEN_INVALID` / `_EXPIRED`) or `403` (`WEBHOOK_HANDLE_SCOPE_MISMATCH`). The endpoints fail closed against a token used past its window, for the wrong handle, the wrong org, or the wrong direction.

The reference implementation of all three tiers lives in `apps/api/src/scripts/mock-toolpack-server.ts` (`sum_records`, `count_via_pull`, `aggregate_to_handle`).

---

## URL requirements

URLs are validated at two layers — at registration and again immediately before each outbound call:

- **Scheme**: `https://` is required in production. `http://localhost*` and `http://127.0.0.1*` are accepted in non-production environments (so the dev workflow against a local mock server works).
- **Hostname**: must resolve to a public unicast IP. Private (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16` — including the cloud-metadata service), ULA, and reserved ranges are rejected. Loopback (`127/8`, `::1`) is also rejected in production but allowed in non-production for the localhost dev workflow.
- **DNS rebinding** is defeated by re-resolving immediately before each fetch (the call connects only to the resolved IP, not the hostname).

If your toolpack is on a corporate VPN with a private IP, you'll need a public ingress (e.g. an authenticated reverse proxy or a tunnel like ngrok or Cloudflare Tunnel) before registering.

---

## The signing secret

When you (or your org admin) registers a toolpack:

1. Portal.ai generates a fresh `whsec_<base64url-32B>` secret server-side.
2. The plaintext is shown **exactly once** on the registration response.
3. The secret is encrypted at rest in Portal.ai's database (AES-256-GCM, per-deployment key).
4. Every subsequent read returns only `{ signingSecretStatus: { has: true } }` — the plaintext never leaves the server again.

Copy the secret out of band into your toolpack server's environment (e.g. `TOOLPACK_SIGNING_SECRET`).

### Rotation

If you lose the secret or suspect compromise, click **"Rotate signing secret"** on the toolpack's edit dialog. Portal.ai generates and reveals a fresh secret; the old one is invalidated immediately. Update your server's environment to the new value to resume verification.

This is the only way to re-view a secret — there is no "show secret" endpoint.

---

## Optional auth headers

In addition to the signing protocol, you may configure free-form auth headers (`Authorization: Bearer <token>`, `X-Api-Key: ...`, etc.) at registration. These are stored encrypted at rest and forwarded verbatim on every outbound call.

The signing protocol is the authoritative authentication mechanism — auth headers are an opt-in second layer for toolpacks that have existing token infrastructure they want to reuse. Choose based on your needs:

| Need | Reach for |
|---|---|
| Cryptographic proof the request came from Portal.ai | Signing (always on) |
| Multi-tenant routing inside your toolpack server | Signing identifies the toolpack via the secret used; you don't need a separate token. |
| Drop-in compatibility with an existing API gateway | Configure the gateway's auth header at registration; the gateway sees what it expects. |
| Per-environment isolation | One toolpack per environment, with its own signing secret. |

---

## Testing your verification

The mock toolpack server (`apps/api/src/scripts/mock-toolpack-server.ts`) is the canonical reference. Run it locally:

```bash
cd apps/api
export MOCK_TOOLPACK_SIGNING_SECRET=whsec_dev_test
npm run webhook:toolpack
```

It listens on `http://localhost:4100` and verifies the same three headers your server should. Failure modes:

- **`401 SIGNATURE_MISSING`** — the request had no signing headers (or some were absent).
- **`401 TIMESTAMP_STALE`** — the timestamp was outside the ±300 s / ±60 s window. Check clock drift.
- **`401 SIGNATURE_INVALID`** — the signature didn't match. Check that you're hashing the raw body (not re-stringified JSON), that the secret matches what Portal.ai sent, and that the payload is `<ts>.<id>.<body>` exactly.

If `MOCK_TOOLPACK_SIGNING_SECRET` is unset, the mock server warns and accepts unsigned requests — useful for early development before you've registered, but never in any environment you trust.

---

## Outbound expectations summary

| Aspect | Value |
|---|---|
| Schema / metadata response cap | 256 KB |
| Runtime response cap (default) | 1 MB |
| Outbound timeout | 30 seconds |
| Replay window | ±300 s past, ±60 s future |
| Signing algorithm | HMAC-SHA256, `v1=` prefix |
| Header names | `X-Portalai-Timestamp`, `X-Portalai-Webhook-Id`, `X-Portalai-Signature` |
| Body encoding (POST) | JSON, signed verbatim |
| TLS | Required in production (`http://localhost` allowed for dev only) |

---

## Failure-mode debugging

| Symptom in Portal.ai | Likely cause |
|---|---|
| Registration fails with `TOOLPACK_URL_PRIVATE_HOST` | Your URL hostname resolves to an RFC1918 / link-local / loopback IP. Use a public ingress. |
| Registration fails with `TOOLPACK_URL_NOT_HTTPS` | Production rejects `http://`. Configure TLS or use `https://`. |
| Registration fails with `TOOLPACK_SCHEMA_FETCH_FAILED` | Your `/schema` endpoint returned non-2xx, timed out, or your server isn't reachable from Portal.ai's egress. |
| Registration fails with `TOOLPACK_SCHEMA_TOO_LARGE` | Schema response exceeded 256 KB. Trim tool descriptions; split into multiple toolpacks. |
| Registration fails with `TOOLPACK_TOOL_NAME_CONFLICT` | One of your tool names matches a built-in (e.g. `correlate`, `regression`). Rename. |
| Runtime calls fail with `TOOLPACK_RUNTIME_TOO_LARGE` | Your `/runtime` response exceeded 1 MB. Stream into pagination, or shrink the payload. |
| Tool always returns "not valid JSON" | `/runtime` is returning HTML (likely an auth-failure page) or non-JSON. Check your response shape. |

---

## Reference checklist

Before going live, confirm your toolpack server:

- [ ] Verifies all three signing headers on every endpoint.
- [ ] Hashes the **raw** body, not re-serialized JSON.
- [ ] Uses a constant-time comparison (`hmac.compare_digest`, `crypto.timingSafeEqual`, `hmac.Equal`).
- [ ] Enforces the 300-second replay window.
- [ ] Returns within 30 seconds (Portal.ai aborts past that).
- [ ] Returns valid JSON from `/schema`, `/metadata`, and `/runtime`.
- [ ] Stays under 256 KB on schema/metadata responses, 1 MB on runtime.
- [ ] Reachable over HTTPS from the public internet (in production).
- [ ] Stores the signing secret in a secret manager, not in source.
- [ ] Has a rotation runbook for when the secret is compromised.
