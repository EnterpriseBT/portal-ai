/**
 * CloudFront viewer-request function (#311, #404).
 *
 * The function lives in `infra/cloudformation/site.yml`, but it is tested
 * from here because what it has to agree with is a SITE decision: Astro's
 * `trailingSlash: "always"` + `build.format: "directory"` means every route
 * is `<route>/index.html` in S3. If someone changes the Astro config, this
 * suite is what tells them the edge no longer matches.
 *
 * It carries TWO responsibilities, and that is forced rather than chosen:
 * CloudFront permits one function per event type per cache behavior, so the
 * apex redirect (#404) shares this function with the index rewrite. Both are
 * covered here; `deploy-parity.test.ts` pins the STACK WIRING that decides
 * whether an environment has an apex at all.
 *
 * There is no other feedback loop — the function only runs on real
 * CloudFront, where a mistake is a site-wide 404 discovered by visitors.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "@jest/globals";

const TEMPLATE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../infra/cloudformation/site.yml"
);

/** The canonical host, standing in for CFN's `${Subdomain}.${DomainName}`. */
const CANONICAL = "www.portalsai.io";
/** The bare domain, which prod also answers on and must redirect away. */
const APEX = "portalsai.io";

/** Pull the literal block scalar out of `FunctionCode:`. */
function extractFunctionCode(): string {
  const yaml = fs.readFileSync(TEMPLATE, "utf8");
  // Matches both `FunctionCode: |` and `FunctionCode: !Sub |`. The template
  // gained the !Sub when the function started interpolating the canonical
  // host, and a hard-coded marker silently stops finding the function —
  // which fails this whole suite at load rather than at an assertion.
  const marker = /^[ \t]*FunctionCode:.*\|[ \t]*$/m.exec(yaml);
  expect(marker).not.toBeNull();

  const lines = yaml
    .slice(marker!.index + marker![0].length)
    .split("\n")
    .slice(1);
  const indent = lines[0].match(/^\s*/)![0].length;
  const body: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if (line.match(/^\s*/)![0].length < indent) break;
    body.push(line.slice(indent));
  }
  // Resolve the !Sub the way CloudFormation resolves it for prod.
  return body
    .join("\n")
    .replace(/\$\{Subdomain\}\.\$\{DomainName\}/g, CANONICAL);
}

type QueryEntry = { value: string; multiValue?: Array<{ value: string }> };
type EdgeRequest = {
  uri: string;
  querystring: Record<string, QueryEntry>;
  headers: { host?: { value: string } };
};
type EdgeResult = {
  uri?: string;
  statusCode?: number;
  headers?: { location: { value: string } };
};
type Handler = (event: { request: EdgeRequest }) => EdgeResult;

const handler: Handler = new Function(
  `${extractFunctionCode()}; return handler;`
)();

const invoke = (
  host: string,
  uri: string,
  query: Record<string, string[]> = {}
): EdgeResult => {
  const querystring: Record<string, QueryEntry> = {};
  for (const [key, values] of Object.entries(query)) {
    querystring[key] =
      values.length > 1
        ? { value: values[0], multiValue: values.map((v) => ({ value: v })) }
        : { value: values[0] };
  }
  return handler({
    request: { uri, querystring, headers: { host: { value: host } } },
  });
};

/** The rewrite path: arrives on the canonical host, so no redirect. */
const rewrite = (uri: string): string | undefined => {
  const result = invoke(CANONICAL, uri);
  expect(result.statusCode).toBeUndefined();
  return result.uri;
};

/** The redirect path: arrives on the apex, so never reaches an origin. */
const redirect = (
  uri: string,
  query: Record<string, string[]> = {}
): string => {
  const result = invoke(APEX, uri, query);
  expect(result.statusCode).toBe(301);
  return result.headers!.location.value;
};

