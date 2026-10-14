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
});
