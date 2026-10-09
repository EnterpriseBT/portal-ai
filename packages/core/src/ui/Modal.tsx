import React, { useEffect, useRef, useState } from "react";
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

/** How long a submit holds off another when the dialog never disables (a
 *  validation failure, say), so Enter can't be locked out. */
const SUBMIT_HOLD_MS = 500;

export interface ModalProps extends Omit<
  DialogProps,
  "title" | "onClose" | "open"
> {
  open: boolean;
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
  /**
   * For a form dialog: true whenever its visible submit button is disabled
   * (a request in flight, an incomplete form). Enter then submits nothing,
   * matching the button. Pass the same expression as that button's `disabled`.
   */
  submitDisabled?: boolean;
  children?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  actions,
  showCloseButton = true,
  maximizable = false,
  defaultMaximized = false,
  submitDisabled = false,
  children,
  ...props
}) => {
  const [maximized, setMaximized] = useState(maximizable && defaultMaximized);
  const showHeader = !!title || showCloseButton;
  const showMaximizeButton = maximizable && showHeader;
  // A form dialog gets a default button so Enter submits it however many
  // fields it has (see FormDefaultButton).
  const paperComponent = (
    props.slotProps?.paper as { component?: unknown } | undefined
  )?.component;
  const isForm = paperComponent === "form";

  // #747: a submit's pending state reaches `submitDisabled` a render later
  // (react-query notifies on a timeout), so a fast second Enter would submit
  // again: measured as two creates from one double Enter. Hold further
  // submits until the dialog disables, or briefly if it never does.
  const submitHold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const releaseSubmitHold = () => {
    if (submitHold.current !== null) clearTimeout(submitHold.current);
    submitHold.current = null;
  };
  useEffect(() => {
    if (submitDisabled) releaseSubmitHold();
  }, [submitDisabled]);
  useEffect(() => releaseSubmitHold, []);

  const paperSlot = props.slotProps?.paper as
    | { onSubmit?: (e: React.FormEvent) => void }
    | undefined;
  const paperOnSubmit = paperSlot?.onSubmit;
  const slotProps =
    isForm && paperOnSubmit
      ? {
          ...props.slotProps,
          paper: {
            ...paperSlot,
            onSubmit: (e: React.FormEvent) => {
              if (submitHold.current !== null) {
                e.preventDefault();
                return;
              }
              submitHold.current = setTimeout(
                releaseSubmitHold,
                SUBMIT_HOLD_MS
              );
              paperOnSubmit(e);
            },
          },
        }
      : props.slotProps;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={maximizable && maximized}
      {...props}
      slotProps={slotProps}
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
                <IconButton aria-label="close" onClick={onClose} size="small">
                  <CloseIcon />
                </IconButton>
              )}
            </Box>
          )}
        </DialogTitle>
      )}
      <DialogContent>{children}</DialogContent>
      {actions && <DialogActions>{actions}</DialogActions>}
      {isForm && <FormDefaultButton disabled={submitDisabled} />}
    </Dialog>
  );
};

export default Modal;
