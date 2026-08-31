// Public customer checklist URLs on try.novaracleaning.com.
// Keep in lock-step with src/lib/checklists.ts checklistPathForServiceType.

const BASE = "https://try.novaracleaning.com/checklist";

function norm(value: string | null | undefined): string {
  return String(value || "").toLowerCase().replace(/[\s-]/g, "_");
}

function commercialSlug(scopeLevel?: string | null): string {
  const key = norm(scopeLevel);
  if (key === "light") return "commercial-light";
  if (key === "detailed") return "commercial-detailed";
  return "commercial-standard";
}

export function publicChecklistPath(
  serviceType?: string | null,
  scopeLevel?: string | null,
): string {
  const t = norm(serviceType);
  if (t === "office") return "/checklist/office";
  if (
    t === "commercial" ||
    t === "commercial_light" ||
    t === "commercial_standard" ||
    t === "commercial_detailed" ||
    t === "light" ||
    t === "detailed" ||
    t === "retail" ||
    t === "warehouse" ||
    t === "restaurant" ||
    t === "gym" ||
    t === "medical" ||
    t === "business"
  ) {
    const fromType = t.replace(/^commercial_?/, "");
    const knownScope = fromType === "light" || fromType === "detailed" || fromType === "standard"
      ? fromType
      : scopeLevel;
    return `/checklist/${commercialSlug(knownScope)}`;
  }
  if (t === "deep" || t === "combo") return "/checklist/deep-clean";
  if (t === "moveinout" || t === "move_in_out") return "/checklist/move-in-out";
  if (
    t === "membership" ||
    t === "weekly" ||
    t === "biweekly" ||
    t === "monthly" ||
    t === "recurring"
  ) {
    return "/checklist/recurring";
  }
  if (t === "turnover" || t === "str_turnover" || t === "str") {
    return "/checklist";
  }
  return "/checklist/standard-clean";
}

export function publicChecklistUrl(
  serviceType?: string | null,
  scopeLevel?: string | null,
): string {
  return `https://try.novaracleaning.com${publicChecklistPath(serviceType, scopeLevel)}`;
}

export { BASE as PUBLIC_CHECKLIST_BASE };
