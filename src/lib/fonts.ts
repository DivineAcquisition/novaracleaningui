import localFont from "next/font/local";

/**
 * One typeface for the whole site — public pages, booking flow, portals and
 * the admin workspace: Inter Display.
 *
 * Inter Variable (upright + italic, weights 100–900, OFL — src/fonts/OFL.txt),
 * the same files and settings as the Selestial app, with the optical-size
 * axis locked to 32, which is the Display cut at every size. The @font-face
 * carries the opsz lock for browsers that honour the descriptor; globals.css
 * also sets it on <body> (with font-optical-sizing: none) because Chromium
 * ignores the descriptor.
 *
 * Registered as --font-inter so every existing reference (Tailwind
 * font-sans / font-heading / font-jakarta, var(--font-inter) in CSS and SVG)
 * resolves to it without further changes.
 */
export const interDisplay = localFont({
  src: [
    { path: "../fonts/InterVariable.woff2", weight: "100 900", style: "normal" },
    { path: "../fonts/InterVariable-Italic.woff2", weight: "100 900", style: "italic" },
  ],
  variable: "--font-inter",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
  // Single quotes: next/font serializes this into a query string and a
  // double-quoted "opsz" breaks that parse.
  declarations: [{ prop: "font-variation-settings", value: "'opsz' 32" }],
});

/**
 * Geist Mono (OFL — src/fonts/GeistMono-OFL.txt) for code and identifiers
 * (code, kbd, pre, font-mono). Not preloaded: few pages render it.
 */
export const geistMono = localFont({
  src: [{ path: "../fonts/GeistMono-Variable.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-mono",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});
