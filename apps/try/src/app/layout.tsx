import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "NovaraCleaning - Professional House Cleaning",
  description: "Book your professional house cleaning service. New Year Special: $189 Membership with first clean included!",
  keywords: ["house cleaning", "cleaning service", "professional cleaning", "home cleaning"],
  openGraph: {
    title: "NovaraCleaning - Professional House Cleaning",
    description: "Book your professional house cleaning service today!",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          {children}
          <Toaster position="top-center" richColors />
        </Providers>
      </body>
    </html>
  );
}
