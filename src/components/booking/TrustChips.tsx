// Small reassurance row under a booking form: the guarantee, the checklist,
// the price rule, and a phone number for anyone who would rather talk.
// Every line is something the booking code enforces.

import { RiListCheck2, RiPhoneLine, RiPriceTag3Line, RiRefreshLine } from "@/components/icons";
import { INBOUND_PHONE } from "@/config/brand-config";
import { cn } from "@/lib/utils";

const CHIPS = [
  { icon: RiPriceTag3Line, label: "The price shown is the price charged" },
  { icon: RiListCheck2, label: "Written checklist every visit" },
  { icon: RiRefreshLine, label: "48-hour re-clean guarantee" },
];

export function TrustChips({ className, call = true }: { className?: string; call?: boolean }) {
  return (
    <div className={cn("space-y-3 text-center", className)}>
      <ul className="flex flex-wrap items-center justify-center gap-2">
        {CHIPS.map(({ icon: Icon, label }) => (
          <li key={label} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground">
            <Icon className="h-3.5 w-3.5 text-primary" />
            {label}
          </li>
        ))}
      </ul>
      {call ? (
        <p className="text-sm text-muted-foreground">
          Prefer to talk?{" "}
          <a href={INBOUND_PHONE.tel} className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline">
            <RiPhoneLine className="h-4 w-4 text-primary" />
            Call {INBOUND_PHONE.display}
          </a>
        </p>
      ) : null}
    </div>
  );
}
