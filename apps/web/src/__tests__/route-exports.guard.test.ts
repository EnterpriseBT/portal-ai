/**
 * A route file exports only its `Route` (#1109).
 *
 * TanStack Router's plugin moves a route's `component` into a lazy chunk, but
 * it can't move anything the file also exports: an exported component, or
 * one the component renders, stays in the main bundle with every view it
 * imports. Dashboard, Settings, Not-invited and the invitation accept page all
 * shipped that way. Type-only exports (`__root.tsx`'s `RouterContext`) emit no
 * code, so they're allowed. A test that needs a route's component renders
 * `Route.options.component`.
 */

import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { blankLiterals, sourceFiles } from "./guard-source.util";

const here = dirname(fileURLToPath(import.meta.url));
const routesDir = join(here, "..", "routes");

/** `export` lines other than `export const Route` and type-only ones. */
function strayExports(source: string): string[] {
  return blankLiterals(source)
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        /^export\b/.test(line) &&
        !/^export\s+(const\s+Route\b|type\b|interface\b)/.test(line)
    );
}

describe("route files export only Route (#1109)", () => {
  it("flags a component export and allows Route and type-only exports", () => {
    expect(
      strayExports(
        [
          'export const Route = createFileRoute("/")({ component: Page });',
          "export interface RouterContext { queryClient: unknown }",
          "export type Search = { tab?: string };",
          "export function Page() { return null; }",
          "export const helper = 1;",
          "export default Page;",
          "export { Page as Other };",
          'const s = "export function NotReal() {}";',
        ].join("\n")
      )
    ).toEqual([
      "export function Page() { return null; }",
      "export const helper = 1;",
      "export default Page;",
      "export { Page as Other };",
    ]);
  });

  it("holds for every file under src/routes", () => {
    const offenders = sourceFiles(routesDir)
      .filter((file) => !file.endsWith("routeTree.gen.ts"))
      .flatMap((file) =>
        strayExports(readFileSync(file, "utf8")).map(
          (line) => `${relative(routesDir, file)}: ${line}`
        )
      );
    expect(offenders).toEqual([]);
  });
});
