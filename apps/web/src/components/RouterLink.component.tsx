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
  ({ href, ...rest }, ref) => {
    // #1059: TanStack's `to` is a path; a fragment (a Help entry's
    // `#faq-entry-…`) goes as `hash`, or the link stops short of the entry.
    const at = href.indexOf("#");
    return at === -1 ? (
      <Link ref={ref} to={href} {...rest} />
    ) : (
      <Link
        ref={ref}
        to={href.slice(0, at)}
        hash={href.slice(at + 1)}
        {...rest}
      />
    );
  }
);

RouterLink.displayName = "RouterLink";
