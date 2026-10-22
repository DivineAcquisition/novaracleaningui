import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { UTMTracker } from "@/components/UTMTracker";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["300", "400", "500", "600", "700", "800"],
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["500", "600", "700", "800"],
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
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
};

// Explicit mobile viewport so every surface (admin portal included) scales
// correctly on phones. `width=device-width, initial-scale=1` with user scaling
// left enabled for accessibility.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#8B5CF6",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
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
        className={`${inter.variable} ${jakarta.variable} ${jetbrains.variable} font-sans antialiased`}
      >
        {/* Advertising tags load from TrackerGate only after consent.
            UTM capture is first-party and does not call an ad network. */}
        <UTMTracker />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
