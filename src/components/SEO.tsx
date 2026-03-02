import { Helmet } from "react-helmet-async";

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

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      {canonical && <link rel="canonical" href={canonical} />}
      {noindex && <meta name="robots" content="noindex, nofollow" />}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={desc} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={desc} />
    </Helmet>
  );
}
