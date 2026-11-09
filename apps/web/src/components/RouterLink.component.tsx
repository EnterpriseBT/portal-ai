import React from "react";
import { Link } from "@tanstack/react-router";

export interface RouterLinkProps extends Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> {
  href: string;
}

/**
 * The app's router link for core components that render links (#794).
 * Core can't import the router, so `DataTable`'s row links and `DetailCard`'s
 * title take a `linkComponent`; MUI hands that component `href`, and TanStack's
 * `Link` wants `to`. Pass this as `linkComponent` wherever core links navigate.
 */
export const RouterLink = React.forwardRef<HTMLAnchorElement, RouterLinkProps>(
  ({ href, ...rest }, ref) => <Link ref={ref} to={href} {...rest} />
);

RouterLink.displayName = "RouterLink";
