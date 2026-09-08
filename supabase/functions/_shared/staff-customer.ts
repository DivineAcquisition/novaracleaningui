/** Staff (admin / VA) emails must not hold customer-portal accounts. */

export const STAFF_CUSTOMER_ERROR =
  "Staff (admin/VA) emails cannot have customer accounts";

export function looksLikeNovaraStaffEmail(email: string | null | undefined): boolean {
  return /@novaracleaning\.com$/i.test(String(email || "").trim());
}

// deno-lint-ignore no-explicit-any
export async function isStaffCustomerEmail(admin: any, email: string | null | undefined): Promise<boolean> {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized.includes("@")) return false;
  if (looksLikeNovaraStaffEmail(normalized)) return true;
  try {
    const { data, error } = await admin.rpc("is_staff_customer_email", { _email: normalized });
    if (error) {
      console.warn("[staff-customer] rpc failed", error.message);
      return false;
    }
    return data === true;
  } catch (e) {
    console.warn("[staff-customer] rpc exception", e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** Drop a staff customer row only when it has no bookings. */
// deno-lint-ignore no-explicit-any
export async function deleteUnusedStaffCustomerAccount(admin: any, email: string | null | undefined): Promise<boolean> {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized.includes("@")) return false;
  const { data: cust } = await admin
    .from("customers")
    .select("id")
    .ilike("email", normalized)
    .maybeSingle();
  if (!cust?.id) return false;

  const [{ count: byEmail }, { count: byId }] = await Promise.all([
    admin.from("bookings").select("id", { count: "exact", head: true }).ilike("email", normalized),
    admin.from("bookings").select("id", { count: "exact", head: true }).eq("customer_id", cust.id),
  ]);
  if ((byEmail || 0) > 0 || (byId || 0) > 0) {
    console.warn("[staff-customer] leaving customer row with bookings", normalized);
    return false;
  }

  await admin.from("jobs").update({ customer_id: null }).eq("customer_id", cust.id);
  const { error } = await admin.from("customers").delete().eq("id", cust.id);
  if (error) {
    console.warn("[staff-customer] delete failed", error.message);
    return false;
  }
  return true;
}
