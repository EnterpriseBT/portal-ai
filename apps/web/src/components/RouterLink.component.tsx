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
    // #1059: TanStack's `to` is a path. A query goes as `search` and a
    // fragment (a Help entry's `#faq-entry-…`) as `hash`; left in `to`, they
    // name a route that doesn't exist or stop short of the entry.
    if (!/[?#]/.test(href)) return <Link ref={ref} to={href} {...rest} />;
    const hashAt = href.indexOf("#");
    const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt);
    const hash = hashAt === -1 ? "" : href.slice(hashAt + 1);
    const queryAt = beforeHash.indexOf("?");
    const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
    const query = queryAt === -1 ? "" : beforeHash.slice(queryAt + 1);
    const search = Object.fromEntries(new URLSearchParams(query));
    const to = path || ".";
    return (
      <Link
        ref={ref}
        to={to}
        {...(query ? { search } : {})}
        {...(hash ? { hash } : {})}
        {...rest}
      />
    );
  }
);

RouterLink.displayName = "RouterLink";
