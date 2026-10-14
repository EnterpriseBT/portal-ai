import React, { useState } from "react";
import Dialog, { type DialogProps } from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
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
  "title" | "onClose" | "open" | "onSubmit"
> {
  open: boolean;
  /** Never called while `pending`. */
  onClose: () => void;
  title?: React.ReactNode;
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

export type ModalProps = ModalBaseProps & (ModalFormProps | ModalPlainProps);

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  actions,
  showCloseButton = true,
  maximizable = false,
  defaultMaximized = false,
  onSubmit,
  submitDisabled = false,
  pending = false,
  children,
  slotProps,
  ...props
}) => {
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

  // A form dialog's paper is the form. It gets a default button so Enter
  // submits it however many fields it has (see FormDefaultButton).
  const paperSlot = isForm
    ? {
        ...(slotProps?.paper as object | undefined),
        component: "form",
        noValidate: true,
        onSubmit: handleOwnSubmit(() => {
          if (!submitDisabled && !pending) onSubmit();
        }),
        onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
          preventToggleEnterSubmit(event);
          (
            slotProps?.paper as
              | { onKeyDown?: React.KeyboardEventHandler<HTMLElement> }
              | undefined
          )?.onKeyDown?.(event);
        },
      }
    : slotProps?.paper;

  return (
    <Dialog
      {...props}
      slotProps={{ ...slotProps, paper: paperSlot } as DialogProps["slotProps"]}
      open={open}
      onClose={handleClose}
      fullScreen={maximizable && maximized}
    >
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
                <IconButton
                  aria-label="close"
                  onClick={onClose}
                  disabled={pending}
                  size="small"
                >
                  <CloseIcon />
                </IconButton>
              )}
            </Box>
          )}
        </DialogTitle>
      )}
      <DialogContent>{children}</DialogContent>
      {actions && (
        <DialogActions data-dialog-controls="">{actions}</DialogActions>
      )}
      {isForm && <FormDefaultButton disabled={submitDisabled || pending} />}
    </Dialog>
  );
};

export default Modal;
