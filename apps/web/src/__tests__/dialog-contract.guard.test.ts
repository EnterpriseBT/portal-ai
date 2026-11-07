/**
 * Convention guard (#789): every dialog meets the `Modal` contract.
 *
 * `Modal` declares a form with `onSubmit`, and its props type makes
 * `submitDisabled` and `pending` required alongside it, so tsc already
 * fails a form dialog that leaves either out. What the type can't see is a
 * dialog that submits but never declared it: #758's Rename Portal had no
 * form at all, so Enter did nothing. This guard parses each file and checks
 * every `<Modal>` element on its own (the #758 guard counted regex matches
 * per file, which a second Modal or a comment could fool).
 *
 * Rules:
 * - R1: a `<Modal>` that renders `<FormAlert>` (the Form & Dialog Pattern's
 *   marker for a dialog that triggers a mutation) has `onSubmit`, unless its
 *   file is in EXEMPT with a reason.
 * - R2: no `<Modal>` passes `slotProps` with a `component`. The old way to
 *   make a form (`slotProps.paper.component = "form"`) is gone; `onSubmit`
 *   is the only one.
 * - R3: nothing in apps/web imports MUI's raw `Dialog`. Every dialog is a
 *   `Modal`, so every dialog gets the contract above; a raw Dialog was
 *   invisible to it (PinnedResultDetail's rename submitted on Enter while
 *   its Save was disabled).
 * - R4: a file that shows a mutation's error in a dialog
 *   (`serverError={toServerError(X.error)}`, or a `…ServerError` prop
 *   handed down to one) also calls `X.reset()`, so a
 *   reopened dialog doesn't greet a fresh attempt with the last one's error.
 *   The reset belongs where the dialog opens; this checks it exists.
 * - R5: no test calls `fireEvent.submit`. It dispatches a submit event
 *   directly, skipping Enter, implicit submission and the disabled default
 *   button, so it passed even when Enter did nothing (#758). Tests press a
 *   real Enter instead (`pressEnter` in test-utils, or user-event).
 * - R6: every component that renders a `Modal` has a test file of its own
 *   (`<Name>.test.tsx`, or `.component.test.tsx` / `.view.test.tsx`), and
 *   that file runs the shared axe assertion (`expectNoAxeViolations`) on
 *   the open dialog (#793). A dialog with no test of its own is a gap too.
 * - R7: no `Button` or `IconButton` in a dialog's file is `disabled` by the
 *   flag its `Modal` passes as `pending` (#793). A natively disabled button
 *   drops focus to the page the moment the request starts. It renders
 *   through `GatedButton` with `gate={pendingGate(pending)}` instead, which
 *   stays focusable and reads as unavailable with "Saving…".
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = join(here, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" || name === "stories"
        ? []
        : sourceFiles(path);
    }
    return path.endsWith(".tsx") ? [path] : [];
  });
}

// A Modal that renders a FormAlert but submits nothing. Each entry says why;
// a new entry needs a reason as good.
const EXEMPT: Record<string, string> = {
  "components/EndpointTestDialog.component.tsx":
    "result viewer: the test request fires on open and Close is its only action",
};

interface ModalFinding {
  line: number;
  rendersFormAlert: boolean;
  hasOnSubmit: boolean;
  slotPropsComponent: boolean;
}

const tagName = (node: ts.JsxOpeningLikeElement): string =>
  node.tagName.getText();

/** True when `node`'s subtree contains a `<FormAlert>` element. */
function containsFormAlert(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (
      (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
      tagName(n) === "FormAlert"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Every `<Modal>` in `source`, with what the rules need to know. */
export function findModals(source: string): ModalFinding[] {
  const file = ts.createSourceFile(
    "dialog.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const findings: ModalFinding[] = [];
  const visit = (node: ts.Node) => {
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    if (opening && tagName(opening) === "Modal") {
      const attrs = opening.attributes.properties;
      const named = (name: string) =>
        attrs.find(
          (a): a is ts.JsxAttribute =>
            ts.isJsxAttribute(a) && a.name.getText() === name
        );
      const slotProps = named("slotProps");
      findings.push({
        line: file.getLineAndCharacterOfPosition(opening.getStart()).line + 1,
        // The element's children and its attributes (FormAlert can sit in
        // `actions` or a render prop) are both the dialog's content.
        rendersFormAlert: containsFormAlert(node),
        hasOnSubmit: named("onSubmit") !== undefined,
        slotPropsComponent:
          slotProps?.initializer !== undefined &&
          /\bcomponent\s*:/.test(slotProps.initializer.getText()),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

/** R3: an import of MUI's raw Dialog (default or named). */
export function importsRawDialog(source: string): boolean {
  const file = ts.createSourceFile(
    "file.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  return file.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement)) return false;
    const from = (statement.moduleSpecifier as ts.StringLiteral).text;
    if (from === "@mui/material/Dialog") return true;
    if (from !== "@mui/material") return false;
    const bindings = statement.importClause?.namedBindings;
    return (
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some(
        (el) => (el.propertyName ?? el.name).text === "Dialog"
      )
    );
  });
}

/** The names a Modal's `pending` reads (`isPending`, `mutation.isPending`). */
function pendingNames(source: string): string[] {
  const file = ts.createSourceFile(
    "dialog.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      tagName(node) === "Modal"
    ) {
      for (const a of node.attributes.properties) {
        if (
          ts.isJsxAttribute(a) &&
          a.name.getText() === "pending" &&
          a.initializer &&
          ts.isJsxExpression(a.initializer) &&
          a.initializer.expression
        ) {
          for (const m of a.initializer.expression
            .getText()
            .matchAll(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g)) {
            if (!["true", "false", "undefined", "null"].includes(m[0]))
              names.add(m[0]);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...names];
}

/** R7: lines of `Button`/`IconButton`s whose `disabled` reads `pending`. */
export function disabledReadsPending(source: string): number[] {
  const names = pendingNames(source);
  if (names.length === 0) return [];
  const reads = (text: string) =>
    names.some((n) =>
      new RegExp(`(^|[^\\w$.])${n.replace(/[.$]/g, "\\$&")}(?![\\w$])`).test(
        text
      )
    );
  const file = ts.createSourceFile(
    "dialog.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const lines: number[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ["Button", "IconButton"].includes(tagName(node))
    ) {
      const disabled = node.attributes.properties.find(
        (a): a is ts.JsxAttribute =>
          ts.isJsxAttribute(a) && a.name.getText() === "disabled"
      );
      if (disabled?.initializer && reads(disabled.initializer.getText())) {
        lines.push(
          file.getLineAndCharacterOfPosition(node.getStart()).line + 1
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return lines;
}

/** R6: whether a test source runs the shared axe assertion. */
export function runsAxe(source: string): boolean {
  return /\bexpectNoAxeViolations\(/.test(withoutComments(source));
}

/** R6: the test files named for a component file. */
function pairedTests(componentPath: string, tests: string[]): string[] {
  const name = componentPath
    .split("/")
    .pop()!
    .replace(/\.tsx$/, "")
    .replace(/\.(component|view|layout)$/, "");
  return tests.filter((t) =>
    [
      `${name}.test.tsx`,
      `${name}.component.test.tsx`,
      `${name}.view.test.tsx`,
    ].includes(t.split("/").pop()!)
  );
}

// R6's allowlist. Empty; it only shrinks.
const AXE_EXEMPT: Record<string, string> = {};

// R7's allowlist. Empty; it only shrinks.
const PENDING_DISABLED_EXEMPT: Record<string, string> = {};

/** R4: mutations whose error a dialog shows but the file never resets. */
export function unresetDialogErrors(source: string): string[] {
  const shown = new Set(
    [
      ...source.matchAll(
        /[sS]erverError=\{\s*toServerError\(\s*([A-Za-z_][\w.]*?)\.error\s*\)\s*\}/g
      ),
    ].map((m) => m[1])
  );
  return [...shown].filter(
    (name) =>
      !new RegExp(`\\b${name.replace(/\./g, "\\.")}\\.reset\\(`).test(source)
  );
}

// R5's only exception. Each entry says why a synthetic submit is the point.
const SYNTHETIC_SUBMIT_ALLOWED: Record<string, string> = {
  "__tests__/dialog-single-flight.integration.test.tsx":
    "reproduces two activations in one tick (#751's render-lag race); a real key press yields between events, and the file's real-Enter cases are separate",
};

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return testFiles(path);
    return /\.test\.tsx?$/.test(path) ? [path] : [];
  });
}

// A block comment only counts where it opens a line or a JSX expression, so
// a string like "image/*" can't swallow the code up to the next `*/`.
const withoutComments = (source: string) =>
  source
    .replace(/(^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, "$1")
    .replace(/^\s*\/\/.*$/gm, "");

/** R5: a `fireEvent.submit(` call, ignoring comments. */
export function callsSyntheticSubmit(source: string): boolean {
  return /\bfireEvent\.submit\(/.test(withoutComments(source));
}

const violationsOf = (source: string) => {
  const modals = findModals(source);
  return {
    r1: modals.filter((m) => m.rendersFormAlert && !m.hasOnSubmit),
    r2: modals.filter((m) => m.slotPropsComponent),
  };
};

const files = sourceFiles(webSrc).map((path) => ({
  path: relative(webSrc, path),
  source: readFileSync(path, "utf8"),
}));
const withModals = files
  .map((f) => ({ ...f, modals: findModals(f.source) }))
  .filter((f) => f.modals.length > 0);

describe("the guard's own rules (fixtures)", () => {
  it("R1 flags a FormAlert Modal with no onSubmit, and passes one with it", () => {
    const bad = `<Modal open onClose={c}><FormAlert serverError={e} /></Modal>`;
    const good = `<Modal open onClose={c} onSubmit={s} submitDisabled={d} pending={p}><FormAlert serverError={e} /></Modal>`;
    expect(violationsOf(bad).r1).toHaveLength(1);
    expect(violationsOf(good).r1).toHaveLength(0);
  });

  it("R1 sees a FormAlert rendered inside the actions prop", () => {
    const src = `<Modal open onClose={c} actions={<FormAlert serverError={e} />} />`;
    expect(violationsOf(src).r1).toHaveLength(1);
  });

  it("R1 checks each Modal on its own, not per file", () => {
    const src = `<>
      <Modal open onClose={c} onSubmit={s} submitDisabled={d} pending={p}><FormAlert serverError={e} /></Modal>
      <Modal open onClose={c}><FormAlert serverError={e} /></Modal>
    </>`;
    expect(violationsOf(src).r1.map((m) => m.line)).toEqual([3]);
  });

  it("R1 isn't fooled by a comment or a string naming FormAlert", () => {
    const src = `// renders <FormAlert> on error
      const s = "<FormAlert />";
      <Modal open onClose={c}><p>viewer</p></Modal>`;
    expect(violationsOf(src).r1).toHaveLength(0);
  });

  it("R2 flags a Modal whose slotProps carry a component", () => {
    const bad = `<Modal open onClose={c} slotProps={{ paper: { component: "form" } as object }} />`;
    const good = `<Modal open onClose={c} slotProps={{ paper: { sx: { p: 1 } } }} />`;
    expect(violationsOf(bad).r2).toHaveLength(1);
    expect(violationsOf(good).r2).toHaveLength(0);
  });
});

describe("the guard's own rules (fixtures, R3)", () => {
  it("R3 flags a default or named import of MUI's Dialog, and nothing else", () => {
    expect(importsRawDialog(`import Dialog from "@mui/material/Dialog";`)).toBe(
      true
    );
    expect(
      importsRawDialog(`import { Box, Dialog } from "@mui/material";`)
    ).toBe(true);
    expect(
      importsRawDialog(`import { Dialog as D } from "@mui/material";`)
    ).toBe(true);
    expect(
      importsRawDialog(`import DialogTitle from "@mui/material/DialogTitle";`)
    ).toBe(false);
    expect(importsRawDialog(`import { Modal } from "@portalai/core/ui";`)).toBe(
      false
    );
  });
});

describe("the guard's own rules (fixtures, R4)", () => {
  it("R4 flags a shown mutation error with no reset, and passes one with it", () => {
    const bad = `<X serverError={toServerError(renameMutation.error)} />`;
    const good = `const open = () => { renameMutation.reset(); setOpen(true); };
      <X serverError={toServerError(renameMutation.error)} />`;
    expect(unresetDialogErrors(bad)).toEqual(["renameMutation"]);
    expect(unresetDialogErrors(good)).toEqual([]);
  });

  it("R4 sees an error handed down under a …ServerError prop", () => {
    const src = `<ViewUI createRecordServerError={toServerError(createRecordMutation.error)} />`;
    expect(unresetDialogErrors(src)).toEqual(["createRecordMutation"]);
  });

  it("R4 handles a dotted mutation and a reset of a different one", () => {
    const src = `serverError={toServerError(m.update.error)}
      other.reset();`;
    expect(unresetDialogErrors(src)).toEqual(["m.update"]);
  });
});

describe("the guard's own rules (fixtures, R5)", () => {
  it("R5 flags a synthetic submit and ignores one named in a comment", () => {
    expect(callsSyntheticSubmit(`fireEvent.submit(form);`)).toBe(true);
    expect(
      callsSyntheticSubmit(`// A real key press, not fireEvent.submit(form)`)
    ).toBe(false);
    expect(callsSyntheticSubmit(`await pressEnter(field);`)).toBe(false);
  });
});

describe("the guard's own rules (fixtures, R7)", () => {
  const dialog = (button: string) => `
    <Modal open onClose={c} title="T" pending={isPending}
      actions={${button}} />`;

  it("R7 flags a button disabled by the Modal's pending flag", () => {
    expect(
      disabledReadsPending(dialog(`<Button disabled={isPending}>Save</Button>`))
    ).toHaveLength(1);
    expect(
      disabledReadsPending(
        dialog(`<Button disabled={isPending || !name}>Save</Button>`)
      )
    ).toHaveLength(1);
    expect(
      disabledReadsPending(
        dialog(`<IconButton aria-label="x" disabled={isPending} />`)
      )
    ).toHaveLength(1);
  });

  it("R7 passes a gated button, and a disabled that doesn't read pending", () => {
    expect(
      disabledReadsPending(
        dialog(
          `<GatedButton gate={pendingGate(isPending)} disabled={!name}>Save</GatedButton>`
        )
      )
    ).toEqual([]);
    expect(
      disabledReadsPending(dialog(`<Button disabled={!name}>Save</Button>`))
    ).toEqual([]);
    expect(
      disabledReadsPending(
        dialog(`<Button disabled={isPendingDelete}>Save</Button>`)
      )
    ).toEqual([]);
  });

  it("R7 follows a dotted pending flag and a button outside the Modal", () => {
    const src = `
      const actions = <Button disabled={rename.isPending}>Save</Button>;
      <Modal open onClose={c} title="T" pending={rename.isPending} actions={actions} />`;
    expect(disabledReadsPending(src)).toHaveLength(1);
  });
});

describe("the guard's own rules (fixtures, R6)", () => {
  it("R6 sees the axe call, and not one named in a comment", () => {
    expect(
      runsAxe(`await expectNoAxeViolations(screen.getByRole("dialog"));`)
    ).toBe(true);
    expect(runsAxe(`// TODO: expectNoAxeViolations(dialog)`)).toBe(false);
    expect(runsAxe(`render(<X />);`)).toBe(false);
  });

  it("R6 pairs a component with its test by name", () => {
    const tests = [
      "__tests__/RenamePortalDialog.test.tsx",
      "__tests__/AdvancedFilterBuilder.component.test.tsx",
      "__tests__/RenamePortal.test.tsx",
    ];
    expect(
      pairedTests("components/RenamePortalDialog.component.tsx", tests)
    ).toEqual(["__tests__/RenamePortalDialog.test.tsx"]);
    expect(
      pairedTests("components/AdvancedFilterBuilder.component.tsx", tests)
    ).toEqual(["__tests__/AdvancedFilterBuilder.component.test.tsx"]);
  });
});

describe("dialogs meet the Modal contract (#789)", () => {
  it("finds the dialogs (so the guard can't pass vacuously)", () => {
    expect(withModals.length).toBeGreaterThanOrEqual(45);
    expect(
      withModals.filter((f) => f.modals.some((m) => m.rendersFormAlert)).length
    ).toBeGreaterThanOrEqual(40);
  });

  it("exempts only files that still exist and still match R1", () => {
    for (const path of Object.keys(EXEMPT)) {
      const file = withModals.find((f) => f.path === path);
      expect(file).toBeDefined();
      expect(violationsOf(file!.source).r1.length).toBeGreaterThan(0);
    }
  });

  it.each(withModals.map((f) => [f.path, f.source]))(
    "%s: a Modal that renders FormAlert declares onSubmit (R1)",
    (path, source) => {
      if (path in EXEMPT) return;
      expect(violationsOf(source).r1.map((m) => `line ${m.line}`)).toEqual([]);
    }
  );

  it.each(withModals.map((f) => [f.path, f.source]))(
    "%s: no Modal makes a form through slotProps (R2)",
    (_path, source) => {
      expect(violationsOf(source).r2.map((m) => `line ${m.line}`)).toEqual([]);
    }
  );

  // Every source file, not just those with a Modal: a raw Dialog is exactly
  // a dialog this guard couldn't otherwise see. The allowlist is empty.
  it.each(files.map((f) => [f.path, f.source]))(
    "%s: imports no raw MUI Dialog (R3)",
    (_path, source) => {
      expect(importsRawDialog(source)).toBe(false);
    }
  );

  it.each(
    files
      .filter((f) => /[sS]erverError=\{\s*toServerError\(/.test(f.source))
      .map((f) => [f.path, f.source])
  )(
    "%s: resets every mutation whose error a dialog shows (R4)",
    (_path, source) => {
      expect(unresetDialogErrors(source)).toEqual([]);
    }
  );

  it.each(withModals.map((f) => [f.path, f.source]))(
    "%s: no button is natively disabled by the dialog's pending flag (R7)",
    (path, source) => {
      if (path in PENDING_DISABLED_EXEMPT) return;
      expect(disabledReadsPending(source).map((l) => `line ${l}`)).toEqual([]);
    }
  );

  const allTests = testFiles(webSrc).map((path) => relative(webSrc, path));

  it("pairs enough dialogs with tests (so R6 can't pass vacuously)", () => {
    expect(
      withModals.filter((f) => pairedTests(f.path, allTests).length > 0).length
    ).toBeGreaterThanOrEqual(55);
  });

  it.each(withModals.map((f) => [f.path]))(
    "%s: has a test of its own that runs axe on the dialog (R6)",
    (path) => {
      if (path in AXE_EXEMPT) return;
      const paired = pairedTests(path, allTests);
      expect(paired).not.toEqual([]);
      expect(
        paired.some((t) => runsAxe(readFileSync(join(webSrc, t), "utf8")))
      ).toBe(true);
    }
  );

  it("allows a synthetic submit only where the file still needs one", () => {
    for (const path of Object.keys(SYNTHETIC_SUBMIT_ALLOWED)) {
      expect(
        callsSyntheticSubmit(readFileSync(join(webSrc, path), "utf8"))
      ).toBe(true);
    }
  });

  it.each(
    testFiles(webSrc).map((path) => [
      relative(webSrc, path),
      readFileSync(path, "utf8"),
    ])
  )("%s: presses a real Enter, never fireEvent.submit (R5)", (path, source) => {
    // This file names fireEvent.submit in its own R5 fixtures.
    if (
      path in SYNTHETIC_SUBMIT_ALLOWED ||
      path === relative(webSrc, here + "/dialog-contract.guard.test.ts")
    )
      return;
    expect(callsSyntheticSubmit(source)).toBe(false);
  });
});
