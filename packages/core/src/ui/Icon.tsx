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
import ErrorIcon from "@mui/icons-material/Error";
import InfoIcon from "@mui/icons-material/Info";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRight";
import KeyboardArrowLeftIcon from "@mui/icons-material/KeyboardArrowLeft";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import RefreshIcon from "@mui/icons-material/Refresh";
import HeartIcon from "../assets/icons/heart.svg";
import MemoryChip from "@mui/icons-material/Memory";
import WorkIcon from "@mui/icons-material/Work";
import LinkIcon from "@mui/icons-material/Link";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import DataObjectIcon from "@mui/icons-material/DataObject";
import LabelIcon from "@mui/icons-material/Label";
import ColorizeIcon from "@mui/icons-material/Colorize";
import HubIcon from "@mui/icons-material/Hub";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import PushPinIcon from "@mui/icons-material/PushPin";

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
  Error = "error",
  Info = "info",
  CheckCircle = "check_circle",
  KeyboardDoubleArrowLeft = "keyboard_double_arrow_left",
  KeyboardDoubleArrowRight = "keyboard_double_arrow_right",
  KeyboardArrowLeft = "keyboard_arrow_left",
  KeyboardArrowRight = "keyboard_arrow_right",
  ExpandMore = "expand_more",
  ExpandLess = "expand_less",
  Refresh = "refresh",
  MemoryChip = "memory_chip",
  Work = "work",
  Link = "link",
  ViewColumn = "view_column",
  DataObject = "data_object",
  Label = "label",
  Colorize = "colorize",
  Hub = "hub",
  RocketLaunch = "rocket_launch",
  PushPin = "push_pin",
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
      case IconName.Error:
        return <ErrorIcon ref={ref} {...props} />;
      case IconName.Info:
        return <InfoIcon ref={ref} {...props} />;
      case IconName.CheckCircle:
        return <CheckCircleIcon ref={ref} {...props} />;
      case IconName.KeyboardDoubleArrowLeft:
        return <KeyboardDoubleArrowLeftIcon ref={ref} {...props} />;
      case IconName.KeyboardDoubleArrowRight:
        return <KeyboardDoubleArrowRightIcon ref={ref} {...props} />;
      case IconName.KeyboardArrowLeft:
        return <KeyboardArrowLeftIcon ref={ref} {...props} />;
      case IconName.KeyboardArrowRight:
        return <KeyboardArrowRightIcon ref={ref} {...props} />;
      case IconName.ExpandMore:
        return <ExpandMoreIcon ref={ref} {...props} />;
      case IconName.ExpandLess:
        return <ExpandLessIcon ref={ref} {...props} />;
      case IconName.Refresh:
        return <RefreshIcon ref={ref} {...props} />;
      case IconName.Heart:
        return (
          <MuiSvgIcon ref={ref} {...props}>
            <HeartIcon />
          </MuiSvgIcon>
        );
      case IconName.MemoryChip:
        return <MemoryChip ref={ref} {...props} />;
      case IconName.Work:
        return <WorkIcon ref={ref} {...props} />;
      case IconName.Link:
        return <LinkIcon ref={ref} {...props} />;
      case IconName.ViewColumn:
        return <ViewColumnIcon ref={ref} {...props} />;
      case IconName.DataObject:
        return <DataObjectIcon ref={ref} {...props} />;
      case IconName.Label:
        return <LabelIcon ref={ref} {...props} />;
      case IconName.Colorize:
        return <ColorizeIcon ref={ref} {...props} />;
      case IconName.Hub:
        return <HubIcon ref={ref} {...props} />;
      case IconName.RocketLaunch:
        return <RocketLaunchIcon ref={ref} {...props} />;
      case IconName.PushPin:
        return <PushPinIcon ref={ref} {...props} />;
      default:
        // If no name is provided or the name doesn't match, render children as a custom icon
        throw new Error(
          `Icon name "${name}" is not recognized. Please provide a valid icon name or use children to define a custom icon.`
        );
    }
  }
);

export default Icon;
