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
  children,
  ...props
}) => {
  const [maximized, setMaximized] = useState(
    maximizable && defaultMaximized
  );
  const showHeader = !!title || showCloseButton;
  const showMaximizeButton = maximizable && showHeader;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={maximizable && maximized}
      {...props}
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
            <Box sx={{ position: "absolute", right: 8, top: 8, display: "flex" }}>
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
    </Dialog>
  );
};

export default Modal;
