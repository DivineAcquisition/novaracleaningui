import localFont from "next/font/local";

/**
 * Admin workspace typography — Inter Display.
 *
 * Same files and settings as the Selestial operator app: Inter Variable
 * (upright + italic, weights 100–900, OFL, see src/fonts/OFL.txt) with the
 * optical-size axis locked to 32, which is the Display cut at every size.
 * The @font-face declaration carries the opsz lock for browsers that honour
 * the descriptor; the admin scope in globals.css also sets it as a property
 * (with font-optical-sizing: none) because Chromium ignores the descriptor.
 *
 * This module is imported only by the admin shell, so public pages and the
 * public booking flow never download or preload these files. The families are
 * exposed to CSS through <AdminTypography /> as --font-ui / --font-ui-mono on
 * :root while the shell is mounted, which lets portaled menus, dialogs,
 * sheets and toasts (mounted under <body>, outside the shell) inherit them.
 */
export const adminInter = localFont({
  src: [
    { path: "../fonts/InterVariable.woff2", weight: "100 900", style: "normal" },
    { path: "../fonts/InterVariable-Italic.woff2", weight: "100 900", style: "italic" },
  ],
  variable: "--font-admin-sans",
  display: "swap",
  fallback: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
  // Single quotes: next/font serializes this into a query string and a
  // double-quoted "opsz" breaks that parse.
  declarations: [{ prop: "font-variation-settings", value: "'opsz' 32" }],
});

/**
 * Geist Mono (OFL, see src/fonts/GeistMono-OFL.txt) for genuine code and
 * identifier surfaces only (code, kbd, pre, .font-mono). Not preloaded: most
 * admin screens never render it.
 */
export const adminMono = localFont({
  src: [{ path: "../fonts/GeistMono-Variable.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-admin-mono",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});
