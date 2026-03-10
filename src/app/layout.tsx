import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["300", "400", "500", "600", "700", "800"],
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["700", "800"],
});

export const metadata: Metadata = {
  title: "Novara Cleaning | Professional Home Cleaning in Maryland & DMV",
  description:
    "Book top-rated home cleaning in the DMV area. Google Guaranteed cleaners, transparent pricing, flexible scheduling, and a 100% satisfaction guarantee. Book online in 60 seconds.",
  authors: [{ name: "Novara Cleaning" }],
  metadataBase: new URL("https://novaracleaning.com"),
  openGraph: {
    type: "website",
    siteName: "Novara Cleaning",
    title: "Novara Cleaning | Professional Home Cleaning in Maryland & DMV",
    description:
      "Book top-rated home cleaning in the DMV area. Google Guaranteed cleaners, transparent pricing, flexible scheduling, and a 100% satisfaction guarantee.",
    url: "https://novaracleaning.com",
    images: [
      {
        url: "https://sxdraeptzuamsgjcvfeg.supabase.co/storage/v1/object/public/assets/novara-og-image.png",
        width: 1200,
        height: 630,
      },
    ],
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@NovaraCleaning",
    title: "Novara Cleaning | Professional Home Cleaning in Maryland & DMV",
    description:
      "Book top-rated home cleaning in the DMV area. Google Guaranteed, transparent pricing, and 100% satisfaction guarantee.",
    images: [
      "https://sxdraeptzuamsgjcvfeg.supabase.co/storage/v1/object/public/assets/novara-og-image.png",
    ],
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon.ico", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  robots: "index, follow",
  other: {
    "theme-color": "#8B5CF6",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=AW-17623293005"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'AW-17623293005');
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
            fbq('init', '1641726577181415');
            fbq('track', 'PageView');
          `}
        </Script>
        <link rel="canonical" href="https://novaracleaning.com" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "LocalBusiness",
              name: "Novara Cleaning",
              description:
                "Professional home cleaning service in the DMV area. Google Guaranteed with transparent pricing and 100% satisfaction guarantee.",
              url: "https://novaracleaning.com",
              telephone: "+18447352070",
              email: "hello@novaracleaning.com",
              address: {
                "@type": "PostalAddress",
                addressRegion: "MD",
                addressCountry: "US",
              },
              priceRange: "$99-$450",
              aggregateRating: {
                "@type": "AggregateRating",
                ratingValue: "4.9",
                reviewCount: "500",
              },
              sameAs: [
                "https://www.instagram.com/novaracleaning",
                "https://www.facebook.com/novaracleaning",
              ],
            }),
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${jakarta.variable} font-sans antialiased`}
      >
        <noscript>
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            src="https://www.facebook.com/tr?id=1641726577181415&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
