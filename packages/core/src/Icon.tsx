import React from "react";
import MuiSvgIcon from "@mui/material/SvgIcon";
import type { SvgIconProps as MuiSvgIconProps } from "@mui/material/SvgIcon";
import HomeIcon from "@mui/icons-material/Home";
import DeleteIcon from "@mui/icons-material/Delete";
import SendIcon from "@mui/icons-material/Send";
import SearchIcon from "@mui/icons-material/Search";
import SettingsIcon from "@mui/icons-material/Settings";
import PersonIcon from "@mui/icons-material/Person";
import EmailIcon from "@mui/icons-material/Email";
import PhoneIcon from "@mui/icons-material/Phone";
import FavoriteIcon from "@mui/icons-material/Favorite";
import StarIcon from "@mui/icons-material/Star";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import MenuIcon from "@mui/icons-material/Menu";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import HeartIcon from "./assets/icons/heart.svg";

export enum IconName {
  Home = "home",
  Delete = "delete",
  Send = "send",
  Search = "search",
  Settings = "settings",
  Person = "person",
  Email = "email",
  Phone = "phone",
  Favorite = "favorite",
  Star = "star",
  Check = "check",
  Close = "close",
  ArrowBack = "arrow_back",
  ArrowForward = "arrow_forward",
  Menu = "menu",
  MoreVert = "more_vert",
  Heart = "heart",
  Logo = "logo",
}

export interface IconProps extends Omit<MuiSvgIconProps, "children"> {
  /**
   * Name of icon.
   */
  name: IconName;
}

export const Icon = React.forwardRef<SVGSVGElement, IconProps>(
  ({ name, ...props }, ref) => {
    switch (name) {
      case IconName.Home:
        return <HomeIcon ref={ref} {...props} />;
      case IconName.Delete:
        return <DeleteIcon ref={ref} {...props} />;
      case IconName.Send:
        return <SendIcon ref={ref} {...props} />;
      case IconName.Search:
        return <SearchIcon ref={ref} {...props} />;
      case IconName.Settings:
        return <SettingsIcon ref={ref} {...props} />;
      case IconName.Person:
        return <PersonIcon ref={ref} {...props} />;
      case IconName.Email:
        return <EmailIcon ref={ref} {...props} />;
      case IconName.Phone:
        return <PhoneIcon ref={ref} {...props} />;
      case IconName.Favorite:
        return <FavoriteIcon ref={ref} {...props} />;
      case IconName.Star:
        return <StarIcon ref={ref} {...props} />;
      case IconName.Check:
        return <CheckIcon ref={ref} {...props} />;
      case IconName.Close:
        return <CloseIcon ref={ref} {...props} />;
      case IconName.ArrowBack:
        return <ArrowBackIcon ref={ref} {...props} />;
      case IconName.ArrowForward:
        return <ArrowForwardIcon ref={ref} {...props} />;
      case IconName.Menu:
        return <MenuIcon ref={ref} {...props} />;
      case IconName.MoreVert:
        return <MoreVertIcon ref={ref} {...props} />;
      case IconName.Heart:
        return (
          <MuiSvgIcon ref={ref} {...props}>
            <HeartIcon />
          </MuiSvgIcon>
        );
      default:
        // If no name is provided or the name doesn't match, render children as a custom icon
        throw new Error(
          `Icon name "${name}" is not recognized. Please provide a valid icon name or use children to define a custom icon.`,
        );
    }
  },
);

export default Icon;
