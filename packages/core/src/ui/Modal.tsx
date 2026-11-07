import React, { useId, useState } from "react";
import Dialog, { type DialogProps } from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import { styled } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";

import { FormDefaultButton } from "./FormDefaultButton.js";
import {
  handleOwnSubmit,
  preventToggleEnterSubmit,
} from "./handle-own-submit.js";

interface ModalBaseProps extends Omit<
  DialogProps,
  "title" | "onClose" | "open" | "onSubmit" | "aria-label"
> {
  open: boolean;
  /** Never called while `pending`. */
  onClose: () => void;
  /**
   * The dialog's content is its description (#793): a confirm whose body is
   * only its message ("Delete <name>? This can't be undone."), so a screen
   * reader reads the message with the title on open. Leave it off where the
   * content holds fields or long lists.
   */
  describeContent?: boolean;
  actions?: React.ReactNode;
  showCloseButton?: boolean;
  /**
   * When true, surfaces a maximize/restore toggle in the header alongside the
   * close button. Internal state tracks maximized; when maximized the dialog
   * uses MUI's `fullScreen` mode. Use for modals that host large workflows
   * (e.g. region editors, long forms) where the default centred dialog feels
   * cramped.
   */
  maximizable?: boolean;
  /** Initial maximized state when `maximizable` is true. */
  defaultMaximized?: boolean;
  children?: React.ReactNode;
}

/**
 * A dialog that submits (#789). Its paper is a form: Enter submits exactly
 * when the visible submit could, and the props that make that true are
 * required together.
 */
interface ModalFormProps {
  /** Runs on Enter and on the form's submit. Wire the visible submit's
   *  `onClick` to the same handler. */
  onSubmit: () => void;
  /** The visible submit's `disabled` expression. */
  submitDisabled: boolean;
  /** The submit's request is in flight: Enter, Escape, the backdrop and the
   *  close button are blocked until it settles. */
  pending: boolean;
}

/** A dialog that doesn't submit: a viewer, or a wizard whose forms live in
 *  its steps. `pending` still blocks dismissal (a wizard committing). */
interface ModalPlainProps {
  onSubmit?: never;
  submitDisabled?: never;
  pending?: boolean;
}

/** Every dialog has a name (#793): its title, or an `aria-label` when it
 *  shows none. */
type ModalName =
  | { title: React.ReactNode; "aria-label"?: never }
  | { title?: undefined; "aria-label": string };

export type ModalProps = ModalBaseProps &
  ModalName &
  (ModalFormProps | ModalPlainProps);

/**
 * A form dialog's body (#793). The form sits inside the dialog rather than
 * being its paper, because `role="dialog"` isn't allowed on a `<form>`. It
 * takes the paper's flex column so the title, the scrolling content and the
 * actions lay out as they would directly in the paper. The layout lives here
 * because no MUI component (and so no theme key) owns this element.
 */
const ModalForm = styled("form")({
  display: "flex",
  flexDirection: "column",
  flex: "1 1 auto",
  minHeight: 0,
});

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  describeContent = false,
  actions,
  showCloseButton = true,
  maximizable = false,
  defaultMaximized = false,
  onSubmit,
  submitDisabled = false,
  pending = false,
  children,
  slotProps,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedby,
  ...props
}) => {
  const contentId = useId();
  const [maximized, setMaximized] = useState(maximizable && defaultMaximized);
  const showHeader = !!title || showCloseButton;
  const showMaximizeButton = maximizable && showHeader;
  const isForm = onSubmit !== undefined;

  // #789: nothing dismisses a dialog whose request is in flight, and an
  // Escape that something inside the dialog already handled (a capture
  // listener that called preventDefault) is left to it.
  const handleClose = (event: object, reason?: string) => {
    if (pending) return;
    if (
      reason === "escapeKeyDown" &&
      (event as { defaultPrevented?: boolean }).defaultPrevented
    ) {
      return;
    }
    onClose();
  };

  // A dialog with no visible title is named by its aria-label, on the paper
  // that carries role="dialog"; MUI's generated aria-labelledby would point
  // at a title that isn't there.
  const paperSlot =
    ariaLabel !== undefined && !title
      ? {
          ...(slotProps?.paper as object | undefined),
          "aria-label": ariaLabel,
          "aria-labelledby": undefined,
        }
      : slotProps?.paper;

  const body = (
    <>
      {showHeader && (
        <DialogTitle
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            pr:
              showCloseButton || showMaximizeButton
                ? showMaximizeButton && showCloseButton
                  ? 10
                  : 6
                : 3,
          }}
        >
          {title}
          {(showCloseButton || showMaximizeButton) && (
            <Box
              data-dialog-controls=""
              sx={{ position: "absolute", right: 8, top: 8, display: "flex" }}
            >
              {showMaximizeButton && (
                <IconButton
                  aria-label={maximized ? "restore" : "maximize"}
                  onClick={() => setMaximized((prev) => !prev)}
                  size="small"
                >
                  {maximized ? <CloseFullscreenIcon /> : <OpenInFullIcon />}
                </IconButton>
              )}
              {showCloseButton && (
                // #793: aria-disabled, not disabled, while pending, so a
                // focused close button keeps focus when the request starts.
                <IconButton
                  aria-label="close"
                  aria-disabled={pending || undefined}
                  onClick={pending ? undefined : onClose}
                  size="small"
                >
                  <CloseIcon />
                </IconButton>
              )}
            </Box>
          )}
        </DialogTitle>
      )}
      <DialogContent id={describeContent ? contentId : undefined}>
        {children}
      </DialogContent>
      {actions && (
        <DialogActions data-dialog-controls="">{actions}</DialogActions>
      )}
    </>
  );

  return (
    <Dialog
      {...props}
      slotProps={{ ...slotProps, paper: paperSlot } as DialogProps["slotProps"]}
      open={open}
      onClose={handleClose}
      fullScreen={maximizable && maximized}
      aria-describedby={
        ariaDescribedby ?? (describeContent ? contentId : undefined)
      }
    >
      {isForm ? (
        // A form dialog's body is a form, with a default button so Enter
        // submits it however many fields it has (see FormDefaultButton).
        <ModalForm
          noValidate
          onSubmit={handleOwnSubmit(() => {
            if (!submitDisabled && !pending) onSubmit();
          })}
          onKeyDown={preventToggleEnterSubmit}
        >
          {body}
          <FormDefaultButton disabled={submitDisabled || pending} />
        </ModalForm>
      ) : (
        body
      )}
    </Dialog>
  );
};

export default Modal;
