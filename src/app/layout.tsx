import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "NovaraCleaning - Premium Home Cleaning Service",
  description:
    "Book trusted home cleaners in minutes. Premium cleaning service with flexible scheduling, transparent pricing, and 100% satisfaction guarantee.",
  authors: [{ name: "NovaraCleaning" }],
  icons: {
    icon: "https://storage.googleapis.com/gpt-engineer-file-uploads/gKZdtAV5x1fAVy9ghNl5qNeLg112/uploads/1762825408793-App(1) (0-00-00-00).png",
  },
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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${plusJakarta.variable}`}>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
