/**
 * #931: `guardedFetch` — the connect-time address check and the per-caller
 * redirect policy every fetch to an org-supplied URL goes through. These
 * run real HTTP servers on loopback (allowed outside production) and the
 * real global fetch, so they also prove the global fetch honours the
 * guarded dispatcher.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  jest,
} from "@jest/globals";

import { environment } from "../../environment.js";
import {
  guardedFetch,
  createGuardedLookup,
  findOutboundBlock,
  OutboundFetchBlockedError,
} from "../../utils/guarded-fetch.util.js";

interface Hit {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

/** A loopback server whose handler a test sets, recording every request. */
function startServer(): Promise<{
  server: http.Server;
  port: number;
  hits: Hit[];
  handle: (h: Handler) => void;
}> {
  return new Promise((resolve) => {
    const hits: Hit[] = [];
    let handler: Handler = (_req, res) => {
      res.writeHead(200);
      res.end("ok");
    };
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        hits.push({
          method: req.method ?? "",
          url: req.url ?? "",
          headers: req.headers,
          body,
        });
        handler(req, res);
      });
    });
    server.listen(0, () =>
      resolve({
        server,
        port: (server.address() as AddressInfo).port,
        hits,
        handle: (h) => (handler = h),
      })
    );
  });
}

function redirect(status: number, location: string): Handler {
  return (_req, res) => {
    res.writeHead(status, { location });
    res.end();
  };
}

async function blocked(
  p: Promise<unknown>
): Promise<OutboundFetchBlockedError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(OutboundFetchBlockedError);
    return err as OutboundFetchBlockedError;
  }
  throw new Error("expected the fetch to be blocked");
}

