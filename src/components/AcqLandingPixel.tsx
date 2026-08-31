import Script from "next/script";

// Facebook ads pixel for the public acquisition landing (`/`) only.
// The sitewide Novara pixel stays in src/app/layout.tsx. This one must not
// be mounted on admin, docs, contractor, or booking routes.
//
// PageView is sent with trackSingle so we do not fire a second PageView on
// the sitewide pixel when both are initialized on this page.
export const ACQ_LANDING_PIXEL_ID = "2779578425739507";

export function AcqLandingPixel() {
  return (
    <>
      <Script id="acq-landing-meta-pixel" strategy="afterInteractive">
        {`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${ACQ_LANDING_PIXEL_ID}');
          fbq('trackSingle', '${ACQ_LANDING_PIXEL_ID}', 'PageView');
        `}
      </Script>
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          src={`https://www.facebook.com/tr?id=${ACQ_LANDING_PIXEL_ID}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
    </>
  );
}
