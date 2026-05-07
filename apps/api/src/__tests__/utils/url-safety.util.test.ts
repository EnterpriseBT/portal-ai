import { describe, it, expect, afterEach, jest } from "@jest/globals";

import { environment } from "../../environment.js";
import {
  validateToolpackUrl,
  assertUrlSafeToFetch,
  SsrfBlockedError,
} from "../../utils/url-safety.util.js";

describe("url-safety.util validateToolpackUrl", () => {
  let restore: (() => void) | null = null;

  function setNodeEnv(value: "production" | "development"): void {
    const replaced = jest.replaceProperty(environment, "NODE_ENV", value);
    restore = () => replaced.restore();
  }

  afterEach(() => {
    restore?.();
    restore = null;
  });

  // Case 143
  it("accepts a public https URL (returns null)", () => {
    setNodeEnv("production");
    expect(validateToolpackUrl("https://example.com/x")).toBeNull();
  });

  // Case 144
  it("rejects non-http(s) schemes with TOOLPACK_URL_INVALID", () => {
    setNodeEnv("production");
    const err = validateToolpackUrl("ftp://example.com");
    expect(err?.code).toBe("TOOLPACK_URL_INVALID");
  });

  // Case 145
  it("gates http URLs by NODE_ENV + localhost escape hatch", () => {
    // Production: http rejected outright. The HTTPS-only check
    // fires before the private-host check, so http://localhost
    // surfaces as NOT_HTTPS rather than PRIVATE_HOST — either is a
    // correct rejection; the test pins the actual ordering.
    setNodeEnv("production");
    expect(validateToolpackUrl("http://example.com")?.code).toBe(
      "TOOLPACK_URL_NOT_HTTPS"
    );
    expect(validateToolpackUrl("http://localhost:4100")?.code).toBe(
      "TOOLPACK_URL_NOT_HTTPS"
    );
    expect(validateToolpackUrl("https://localhost:4100")?.code).toBe(
      "TOOLPACK_URL_PRIVATE_HOST"
    );
    restore?.();

    // Non-production: http://localhost allowed; http://example.com still rejected.
    setNodeEnv("development");
    expect(validateToolpackUrl("http://localhost:4100")).toBeNull();
    expect(validateToolpackUrl("http://example.com")?.code).toBe(
      "TOOLPACK_URL_NOT_HTTPS"
    );
  });

  // Case 146
  it("rejects raw IPv4 literals in private ranges", () => {
    setNodeEnv("production");
    expect(validateToolpackUrl("https://10.0.0.5/x")?.code).toBe(
      "TOOLPACK_URL_PRIVATE_HOST"
    );
    expect(validateToolpackUrl("https://192.168.1.1/x")?.code).toBe(
      "TOOLPACK_URL_PRIVATE_HOST"
    );
    expect(validateToolpackUrl("https://172.16.0.1/x")?.code).toBe(
      "TOOLPACK_URL_PRIVATE_HOST"
    );
  });

  // Case 147
  it("rejects the cloud-metadata link-local IP", () => {
    setNodeEnv("production");
    expect(
      validateToolpackUrl("https://169.254.169.254/latest/meta-data/")?.code
    ).toBe("TOOLPACK_URL_PRIVATE_HOST");
  });
});

describe("url-safety.util assertUrlSafeToFetch", () => {
  let restore: (() => void) | null = null;

  function setNodeEnv(value: "production" | "development"): void {
    const replaced = jest.replaceProperty(environment, "NODE_ENV", value);
    restore = () => replaced.restore();
  }

  afterEach(() => {
    restore?.();
    restore = null;
  });

  // Case 161 — non-production loopback escape hatch.
  // Without this, the dev workflow (run mock-toolpack on localhost,
  // register against it from the dev API) fails at runtime SSRF
  // because 127.0.0.1 is loopback, not unicast.
  it("allows loopback in non-production", async () => {
    setNodeEnv("development");
    await expect(
      assertUrlSafeToFetch("http://127.0.0.1:4100/schema")
    ).resolves.toBeUndefined();
    await expect(
      assertUrlSafeToFetch("http://localhost:4100/schema")
    ).resolves.toBeUndefined();
  });

  // Case 162 — production still blocks loopback.
  it("blocks loopback in production", async () => {
    setNodeEnv("production");
    await expect(
      assertUrlSafeToFetch("http://127.0.0.1:4100/schema")
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(
      assertUrlSafeToFetch("http://localhost:4100/schema")
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  // Case 163 — RFC1918 still blocked even in non-production.
  // Loopback is the *only* range the dev escape hatch unblocks.
  it("blocks RFC1918 even in non-production", async () => {
    setNodeEnv("development");
    await expect(
      assertUrlSafeToFetch("http://10.0.0.5/schema")
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(
      assertUrlSafeToFetch("http://192.168.1.1/schema")
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(
      assertUrlSafeToFetch("http://169.254.169.254/")
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});
