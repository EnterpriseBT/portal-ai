import { validateToolpackUrl } from "../../utils/toolpack-url-safety.util";

describe("toolpack-url-safety.util validateToolpackUrl", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  // Case 143 (core mirror)
  it("accepts a public https URL", () => {
    process.env.NODE_ENV = "production";
    expect(validateToolpackUrl("https://example.com/x")).toBeNull();
  });

  // Case 144 (core mirror)
  it("rejects non-http(s) schemes with TOOLPACK_URL_INVALID", () => {
    process.env.NODE_ENV = "production";
    expect(validateToolpackUrl("ftp://example.com")?.code).toBe(
      "TOOLPACK_URL_INVALID"
    );
  });

  // Case 145 (core mirror)
  it("gates http by NODE_ENV with a localhost escape hatch", () => {
    // In production, the HTTPS-only check fires before the
    // private-host check, so http://localhost surfaces as
    // NOT_HTTPS. Either is a correct rejection; the test pins
    // the actual ordering.
    process.env.NODE_ENV = "production";
    expect(validateToolpackUrl("http://example.com")?.code).toBe(
      "TOOLPACK_URL_NOT_HTTPS"
    );
    expect(validateToolpackUrl("http://localhost:4100")?.code).toBe(
      "TOOLPACK_URL_NOT_HTTPS"
    );
    expect(validateToolpackUrl("https://localhost:4100")?.code).toBe(
      "TOOLPACK_URL_PRIVATE_HOST"
    );

    process.env.NODE_ENV = "development";
    expect(validateToolpackUrl("http://localhost:4100")).toBeNull();
    expect(validateToolpackUrl("http://example.com")?.code).toBe(
      "TOOLPACK_URL_NOT_HTTPS"
    );
  });

  // Case 146 (core mirror)
  it("rejects raw IPv4 literals in private ranges", () => {
    process.env.NODE_ENV = "production";
    expect(validateToolpackUrl("https://10.0.0.5/x")?.code).toBe(
      "TOOLPACK_URL_PRIVATE_HOST"
    );
    expect(validateToolpackUrl("https://192.168.1.1/x")?.code).toBe(
      "TOOLPACK_URL_PRIVATE_HOST"
    );
  });

  // Case 147 (core mirror)
  it("rejects the cloud-metadata link-local IP", () => {
    process.env.NODE_ENV = "production";
    expect(
      validateToolpackUrl("https://169.254.169.254/latest/meta-data/")?.code
    ).toBe("TOOLPACK_URL_PRIVATE_HOST");
  });

  // Regression: unset NODE_ENV is treated as development to match
  // apps/api/src/environment.ts's convention. Production deploys
  // explicitly set NODE_ENV=production via Docker / k8s; unset is
  // always a dev signal. Without this default, the dev workflow
  // (run mock-toolpack on localhost, register against it) would
  // fail at the contract refinement with TOOLPACK_INVALID_PAYLOAD.
  it("treats unset NODE_ENV as development (allows http://localhost)", () => {
    delete process.env.NODE_ENV;
    expect(validateToolpackUrl("http://localhost:4100/schema")).toBeNull();
    expect(validateToolpackUrl("https://example.com/x")).toBeNull();
  });
});
