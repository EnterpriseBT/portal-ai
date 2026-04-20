import MuiIconButton, {
  IconButtonProps as MuiIconButtonProps,
} from "@mui/material/IconButton";
import Icon, { IconName } from "./Icon.js";
import React from "react";

export interface IconButtonProps extends MuiIconButtonProps {
  icon: IconName;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, ...props }, ref) => {
    return (
      <MuiIconButton ref={ref} {...props}>
        <Icon name={icon} />
      </MuiIconButton>
    );
  }
);
