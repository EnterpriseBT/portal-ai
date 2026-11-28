import React, { useId } from "react";
import Box from "@mui/material/Box";
import InputBase from "@mui/material/InputBase";
import Typography from "@mui/material/Typography";

import { visuallyHidden } from "./visually-hidden.js";

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
  /** The text field lost focus (#1079): a form marks it touched. */
  onBlur?: React.FocusEventHandler<HTMLTextAreaElement>;
  /** The field's accessible name. The placeholder isn't one (#797). */
  "aria-label": string;
  placeholder?: string;
  /** Read as the field's description, e.g. how Enter behaves. Not shown. */
  description?: string;
  inputRef?: React.Ref<HTMLTextAreaElement>;
  /** Rows the field grows to before it scrolls. Defaults to 8. */
  maxRows?: number;
  /** Controls at the field's trailing edge: a picker, a submit button. On a
   *  narrow screen they wrap onto a line under the text. */
  actions?: React.ReactNode;
  className?: string;
  /** A field error (#1079), shown under the frame and read as part of the
   *  field's description. There's no `maxLength`: a paste past a limit is
   *  kept and reported, never cut. */
  error?: string | null;
}

/**
 * A one-line prompt field that grows as you type, with its controls inside
 * the same frame (#1123), like a chat composer. The frame shows the focus
 * ring while anything inside it has focus.
 */
export const Composer: React.FC<ComposerProps> = ({
  value,
  onChange,
  onKeyDown,
  onBlur,
  "aria-label": ariaLabel,
  placeholder,
  description,
  inputRef,
  maxRows = 8,
  actions,
  className,
  error = null,
}) => {
  const descriptionId = useId();
  const errorId = useId();
  const describedBy =
    [description ? descriptionId : null, error ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <Box className={className}>
      <Box
        // sx in core, with a reason: the frame is a layout of its own (an
        // input and its controls wrapping together), not a themable variant of
        // an MUI component. Colours come from the palette.
        sx={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: 1,
          px: 1.5,
          py: 1,
          border: 1,
          borderColor: error ? "error.main" : "divider",
          borderRadius: 1,
          bgcolor: "background.paper",
          "&:focus-within": {
            borderColor: "primary.main",
            boxShadow: (theme) => `0 0 0 1px ${theme.palette.primary.main}`,
          },
        }}
      >
        <InputBase
          multiline
          maxRows={maxRows}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown as React.KeyboardEventHandler<HTMLElement>}
          onBlur={onBlur as React.FocusEventHandler<HTMLElement> | undefined}
          placeholder={placeholder}
          inputRef={inputRef}
          inputProps={{
            "aria-label": ariaLabel,
            "aria-describedby": describedBy,
            "aria-invalid": error ? true : undefined,
          }}
          // Wide enough to type in before the controls wrap under it.
          sx={{ flex: "1 1 16rem", py: 0.75 }}
        />
        {actions && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              ml: "auto",
              flexWrap: "wrap",
            }}
          >
            {actions}
          </Box>
        )}
        {description && (
          <Box component="span" id={descriptionId} sx={visuallyHidden}>
            {description}
          </Box>
        )}
      </Box>
      {error && (
        <Typography
          id={errorId}
          variant="caption"
          color="error"
          component="p"
          sx={{ mt: 0.5, mx: 1.5 }}
        >
          {error}
        </Typography>
      )}
    </Box>
  );
};

export default Composer;
