import { CheckCircle } from "lucide-react";

export function GoogleGuaranteedBadge() {
  return (
    <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1.5 rounded-full text-sm font-medium">
      <CheckCircle className="h-4 w-4" />
      <span>Google Guaranteed</span>
    </div>
  );
}
