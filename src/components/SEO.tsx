"use client";

import { useEffect } from "react";

interface SEOProps {
  title?: string;
  description?: string;
  canonical?: string;
  noindex?: boolean;
}

const BRAND = "Novara Cleaning";
const DEFAULT_DESCRIPTION = "Book top-rated home cleaning in the DMV area. Google Guaranteed cleaners, transparent pricing, flexible scheduling, and a 100% satisfaction guarantee.";

export function SEO({ title, description, canonical, noindex }: SEOProps) {
  const fullTitle = title ? `${title} | ${BRAND}` : `${BRAND} | Professional Home Cleaning in Maryland & DMV`;
  const desc = description || DEFAULT_DESCRIPTION;

  useEffect(() => {
    document.title = fullTitle;

    const setMeta = (name: string, content: string, isProperty = false) => {
      const attr = isProperty ? "property" : "name";
      let el = document.querySelector(`meta[${attr}="${name}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    setMeta("description", desc);
    setMeta("og:title", fullTitle, true);
    setMeta("og:description", desc, true);
    setMeta("twitter:title", fullTitle);
    setMeta("twitter:description", desc);

    if (noindex) {
      setMeta("robots", "noindex, nofollow");
    }

    if (canonical) {
      let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement("link");
        link.rel = "canonical";
        document.head.appendChild(link);
      }
      link.href = canonical;
    }
  }, [fullTitle, desc, canonical, noindex]);

  return null;
}