describe("SiteIndexRewrite", () => {
  it.each([
    ["/", "/index.html"],
    ["/features/", "/features/index.html"],
    ["/pricing/", "/pricing/index.html"],
    ["/use-cases/analysts/", "/use-cases/analysts/index.html"],
  ])("maps the directory URI %s to %s", (input, expected) => {
    expect(rewrite(input)).toBe(expected);
  });

  it.each([
    ["/features", "/features/index.html"],
    ["/use-cases/analysts", "/use-cases/analysts/index.html"],
  ])(
    "maps the slashless URI %s to %s without a redirect",
    (input, expected) => {
      // Rewriting rather than 301-ing keeps one canonical URL per page.
      expect(rewrite(input)).toBe(expected);
    }
  );

  it.each([
    "/robots.txt",
    "/llms.txt",
    "/sitemap-index.xml",
    "/sitemap-0.xml",
    "/og-default.png",
    "/_astro/index.abc123.css",
    "/404.html",
  ])("leaves the file URI %s untouched", (input) => {
    expect(rewrite(input)).toBe(input);
  });

  it("sends an unknown route to an object that will 404", () => {
    // S3 misses, CloudFront maps 403/404 → /404.html at status 404.
    expect(rewrite("/nope/")).toBe("/nope/index.html");
    expect(rewrite("/nope")).toBe("/nope/index.html");
  });
});

describe("apex canonicalization (#404)", () => {
  it("301s the bare domain to the canonical host", () => {
    expect(redirect("/")).toBe("https://www.portalsai.io/");
  });

  it("preserves the path", () => {
    expect(redirect("/pricing/")).toBe("https://www.portalsai.io/pricing/");
  });

  it("preserves every repeated query parameter", () => {
    // `querystring` is a map: a repeated key keeps its first value in
    // `.value` and all of them in `.multiValue`, so reading only `.value`
    // would silently drop duplicates and mangle campaign links.
    expect(redirect("/pricing/", { x: ["1", "2"], y: ["3"] })).toBe(
      "https://www.portalsai.io/pricing/?x=1&x=2&y=3"
    );
  });

  it("keeps a valueless flag parameter as a bare key", () => {
    expect(redirect("/", { debug: [""] })).toBe(
      "https://www.portalsai.io/?debug"
    );
  });

  it.each([
    ["/index.html", "https://www.portalsai.io/"],
    ["/pricing/index.html", "https://www.portalsai.io/pricing/"],
  ])("normalizes %s out of the Location header", (uri, expected) => {
    // Whether DefaultRootObject substitutes before this function runs is not
    // worth betting the canonical URL on, so the redirect normalizes either
    // way. Without this the apex 301s to a URL no page links to.
    expect(redirect(uri)).toBe(expected);
  });

  it("redirects before rewriting — the order inside the function", () => {
    // A URI rewritten first would land in Location as /pricing/index.html.
    // This passes only because the host check comes first.
    expect(redirect("/pricing")).toBe("https://www.portalsai.io/pricing");
  });

  it("redirects an asset request rather than serving it twice", () => {
    // Same content on two hosts is the duplicate-content case #404 avoids.
    expect(redirect("/styles.css")).toBe("https://www.portalsai.io/styles.css");
  });

  it("serves, never redirects, a request already on the canonical host", () => {
    // Guards the inverse mistake: a redirect that fires on every request is
    // an infinite loop, and dev (which has no apex) must be unaffected.
    const result = invoke(CANONICAL, "/pricing/");
    expect(result.statusCode).toBeUndefined();
    expect(result.uri).toBe("/pricing/index.html");
  });
});

describe("site.yml error responses", () => {
  const yaml = fs.readFileSync(TEMPLATE, "utf8");

  it("returns a real 404 status, never a soft 200", () => {
    // A soft 200 would get every mistyped URL indexed as a valid page —
    // the one behaviour this template must NOT share with frontend.yml's
    // SPA rewrite.
    expect(yaml).not.toMatch(/ResponseCode:\s*200/);
    const codes = [...yaml.matchAll(/ResponseCode:\s*(\d+)/g)].map(
      ([, code]) => code
    );
    expect(codes).toEqual(["404", "404"]);
    expect(yaml).toContain("ResponsePagePath: /404.html");
  });

  it("discriminates account-global resource names from frontend.yml's", () => {
    // OAC and response-headers-policy names are account-global; a collision
    // fails the stack deploy with an opaque error.
    expect(yaml).toContain("portalai-${Environment}-site-oac");
    expect(yaml).toContain("portalai-${Environment}-site-headers");
  });
});
