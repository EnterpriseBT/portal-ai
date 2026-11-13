import React, { useMemo, useState } from "react";

import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { useTheme } from "@mui/material/styles";
import CheckIcon from "@mui/icons-material/Check";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

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
   * Names the block for assistive technology ("Result", "Request body").
   * The block scrolls, so it's a focusable region a keyboard user can
   * scroll with the arrow keys, and a region needs a name (#799).
   */
  label: string;
  /**
   * Highlight.js language id. When omitted (or an unsupported value),
   * the source is rendered as plain monospaced text — no error.
   */
  language?: HighlightLanguage;
  /** Override the default font size (12 px). */
  fontSize?: number | string;
  /** Override the default `maxHeight` (none — let the parent constrain). */
  maxHeight?: number | string;
  /**
   * When false, hides the copy-to-clipboard button. Defaults to true.
   * Disable for inline / cell-sized renderings where the button would
   * dominate the cell.
   */
  showCopyButton?: boolean;
  "data-testid"?: string;
}

/**
 * Editor-styled monospace code block with syntax highlighting via
 * `highlight.js`. Its colours, the highlight.js token classes included,
 * come from the theme's `[data-code-block]` rules over `palette.code`
 * (`@portalai/core`), where each is held at AA in both themes (#799).
 * The block is a named, focusable region, since it scrolls.
 *
 * Pass `language` to opt in to highlighting; omit it to fall back to
 * plain monospace. Unsupported languages also render plain — the
 * caller doesn't need a runtime check.
 */
export const HighlightedCode: React.FC<HighlightedCodeProps> = ({
  code,
  label,
  language,
  fontSize = 12,
  maxHeight,
  showCopyButton = true,
  "data-testid": testId,
}) => {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (insecure context, permissions). The
      // user can still select-and-copy the text manually.
    }
  };

  const highlighted = useMemo(() => {
    if (!language) return null;
    if (!hljs.getLanguage(language)) return null;
    try {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    } catch {
      return null;
    }
  }, [code, language]);

  return (
    <Box sx={{ position: "relative" }}>
      <Box
        component="pre"
        data-testid={testId}
        data-code-block=""
        role="region"
        aria-label={label}
        tabIndex={0}
        sx={{
          fontSize,
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          borderRadius: 0.5,
          p: 1.5,
          // Reserve room on the right so a long unbroken line doesn't
          // slide under the copy button.
          pr: showCopyButton ? 5 : 1.5,
          m: 0,
          overflow: "auto",
          ...(maxHeight !== undefined ? { maxHeight } : {}),
        }}
      >
        {highlighted ? (
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <code>{code}</code>
        )}
      </Box>
      {showCopyButton && (
        <Tooltip title={copied ? "Copied" : "Copy"} placement="left">
          <IconButton
            size="small"
            onClick={handleCopy}
            data-testid={testId ? `${testId}-copy` : undefined}
            aria-label={copied ? "Copied" : "Copy code"}
            sx={{
              position: "absolute",
              top: 4,
              right: 4,
              backgroundColor: theme.palette.background.paper,
              border: 1,
              borderColor: "divider",
              "&:hover": { backgroundColor: theme.palette.background.paper },
              opacity: 0.85,
              "&:hover, &:focus-visible": { opacity: 1 },
            }}
          >
            {copied ? (
              <CheckIcon sx={{ fontSize: 14 }} />
            ) : (
              <ContentCopyIcon sx={{ fontSize: 14 }} />
            )}
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
};
