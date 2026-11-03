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
 * `<…logger|log>.<level>(…)` whose object argument has:
 * - any property `x instanceof Error ? x.message : …`, or
 * - an `err`/`error` property (shorthand included) whose value is a string
 *   built from the error: `e.message`, `(e as Error).message`, `String(e)`, a
 *   string or template literal, or a `const` in scope initialized to one of
 *   those (a precomputed `message`, as portal.service's stream logs were).
 * Write `{ err: error }` (or keep the call's existing key) instead. Code that
 * returns a message on purpose (a tool result, a job row, a response body)
 * isn't a logger call and isn't flagged.
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
  return ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isTypeAssertionExpression(e)
    ? unwrap(e.expression)
    : e;
}

const ERROR_KEYS = new Set(["err", "error"]);

/** The initializer of a `const`/`let` named `name` in a block enclosing `at`. */
function declaredValue(name: string, at: ts.Node): ts.Expression | undefined {
  for (let n: ts.Node | undefined = at.parent; n; n = n.parent) {
    if (!ts.isBlock(n) && !ts.isSourceFile(n)) continue;
    for (const stmt of n.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) {
          return d.initializer;
        }
      }
    }
  }
  return undefined;
}

/** A string derived from an error, rather than the error itself. */
function isErrorString(
  e: ts.Expression,
  sf: ts.SourceFile,
  resolve = true
): boolean {
  const x = unwrap(e);
  if (isMessageOfError(x, sf)) return true;
  if (ts.isPropertyAccessExpression(x) && x.name.text === "message") {
    return true;
  }
  if (
    ts.isCallExpression(x) &&
    ts.isIdentifier(x.expression) &&
    x.expression.text === "String"
  ) {
    return true;
  }
  if (
    ts.isStringLiteral(x) ||
    ts.isNoSubstitutionTemplateLiteral(x) ||
    ts.isTemplateExpression(x)
  ) {
    return true;
  }
  if (ts.isConditionalExpression(x)) {
    return (
      isErrorString(x.whenTrue, sf, resolve) ||
      isErrorString(x.whenFalse, sf, resolve)
    );
  }
  if (
    ts.isBinaryExpression(x) &&
    (x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      x.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return (
      isErrorString(x.left, sf, resolve) || isErrorString(x.right, sf, resolve)
    );
  }
  if (resolve && ts.isIdentifier(x)) {
    const init = declaredValue(x.text, x);
    return init !== undefined && isErrorString(init, sf, false);
  }
  return false;
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
          const key =
            (ts.isPropertyAssignment(prop) ||
              ts.isShorthandPropertyAssignment(prop)) &&
            ts.isIdentifier(prop.name)
              ? prop.name.text
              : "";
          const value = ts.isPropertyAssignment(prop)
            ? prop.initializer
            : ts.isShorthandPropertyAssignment(prop)
              ? prop.name
              : undefined;
          if (
            value &&
            (isMessageOfError(value, sf) ||
              (ERROR_KEYS.has(key) && isErrorString(value, sf)))
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
      `logger.warn({ err: (err as Error).message }, "m");`,
      `logger.warn({ error: e.message, kept }, "m");`,
      `log.error({ error: String(e) }, "m");`,
      `function f(err) { const message = err instanceof Error ? err.message : "x"; logger.error({ error: message }, "m"); }`,
      `function g(e) { const error = String(e); logger.error({ error }, "m"); }`,
      `logger.error({ err: e }, "m");`,
      `logger.error({ error }, "m");`,
      `logger.info({ id, message: e.message }, "m");`,
      `function h(e) { const message = e.message; sse.sendError(message); logger.error({ error: e }, "m"); }`,
      `return { error: e instanceof Error ? e.message : "x" };`,
      `res.json({ error: e instanceof Error ? e.message : "x" });`,
    ].join("\n");
    expect(messageLogs("sample.ts", sample)).toEqual([
      "sample.ts:1",
      "sample.ts:2",
      "sample.ts:3",
      "sample.ts:4",
      "sample.ts:5",
      "sample.ts:6",
      "sample.ts:7",
      "sample.ts:8",
    ]);
  });

  it("no logger call in the API source logs an error's message", () => {
    const hits = sourceFiles(apiSrc).flatMap((path) =>
      messageLogs(relative(apiSrc, path), readFileSync(path, "utf8"))
    );
    expect(hits).toEqual([]);
  });
});
