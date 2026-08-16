import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

export async function resolveBookingAgreementSecret(): Promise<string> {
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase.from("app_secrets").select("value").eq("key", "BOOKING_AGREEMENT_SECRET").maybeSingle();
    if (data?.value) return String(data.value).trim();
  } catch {
    /* fall through */
  }
  return (process.env.BOOKING_AGREEMENT_SECRET || "").trim();
}

export function providedBookingAgreementSecret(req: Request): string {
  return new URL(req.url).searchParams.get("secret") || req.headers.get("x-booking-secret") || "";
}

export async function hasBookingAgreementSecret(req: Request): Promise<boolean> {
  const expected = await resolveBookingAgreementSecret();
  const provided = providedBookingAgreementSecret(req);
  return Boolean(expected && provided && provided === expected);
}
