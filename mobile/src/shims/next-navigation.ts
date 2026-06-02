// Shim for `next/navigation` backed by react-router. Lets the existing
// cleaner screens (which import useRouter/usePathname/etc. from Next) run
// unchanged inside the Capacitor SPA.
import {
  useNavigate,
  useLocation,
  useParams as useRRParams,
  useSearchParams as useRRSearchParams,
} from "react-router-dom";

export function useRouter() {
  const navigate = useNavigate();
  return {
    push: (href: string) => navigate(href),
    replace: (href: string) => navigate(href, { replace: true }),
    back: () => navigate(-1),
    forward: () => navigate(1),
    refresh: () => {
      /* no-op in SPA */
    },
    prefetch: () => Promise.resolve(),
  };
}

export function usePathname(): string {
  return useLocation().pathname;
}

export function useSearchParams(): URLSearchParams {
  const [params] = useRRSearchParams();
  return params;
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useRRParams() as T;
}

export function redirect(href: string): void {
  // Mirrors Next's redirect() for the SPA: hard-navigate within the hash router.
  window.location.hash = href.startsWith("#") ? href : `#${href}`;
}

export function notFound(): void {
  window.location.hash = "#/cleaner/auth";
}
