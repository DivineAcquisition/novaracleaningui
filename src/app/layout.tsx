import type { Metadata } from "next";
import { Suspense } from "react";
import { Providers } from "@/components/Providers";
import "@/index.css";

// Force dynamic rendering for all pages since the app relies heavily on
// client-side auth, localStorage, and domain-based routing
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "NovaraCleaning - Premium Home Cleaning Service",
  description:
    "Book trusted home cleaners in minutes. Premium cleaning service with flexible scheduling, transparent pricing, and 100% satisfaction guarantee.",
  authors: [{ name: "NovaraCleaning" }],
  openGraph: {
    type: "website",
    title: "NovaraCleaning - Premium Home Cleaning Service",
    description:
      "Book trusted home cleaners in minutes. Premium cleaning service with flexible scheduling, transparent pricing, and 100% satisfaction guarantee.",
    images: [
      "https://storage.googleapis.com/gpt-engineer-file-uploads/gKZdtAV5x1fAVy9ghNl5qNeLg112/social-images/social-1764892555639-Comp 1 (0;00;00;13).png",
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@Lovable",
    title: "NovaraCleaning - Premium Home Cleaning Service",
    description:
      "Book trusted home cleaners in minutes. Premium cleaning service with flexible scheduling, transparent pricing, and 100% satisfaction guarantee.",
    images: [
      "https://storage.googleapis.com/gpt-engineer-file-uploads/gKZdtAV5x1fAVy9ghNl5qNeLg112/social-images/social-1764892555639-Comp 1 (0;00;00;13).png",
    ],
  },
  icons: {
    icon: "https://storage.googleapis.com/gpt-engineer-file-uploads/gKZdtAV5x1fAVy9ghNl5qNeLg112/uploads/1762825408793-App(1) (0-00-00-00).png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Plus+Jakarta+Sans:wght@700;800&display=swap"
          rel="stylesheet"
        />
        {/* Meta Pixel Code */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
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
            `,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        {/* Meta Pixel noscript fallback */}
        <noscript>
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            src="https://www.facebook.com/tr?id=1641726577181415&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>
        <Providers>
          <Suspense>{children}</Suspense>
        </Providers>
      </body>
    </html>
  );
}
