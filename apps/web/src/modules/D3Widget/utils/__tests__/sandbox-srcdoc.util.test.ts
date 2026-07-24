import {
  SANDBOX_CSP,
  SANDBOX_SRCDOC,
  buildSandboxSrcdoc,
} from "../sandbox-srcdoc.util";

const FIXTURE = {
  d3Source: "window.d3 = { fixture: true };",
  bootstrapSource: "/* bootstrap fixture */",
};

describe("SANDBOX_CSP", () => {
  it("pins the no-egress policy exactly (spec Key decision 1)", () => {
    // 'unsafe-eval' is required: the bootstrap compiles the agent program
    // via new Function(). Egress stays closed — eval permission does not
    // open any network channel; containment is the opaque origin +
    // default-src 'none'.
    expect(SANDBOX_CSP).toBe(
      "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'"
    );
  });
});

describe("buildSandboxSrcdoc", () => {
  it("emits a doctype'd document with the CSP meta and both sources in order", () => {
    const doc = buildSandboxSrcdoc(FIXTURE);
    expect(doc).toMatch(/^<!doctype html>/i);
    expect(doc).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`
    );
    expect(doc).toContain('<div id="root">');
    const d3At = doc.indexOf(FIXTURE.d3Source);
    const bootstrapAt = doc.indexOf(FIXTURE.bootstrapSource);
    expect(d3At).toBeGreaterThan(-1);
    expect(bootstrapAt).toBeGreaterThan(d3At);
  });

  it("references no external URL (no http:// or https:// anywhere)", () => {
    const doc = buildSandboxSrcdoc(FIXTURE);
    expect(doc).not.toContain("http://");
    expect(doc).not.toContain("https://");
  });

  it("escapes </script> sequences inside embedded sources", () => {
    const doc = buildSandboxSrcdoc({
      ...FIXTURE,
      d3Source: 'var s = "</script>";',
    });
    // Only the document's own two closing tags survive; the embedded one
    // is escaped so it can't terminate the inline script early.
    expect(doc.split("</script>")).toHaveLength(3);
    expect(doc).toContain("<\\/script>");
  });
});

describe("SANDBOX_SRCDOC", () => {
  it("is a prebuilt document carrying the CSP", () => {
    expect(typeof SANDBOX_SRCDOC).toBe("string");
    expect(SANDBOX_SRCDOC).toContain(SANDBOX_CSP);
  });
});
