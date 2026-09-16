// Customer accounts are created only after a booking is marked completed.
// Quotes, checkouts, VA bookings, memberships, and portal sign-in must not
// insert into public.customers — those people have not completed a service.

import { isStaffCustomerEmail } from "./staff-customer.ts";

export type CompletedBookingCustomerInput = {
  id?: string | null;
  customer_id?: string | null;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export function customerRowFromCompletedBooking(booking: CompletedBookingCustomerInput) {
  const email = String(booking.email || "").trim().toLowerCase();
  return {
    email,
    first_name: String(booking.first_name || "").trim(),
    last_name: String(booking.last_name || "").trim(),
    phone: booking.phone || null,
    address: booking.address || null,
    city: booking.city || null,
    state: booking.state || null,
    zip: booking.zip_code || null,
    lat: booking.lat ?? null,
    lng: booking.lng ?? null,
  };
}

/**
 * Upsert a `customers` row from a completed booking and stamp
 * bookings.customer_id when it is still empty. Generates a referral code
 * on first insert. Never creates staff-email accounts.
 */
export async function ensureCustomerFromCompletedBooking(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  booking: CompletedBookingCustomerInput,
): Promise<{ customerId: string | null; created: boolean }> {
  const row = customerRowFromCompletedBooking(booking);
  if (!row.email) return { customerId: null, created: false };
  if (await isStaffCustomerEmail(supabase, row.email)) {
    return { customerId: null, created: false };
  }

  const { data: existing } = await supabase
    .from("customers")
    .select("id, referral_code")
    .eq("email", row.email)
    .maybeSingle();

  let customerId: string | null = existing?.id || null;
  let created = false;

  if (!customerId) {
    const { data: inserted, error } = await supabase
      .from("customers")
      .insert(row)
      .select("id")
      .single();
    if (error) {
      const { data: raced } = await supabase
        .from("customers")
        .select("id")
        .eq("email", row.email)
        .maybeSingle();
      if (!raced?.id) throw error;
      customerId = raced.id as string;
    } else {
      customerId = inserted?.id || null;
      created = Boolean(customerId);
    }
  } else {
    const patch: Record<string, unknown> = {};
    if (row.first_name) patch.first_name = row.first_name;
    if (row.last_name) patch.last_name = row.last_name;
    if (row.phone) patch.phone = row.phone;
    if (row.address) patch.address = row.address;
    if (row.city) patch.city = row.city;
    if (row.state) patch.state = row.state;
    if (row.zip) patch.zip = row.zip;
    if (row.lat != null) patch.lat = row.lat;
    if (row.lng != null) patch.lng = row.lng;
    if (Object.keys(patch).length > 0) {
      await supabase.from("customers").update(patch).eq("id", customerId);
    }
  }

  if (customerId && booking.id) {
    // Leave Stripe `cus_…` ids alone — checkout stores those on the booking
    // for billing lookups. Only stamp our customers UUID when the column is
    // empty or already a UUID.
    const current = String(booking.customer_id || "");
    if (!current || !current.startsWith("cus_")) {
      await supabase.from("bookings").update({ customer_id: customerId }).eq("id", booking.id);
    }
  }

  if (customerId && !existing?.referral_code) {
    try {
      await supabase.functions.invoke("generate-referral-code", {
        body: { customerId, email: row.email },
      });
    } catch {
      /* non-blocking */
    }
  }

  return { customerId, created };
}
