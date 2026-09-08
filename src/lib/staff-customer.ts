import { supabase } from "@/integrations/supabase/client";

export const ADMIN_AUTH_URL = "https://admin.novaracleaning.com/admin/auth";

export const STAFF_CUSTOMER_ERROR =
  "Staff (admin/VA) emails cannot have customer accounts. Use the admin workspace.";

export function looksLikeNovaraStaffEmail(email: string | null | undefined): boolean {
  return /@novaracleaning\.com$/i.test(String(email || "").trim());
}

export async function isStaffCustomerEmail(email: string | null | undefined): Promise<boolean> {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized.includes("@")) return false;
  if (looksLikeNovaraStaffEmail(normalized)) return true;
  const { data, error } = await supabase.rpc("is_staff_customer_email", {
    _email: normalized,
  });
  if (error) {
    console.warn("[staff-customer] rpc failed", error.message);
    return false;
  }
  return data === true;
}
