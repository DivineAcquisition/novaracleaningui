"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { readStoredCookieChoice, type StoredCookieChoice } from "./CookieNotice";
import { trackersAllowed } from "@/lib/compliance";

const ADS_ID = "AW-17623293005";
const GTM_ID = "GTM-WT3SLNN7";
const META_PIXEL_ID = "1641726577181415";

/**
 * Advertising tags stay out of the page until that category is accepted.
 * No analytics product is installed. Session replay is not installed.
 */
export function TrackerGate() {
  const [choice, setChoice] = useState<StoredCookieChoice | null>(null);

  useEffect(() => {
    const sync = () => setChoice(readStoredCookieChoice());
    sync();
    window.addEventListener("novara:cookie-changed", sync);
    return () => window.removeEventListener("novara:cookie-changed", sync);
  }, []);

  const allowed = trackersAllowed(choice);
  if (!allowed.advertising) return null;

  return (
    <>
      <Script id="google-tag-manager" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push({'gtm.start': new Date().getTime(), event: 'gtm.js'});
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          (function(){
            var s = document.createElement('script');
            s.async = true;
            s.src = 'https://www.googletagmanager.com/gtm.js?id=${GTM_ID}';
            document.head.appendChild(s);
          })();
        `}
      </Script>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${ADS_ID}`} strategy="afterInteractive" />
      <Script id="google-ads" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${ADS_ID}');
        `}
      </Script>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${META_PIXEL_ID}');
          fbq('track', 'PageView');
        `}
      </Script>
    </>
  );
}
