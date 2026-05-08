import React, { useMemo } from "react";

import Box from "@mui/material/Box";
import { useTheme } from "@mui/material/styles";

import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import csharp from "highlight.js/lib/languages/csharp";
import json from "highlight.js/lib/languages/json";

// Register only the languages we actually highlight. Each grammar is
// a few KB; keeping the list tight keeps the bundle small. Add new
// languages here as call sites need them.
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("json", json);

export type HighlightLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "csharp"
  | "json";

export interface HighlightedCodeProps {
  /** Source code to render. */
  code: string;
  /**
   * Highlight.js language id. When omitted (or an unsupported value),
   * the source is rendered as plain monospaced text — no error.
   */
  language?: HighlightLanguage;
  /** Override the default font size (12 px). */
  fontSize?: number | string;
  /** Override the default `maxHeight` (none — let the parent constrain). */
  maxHeight?: number | string;
  "data-testid"?: string;
}

/**
 * Editor-styled monospace code block with syntax highlighting via
 * `highlight.js`. The token classes (`hljs-keyword`, `hljs-string`,
 * etc.) are coloured against the MUI theme palette so the snippet
 * adapts to light/dark mode without importing a separate
 * highlight.js theme stylesheet.
 *
 * Pass `language` to opt in to highlighting; omit it to fall back to
 * plain monospace. Unsupported languages also render plain — the
 * caller doesn't need a runtime check.
 */
export const HighlightedCode: React.FC<HighlightedCodeProps> = ({
  code,
  language,
  fontSize = 12,
  maxHeight,
  "data-testid": testId,
}) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";

  const highlighted = useMemo(() => {
    if (!language) return null;
    if (!hljs.getLanguage(language)) return null;
    try {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    } catch {
      return null;
    }
  }, [code, language]);

  // Theme-derived palette for hljs token classes. Picks readable
  // hues against both light and dark surfaces; plays nicely with
  // the action.hover background used elsewhere for code blocks.
  const tokenColors = isDark
    ? {
        keyword: "#c586c0",
        builtin: "#4ec9b0",
        type: "#4ec9b0",
        string: "#ce9178",
        number: "#b5cea8",
        comment: "#6a9955",
        function: "#dcdcaa",
        attr: "#9cdcfe",
        meta: "#569cd6",
        literal: "#569cd6",
      }
    : {
        keyword: "#af00db",
        builtin: "#267f99",
        type: "#267f99",
        string: "#a31515",
        number: "#098658",
        comment: "#008000",
        function: "#795e26",
        attr: "#001080",
        meta: "#0000ff",
        literal: "#0000ff",
      };

  return (
    <Box
      component="pre"
      data-testid={testId}
      sx={{
        fontSize,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        backgroundColor: theme.palette.action.hover,
        borderRadius: 0.5,
        p: 1.5,
        m: 0,
        overflow: "auto",
        ...(maxHeight !== undefined ? { maxHeight } : {}),
        // Theme highlight.js token classes against the palette.
        "& .hljs-keyword, & .hljs-built_in, & .hljs-class .hljs-keyword": {
          color: tokenColors.keyword,
        },
        "& .hljs-built_in": { color: tokenColors.builtin },
        "& .hljs-type, & .hljs-class .hljs-title, & .hljs-title.class_": {
          color: tokenColors.type,
        },
        "& .hljs-string, & .hljs-attribute, & .hljs-symbol": {
          color: tokenColors.string,
        },
        "& .hljs-number": { color: tokenColors.number },
        "& .hljs-literal, & .hljs-meta": { color: tokenColors.literal },
        "& .hljs-comment, & .hljs-doctag, & .hljs-quote": {
          color: tokenColors.comment,
          fontStyle: "italic",
        },
        "& .hljs-function .hljs-title, & .hljs-title.function_": {
          color: tokenColors.function,
        },
        "& .hljs-attr, & .hljs-property, & .hljs-variable": {
          color: tokenColors.attr,
        },
      }}
    >
      {highlighted ? (
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      ) : (
        <code>{code}</code>
      )}
    </Box>
  );
};
