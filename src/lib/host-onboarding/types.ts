// ─── STR Host Onboarding — shared types + validation ──────────────────────

export type EntityType = "individual" | "entity";

export interface OnboardingPropertyInput {
  nickname: string;
  address: string;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  linen?: boolean;
  restock?: boolean;
  accessType?: string;
  accessInstructions?: string;
  stagingNotes?: string;
}

export interface OnboardingFormPayload {
  fullName: string;
  email: string;
  phone: string;
  entityType: EntityType;
  entityName?: string;
  serviceZone?: string;
  properties: OnboardingPropertyInput[];
  consentAgreement: boolean;
}

export const SERVICE_ZONES = [
  "Baltimore",
  "Baltimore County",
  "Howard",
  "Anne Arundel",
  "PG County",
  "Montgomery",
  "DC",
  "Northern VA",
  "Other",
] as const;

export const ACCESS_TYPES = ["Lockbox", "Smart Lock", "Key", "In-Person", "Building"] as const;

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Server-side validation. The entity/individual branch is enforced here, not
 * just hidden in the UI (spec §6 guardrail).
 */
export function validateOnboarding(p: Partial<OnboardingFormPayload>): ValidationResult {
  if (!p.fullName?.trim()) return { ok: false, error: "Full name is required." };
  if (!p.email?.trim() || !EMAIL_RE.test(p.email.trim())) return { ok: false, error: "A valid email is required." };
  if (!p.phone?.trim() || p.phone.replace(/\D/g, "").length < 10) return { ok: false, error: "A valid phone is required." };
  if (p.entityType !== "individual" && p.entityType !== "entity") {
    return { ok: false, error: "Select whether you're signing as an individual or a business entity." };
  }
  if (p.entityType === "entity" && !p.entityName?.trim()) {
    return { ok: false, error: "Entity / business name is required for a business entity." };
  }
  if (!Array.isArray(p.properties) || p.properties.length === 0) {
    return { ok: false, error: "Add at least one property." };
  }
  for (const [i, prop] of p.properties.entries()) {
    if (!prop?.nickname?.trim()) return { ok: false, error: `Property ${i + 1}: a nickname is required.` };
    if (!prop?.address?.trim()) return { ok: false, error: `Property ${i + 1}: an address is required.` };
  }
  if (!p.consentAgreement) {
    return { ok: false, error: "You must agree to the Host Partnership Agreement to continue." };
  }
  return { ok: true };
}

/** Normalize a raw payload (trim, coerce numbers, default booleans). */
export function normalizeOnboarding(p: OnboardingFormPayload): OnboardingFormPayload {
  const num = (v: unknown): number | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    fullName: p.fullName.trim(),
    email: p.email.trim().toLowerCase(),
    phone: p.phone.trim(),
    entityType: p.entityType,
    entityName: p.entityType === "entity" ? p.entityName?.trim() || "" : undefined,
    serviceZone: p.serviceZone?.trim() || undefined,
    consentAgreement: !!p.consentAgreement,
    properties: (p.properties || []).map((pr) => ({
      nickname: pr.nickname.trim(),
      address: pr.address.trim(),
      bedrooms: num(pr.bedrooms),
      bathrooms: num(pr.bathrooms),
      sqft: num(pr.sqft),
      linen: !!pr.linen,
      restock: !!pr.restock,
      accessType: pr.accessType?.trim() || undefined,
      accessInstructions: pr.accessInstructions?.trim() || undefined,
      stagingNotes: pr.stagingNotes?.trim() || undefined,
    })),
  };
}
