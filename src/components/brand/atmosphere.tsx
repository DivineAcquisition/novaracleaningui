import { cn } from "@/lib/utils";

/** Soft Novara-purple wash behind app and marketing shells. */
export function BrandAtmosphere({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 z-0 overflow-hidden", className)}
    >
      <div
        className="absolute -top-[22%] left-1/2 h-[520px] w-[820px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(92,15,254,0.10) 0%, transparent 70%)",
          filter: "blur(64px)",
        }}
      />
    </div>
  );
}
