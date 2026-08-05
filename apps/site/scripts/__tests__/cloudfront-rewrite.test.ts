/**
 * CloudFront directory-index rewrite (#311).
 *
 * The function lives in `infra/cloudformation/site.yml`, but it is tested
 * from here because what it has to agree with is a SITE decision: Astro's
 * `trailingSlash: "always"` + `build.format: "directory"` means every route
 * is `<route>/index.html` in S3. If someone changes the Astro config, this
 * suite is what tells them the edge no longer matches.
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

/** Pull the literal block scalar out of `FunctionCode: |`. */
function extractFunctionCode(): string {
  const yaml = fs.readFileSync(TEMPLATE, "utf8");
  const marker = "FunctionCode: |";
  const start = yaml.indexOf(marker);
  expect(start).toBeGreaterThan(-1);

  const lines = yaml
    .slice(start + marker.length)
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
  return body.join("\n");
}

type Handler = (event: { request: { uri: string } }) => { uri: string };

const handler: Handler = new Function(
  `${extractFunctionCode()}; return handler;`
)();

const rewrite = (uri: string) => handler({ request: { uri } }).uri;

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
