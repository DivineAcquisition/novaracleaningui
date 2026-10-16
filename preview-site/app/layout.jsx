import { Figtree } from "next/font/google";
import { CtaBand, Footer, Header } from "../components/Chrome";
import { BookDock, ScrollProgress } from "../components/effects";
import "./globals.css";

const figtree = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-figtree",
});

export const metadata = {
  title: "NovaraCleaning™ - Premium Home Cleaning Services",
  description: "DMV premium home, office, and commercial cleaning. Background-checked cleaners, upfront pricing, and a free reclean if we miss anything.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={figtree.variable} style={{ fontFamily: "var(--font-figtree), sans-serif" }}>
        <div className="preview-bar">
          Preview only. This temporary site is <strong>not</strong> connected to novaracleaning.com or any other live domain.
        </div>
        <ScrollProgress />
        <Header />
        {children}
        <CtaBand />
        <Footer />
        <BookDock />
      </body>
    </html>
  );
}