describe("guardedFetch (#931)", () => {
  let a: Awaited<ReturnType<typeof startServer>>;
  let b: Awaited<ReturnType<typeof startServer>>;
  let restores: Array<() => void> = [];

  beforeAll(async () => {
    a = await startServer();
    b = await startServer();
  });

  afterAll(async () => {
    await new Promise((r) => a.server.close(r));
    await new Promise((r) => b.server.close(r));
  });

  afterEach(() => {
    for (const r of restores) r();
    restores = [];
    a.hits.length = 0;
    b.hits.length = 0;
    const ok: Handler = (_req, res) => {
      res.writeHead(200);
      res.end("ok");
    };
    a.handle(ok);
    b.handle(ok);
  });

  function setEnv<K extends "NODE_ENV" | "DISABLE_OUTBOUND_URL_GUARD">(
    key: K,
    value: (typeof environment)[K]
  ): void {
    const replaced = jest.replaceProperty(environment, key, value);
    restores.push(() => replaced.restore());
  }

  const urlA = (path = "/") => `http://127.0.0.1:${a.port}${path}`;

  it("returns a 200 from loopback outside production", async () => {
    const res = await guardedFetch(urlA("/x"), {}, { redirects: "refuse" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  describe("createGuardedLookup", () => {
    const lookupWith = (
      addresses: Array<{ address: string; family: number }> | Error,
      allowLoopback = false
    ) =>
      createGuardedLookup(
        async () => {
          if (addresses instanceof Error) throw addresses;
          return addresses;
        },
        () => allowLoopback
      );

    function run(
      lookup: ReturnType<typeof createGuardedLookup>,
      all: boolean
    ): Promise<{ err: unknown; address: unknown; family: unknown }> {
      return new Promise((resolve) =>
        lookup("host.test", { all }, (err, address, family) =>
          resolve({ err, address, family })
        )
      );
    }

    it("refuses a private address", async () => {
      const { err } = await run(
        lookupWith([{ address: "10.0.0.5", family: 4 }]),
        false
      );
      expect(err).toBeInstanceOf(OutboundFetchBlockedError);
      expect((err as OutboundFetchBlockedError).reason).toBe("private-address");
      expect((err as Error).message).not.toContain("10.0.0.5");
    });

    it("refuses when any one address is private", async () => {
      const { err } = await run(
        lookupWith([
          { address: "93.184.216.34", family: 4 },
          { address: "169.254.169.254", family: 4 },
        ]),
        true
      );
      expect((err as OutboundFetchBlockedError).reason).toBe("private-address");
    });

    it("returns the first public address, or all with options.all", async () => {
      const addrs = [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:2800:220:1::", family: 6 },
      ];
      const one = await run(lookupWith(addrs), false);
      expect(one.err).toBeNull();
      expect(one.address).toBe("93.184.216.34");
      expect(one.family).toBe(4);
      const all = await run(lookupWith(addrs), true);
      expect(all.err).toBeNull();
      expect(all.address).toEqual(addrs);
    });

    it("passes a resolver error through, so a transient one stays retryable", async () => {
      const transient = Object.assign(new Error("getaddrinfo EAI_AGAIN"), {
        code: "EAI_AGAIN",
      });
      const failed = await run(lookupWith(transient), false);
      expect(failed.err).toBe(transient);
      expect(failed.err).not.toBeInstanceOf(OutboundFetchBlockedError);
    });

    it("is unresolvable on an empty answer", async () => {
      const empty = await run(lookupWith([]), false);
      expect((empty.err as OutboundFetchBlockedError).reason).toBe(
        "unresolvable"
      );
    });

    it("answers with the family asked for, after checking every address", async () => {
      const addrs = [
        { address: "2606:2800:220:1::", family: 6 },
        { address: "93.184.216.34", family: 4 },
      ];
      const v4 = await new Promise<{ err: unknown; address: unknown }>((r) =>
        lookupWith(addrs)("host.test", { family: 4 }, (err, address) =>
          r({ err, address })
        )
      );
      expect(v4.err).toBeNull();
      expect(v4.address).toBe("93.184.216.34");
      // A private address of the other family still refuses the host.
      const mixed = await new Promise<{ err: unknown }>((r) =>
        lookupWith([
          { address: "93.184.216.34", family: 4 },
          { address: "fd00::1", family: 6 },
        ])("host.test", { family: 4 }, (err) => r({ err }))
      );
      expect((mixed.err as OutboundFetchBlockedError).reason).toBe(
        "private-address"
      );
    });

    it("allows loopback only when told to", async () => {
      const loop = [{ address: "127.0.0.1", family: 4 }];
      expect((await run(lookupWith(loop, false), false)).err).toBeInstanceOf(
        OutboundFetchBlockedError
      );
      expect((await run(lookupWith(loop, true), false)).err).toBeNull();
    });
  });

  it("refuses loopback through the real global fetch in production", async () => {
    setEnv("NODE_ENV", "production");
    const err = await blocked(
      guardedFetch(`http://localhost:${a.port}/`, {}, { redirects: "refuse" })
    );
    expect(err.reason).toBe("private-address");
    expect(a.hits).toHaveLength(0);
  });

  it("refuses private IP literals before any request", async () => {
    for (const url of ["http://10.0.0.1/", "http://[::ffff:127.0.0.1]/"]) {
      const err = await blocked(guardedFetch(url, {}, { redirects: "refuse" }));
      expect(err.reason).toBe("private-address");
      expect(err.url).toBe(url);
    }
  });

  it("refuses a scheme other than http(s)", async () => {
    const err = await blocked(
      guardedFetch("ftp://example.com/x", {}, { redirects: "refuse" })
    );
    expect(err.reason).toBe("unsupported-scheme");
  });

  it("refuses any redirect under redirects: refuse", async () => {
    a.handle(redirect(302, urlA("/next")));
    const err = await blocked(
      guardedFetch(urlA("/first"), {}, { redirects: "refuse" })
    );
    expect(err.reason).toBe("redirect-refused");
    expect(err.status).toBe(302);
    expect(err.url).toBe(urlA("/first"));
    expect(a.hits.map((h) => h.url)).toEqual(["/first"]);
  });

  it("follows redirects up to max", async () => {
    a.handle((req, res) => {
      if (req.url === "/1") return redirect(302, "/2")(req, res);
      if (req.url === "/2") return redirect(301, "/3")(req, res);
      res.writeHead(200);
      res.end("end");
    });
    const res = await guardedFetch(urlA("/1"), {}, { redirects: { max: 5 } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("end");
    expect(a.hits.map((h) => h.url)).toEqual(["/1", "/2", "/3"]);
  });

  it("fails past max redirects", async () => {
    a.handle((req, res) => redirect(302, `${req.url}x`)(req, res));
    const err = await blocked(
      guardedFetch(urlA("/r"), {}, { redirects: { max: 2 } })
    );
    expect(err.reason).toBe("too-many-redirects");
    expect(a.hits).toHaveLength(3);
  });

  it("refuses a redirect to a private address without requesting it", async () => {
    a.handle(redirect(302, "http://10.0.0.1/meta"));
    const err = await blocked(
      guardedFetch(urlA("/r"), {}, { redirects: { max: 5 } })
    );
    expect(err.reason).toBe("private-address");
    expect(err.url).toBe("http://10.0.0.1/meta");
  });

  it("applies fetch's method rules across redirects", async () => {
    for (const [status, method, body] of [
      [303, "GET", ""],
      [302, "GET", ""],
      [307, "POST", "payload"],
    ] as const) {
      a.hits.length = 0;
      a.handle((req, res) =>
        req.url === "/r" ? redirect(status, "/t")(req, res) : res.end("t")
      );
      await guardedFetch(
        urlA("/r"),
        {
          method: "POST",
          body: "payload",
          headers: { "content-type": "text/plain" },
        },
        { redirects: { max: 5 } }
      );
      expect(a.hits[1]).toMatchObject({ method, url: "/t", body });
    }
  });

  it("refuses a 307 whose body can't be resent", async () => {
    a.handle(redirect(307, "/t"));
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("x"));
        c.close();
      },
    });
    const err = await blocked(
      guardedFetch(
        urlA("/r"),
        { method: "POST", body: stream, duplex: "half" } as RequestInit,
        { redirects: { max: 5 } }
      )
    );
    expect(err.reason).toBe("unreplayable-body");
  });

  it("keeps only harmless headers on a cross-origin hop", async () => {
    const headers = {
      accept: "application/json",
      "user-agent": "portalai-test",
      authorization: "Bearer secret",
      "x-api-key": "k",
      "x-portalai-signature": "v1=abc",
    };
    // Same origin: everything is kept.
    a.handle((req, res) =>
      req.url === "/r" ? redirect(302, "/t")(req, res) : res.end("t")
    );
    await guardedFetch(urlA("/r"), { headers }, { redirects: { max: 5 } });
    expect(a.hits[1].headers).toMatchObject(headers);

    // Cross origin (127.0.0.1:a → localhost:b): only the allow-list.
    a.handle(redirect(302, `http://localhost:${b.port}/t`));
    await guardedFetch(urlA("/r"), { headers }, { redirects: { max: 5 } });
    const sent = b.hits[0].headers;
    expect(sent.accept).toBe("application/json");
    expect(sent["user-agent"]).toBe("portalai-test");
    expect(sent.authorization).toBeUndefined();
    expect(sent["x-api-key"]).toBeUndefined();
    expect(sent["x-portalai-signature"]).toBeUndefined();
  });

  it("with the guard disabled, skips the address check but keeps the redirect policy", async () => {
    setEnv("DISABLE_OUTBOUND_URL_GUARD", true);
    setEnv("NODE_ENV", "production");
    const res = await guardedFetch(
      `http://localhost:${a.port}/`,
      {},
      { redirects: "refuse" }
    );
    expect(res.status).toBe(200);
    a.handle(redirect(302, "/t"));
    const err = await blocked(
      guardedFetch(urlA("/r"), {}, { redirects: "refuse" })
    );
    expect(err.reason).toBe("redirect-refused");
  });

  it("findOutboundBlock walks the cause chain", () => {
    const inner = new OutboundFetchBlockedError("private-address", "http://x/");
    const wrapped = new TypeError("fetch failed", {
      cause: new Error("connect", { cause: inner }),
    });
    expect(findOutboundBlock(wrapped)).toBe(inner);
    expect(findOutboundBlock(new Error("other"))).toBeNull();
    // Rebuilt by a realm crossing: only String(err) survives.
    const rebuilt = new Error(String(inner));
    expect(
      findOutboundBlock(new TypeError("x", { cause: rebuilt }))?.reason
    ).toBe("private-address");
    expect(
      findOutboundBlock(new Error("OutboundFetchBlockedError: x [made-up]"))
    ).toBeNull();
    expect(findOutboundBlock("nope")).toBeNull();
  });

  it("returns a 3xx without a Location as-is", async () => {
    a.handle((_req, res) => {
      res.writeHead(304);
      res.end();
    });
    const res = await guardedFetch(urlA("/"), {}, { redirects: "refuse" });
    expect(res.status).toBe(304);
  });
});
