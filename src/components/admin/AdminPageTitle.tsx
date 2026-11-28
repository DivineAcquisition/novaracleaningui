import { navTitle } from "@/components/admin/admin-nav";
import { cn } from "@/lib/utils";

/**
 * A screen's title, taken from the sidebar (admin-nav.ts) so the two can't drift apart. Selestial's page
 * title style: heading face, 24px, tight tracking, ink colour, medium weight.
 */
export function AdminPageTitle({ id, className }: { id: string; className?: string }) {
  return <h1 className={cn("font-heading text-2xl tracking-tight break-words text-slate-900", className)}>{navTitle(id)}</h1>;
}
