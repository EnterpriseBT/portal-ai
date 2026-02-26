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
import GoogleIcon from "@mui/icons-material/Google";
import LogoutIcon from "@mui/icons-material/Logout";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LockIcon from "@mui/icons-material/Lock";
import BlockIcon from "@mui/icons-material/Block";
import WarningIcon from "@mui/icons-material/Warning";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import HeartIcon from "../assets/icons/heart.svg";

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
  Google = "google",
  Logout = "logout",
  Sun = "sun",
  Moon = "moon",
  Lock = "lock",
  Block = "block",
  Warning = "warning",
  KeyboardDoubleArrowLeft = "keyboard_double_arrow_left",
  KeyboardDoubleArrowRight = "keyboard_double_arrow_right",
  ExpandMore = "expand_more",
  ExpandLess = "expand_less",
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
      case IconName.Google:
        return <GoogleIcon ref={ref} {...props} />;
      case IconName.Logout:
        return <LogoutIcon ref={ref} {...props} />;
      case IconName.Sun:
        return <LightModeIcon ref={ref} {...props} />;
      case IconName.Moon:
        return <DarkModeIcon ref={ref} {...props} />;
      case IconName.Lock:
        return <LockIcon ref={ref} {...props} />;
      case IconName.Block:
        return <BlockIcon ref={ref} {...props} />;
      case IconName.Warning:
        return <WarningIcon ref={ref} {...props} />;
      case IconName.KeyboardDoubleArrowLeft:
        return <KeyboardDoubleArrowLeftIcon ref={ref} {...props} />;
      case IconName.KeyboardDoubleArrowRight:
        return <KeyboardDoubleArrowRightIcon ref={ref} {...props} />;
      case IconName.ExpandMore:
        return <ExpandMoreIcon ref={ref} {...props} />;
      case IconName.ExpandLess:
        return <ExpandLessIcon ref={ref} {...props} />;
      case IconName.Heart:
        return (
          <MuiSvgIcon ref={ref} {...props}>
            <HeartIcon />
          </MuiSvgIcon>
        );
      default:
        // If no name is provided or the name doesn't match, render children as a custom icon
        throw new Error(
          `Icon name "${name}" is not recognized. Please provide a valid icon name or use children to define a custom icon.`
        );
    }
  }
);

export default Icon;
