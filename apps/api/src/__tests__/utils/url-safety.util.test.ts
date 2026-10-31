import { describe, it, expect, afterEach, jest } from "@jest/globals";

import { environment } from "../../environment.js";
import { validateToolpackUrl } from "../../utils/url-safety.util.js";

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
