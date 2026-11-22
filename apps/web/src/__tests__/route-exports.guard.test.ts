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

import ts from "typescript";

import { sourceFiles } from "./guard-source.util";

const here = dirname(fileURLToPath(import.meta.url));
const routesDir = join(here, "..", "routes");

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword
  );

/**
 * Every export but a lone `export const Route = …` and type-only ones, as
 * source text. Parsed rather than matched by line (code review): a second
 * declarator on the `Route` statement (`export const Route = …, Page = …`)
 * exports a component too.
 */
function strayExports(source: string): string[] {
  const file = ts.createSourceFile(
    "route.tsx",
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX
  );
  return file.statements
    .filter((node) => {
      if (ts.isExportDeclaration(node)) return !node.isTypeOnly;
      if (ts.isExportAssignment(node)) return true;
      if (!isExported(node)) return false;
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        return false;
      }
      if (ts.isVariableStatement(node)) {
        const [only, ...rest] = node.declarationList.declarations;
        return !(
          rest.length === 0 &&
          only !== undefined &&
          ts.isIdentifier(only.name) &&
          only.name.text === "Route"
        );
      }
      return true;
    })
    .map((node) => node.getText(file).split("\n")[0]!);
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
          "export type { Search as S };",
          'const s = "export function NotReal() {}";',
          'export const Route2 = createFileRoute("/y")({}), Extra = 1;',
        ].join("\n")
      )
    ).toEqual([
      "export function Page() { return null; }",
      "export const helper = 1;",
      "export default Page;",
      "export { Page as Other };",
      'export const Route2 = createFileRoute("/y")({}), Extra = 1;',
    ]);
  });

  it("flags a second declarator on the Route statement", () => {
    expect(
      strayExports(
        'export const Route = createFileRoute("/x")({ component: Page }), Page = () => null;'
      )
    ).toHaveLength(1);
  });

  it("holds for every file under src/routes", () => {
    const offenders = sourceFiles(routesDir).flatMap((file) =>
      strayExports(readFileSync(file, "utf8")).map(
        (line) => `${relative(routesDir, file)}: ${line}`
      )
    );
    expect(offenders).toEqual([]);
  });
});
