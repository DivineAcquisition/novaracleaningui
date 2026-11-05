import type { ReactNode } from "react";

// Every /book step renders inside the booking theme: the landing page's
// palette, type, and surfaces, applied through the shared CSS variables so
// each step keeps its own layout and flow.
export default function BookLayout({ children }: { children: ReactNode }) {
  return <div className="book-theme min-h-screen bg-background font-sans text-foreground antialiased">{children}</div>;
}
