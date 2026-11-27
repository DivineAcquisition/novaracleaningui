"use client";

import { adminInter, adminMono } from "@/lib/admin-fonts";

/**
 * Publishes the admin font families as CSS variables on :root, but only while
 * an element marked [data-admin-text] (the admin shell) is in the document.
 * Tailwind's font-sans / font-heading / font-jakarta / font-mono resolve
 * through these variables (tailwind.config.ts), so the same class names keep
 * the public Inter on public pages and switch to Inter Display inside admin —
 * including Radix portals mounted directly under <body>.
 */
export function AdminTypography() {
  const css = `:root:has([data-admin-text]){--font-ui:${adminInter.style.fontFamily};--font-ui-mono:${adminMono.style.fontFamily};}`;
  return <style data-admin-typography dangerouslySetInnerHTML={{ __html: css }} />;
}
