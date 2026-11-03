/**
 * #948: a logger call passes the error object, not its message.
 *
 * The logger's `err`/`error` serializer (`sanitizeError`, logger.util.ts) keeps
 * an `Error`'s message and stack, redacting a DB error's SQL and bound values
 * (#540). A non-`Error` value becomes `{ type }`, since a bare string may carry
 * customer data. So `{ error: error instanceof Error ? error.message : … }`
 * logs `{"type":"string"}` and loses the failure: that is how #946's sign-in
 * 500s logged nothing a reader could act on.
 *
 * Scans the API source with the TypeScript AST for a call to
 * `<…logger|log>.<level>(…)` whose object argument has a property
 * `x instanceof Error ? x.message : …`. Write `{ err: error }` (or keep the
 * call's existing key) instead. Code that returns a message on purpose (a tool
 * result, a job row, a response body) isn't a logger call and isn't flagged.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

const apiSrc = join(dirname(fileURLToPath(import.meta.url)), "..");

const LEVELS = new Set(["fatal", "error", "warn", "info", "debug", "trace"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : sourceFiles(path);
    }
    return /\.ts$/.test(name) && !/\.d\.ts$/.test(name) ? [path] : [];
  });
}

function unwrap(e: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(e) ? unwrap(e.expression) : e;
}

/** `x instanceof Error ? x.message : …` */
function isMessageOfError(e: ts.Expression, sf: ts.SourceFile): boolean {
  const c = unwrap(e);
  if (!ts.isConditionalExpression(c)) return false;
  const cond = unwrap(c.condition);
  if (
    !ts.isBinaryExpression(cond) ||
    cond.operatorToken.kind !== ts.SyntaxKind.InstanceOfKeyword ||
    cond.right.getText(sf) !== "Error"
  ) {
    return false;
  }
  const whenTrue = unwrap(c.whenTrue);
  return (
    ts.isPropertyAccessExpression(whenTrue) &&
    whenTrue.name.text === "message" &&
    whenTrue.expression.getText(sf) === cond.left.getText(sf)
  );
}

function isLoggerCall(call: ts.CallExpression): boolean {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (!LEVELS.has(callee.name.text)) return false;
  const receiver = callee.expression;
  const name = ts.isPropertyAccessExpression(receiver)
    ? receiver.name.text
    : ts.isIdentifier(receiver)
      ? receiver.text
      : "";
  return /(^log$|logger$)/i.test(name);
}

/** `file:line` of every logger call that logs an error's message. */
function messageLogs(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && isLoggerCall(node)) {
      for (const arg of node.arguments) {
        if (!ts.isObjectLiteralExpression(arg)) continue;
        for (const prop of arg.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            isMessageOfError(prop.initializer, sf)
          ) {
            const { line } = sf.getLineAndCharacterOfPosition(prop.getStart());
            hits.push(`${file}:${line + 1}`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe("logger calls pass the error object (#948)", () => {
  it("flags a message-of-error property, and nothing else", () => {
    const sample = [
      `logger.error({ error: e instanceof Error ? e.message : "x" }, "m");`,
      `req.log.warn({ err: (err instanceof Error ? err.message : err) }, "m");`,
      `this.logger.info({ id, error: e instanceof Error ? e.message : String(e) });`,
      `logger.error({ err: e }, "m");`,
      `return { error: e instanceof Error ? e.message : "x" };`,
      `res.json({ error: e instanceof Error ? e.message : "x" });`,
    ].join("\n");
    expect(messageLogs("sample.ts", sample)).toEqual([
      "sample.ts:1",
      "sample.ts:2",
      "sample.ts:3",
    ]);
  });

  it("no logger call in the API source logs an error's message", () => {
    const hits = sourceFiles(apiSrc).flatMap((path) =>
      messageLogs(relative(apiSrc, path), readFileSync(path, "utf8"))
    );
    expect(hits).toEqual([]);
  });
});
