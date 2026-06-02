// Shim for `next/link` backed by react-router's Link. External links and
// tel:/mailto: fall through to a plain anchor.
import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";

type NextLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string | { pathname?: string };
  children?: ReactNode;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
};

const Link = forwardRef<HTMLAnchorElement, NextLinkProps>(function Link(
  { href, children, prefetch, replace, scroll, shallow, passHref, legacyBehavior, ...rest },
  ref,
) {
  const to = typeof href === "string" ? href : href?.pathname || "/";
  const isExternal =
    /^https?:\/\//i.test(to) || to.startsWith("mailto:") || to.startsWith("tel:");

  if (isExternal) {
    return (
      <a ref={ref} href={to} {...rest}>
        {children}
      </a>
    );
  }

  return (
    <RouterLink ref={ref} to={to} replace={replace} {...rest}>
      {children}
    </RouterLink>
  );
});

export default Link;
