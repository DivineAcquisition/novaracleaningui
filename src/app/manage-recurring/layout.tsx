import type { ReactNode } from "react";

// Customer self-service pages use the booking theme so they match the public site.
export default function Layout({ children }: { children: ReactNode }) {
  return <div className="book-theme min-h-screen bg-background font-sans text-foreground antialiased">{children}</div>;
}
