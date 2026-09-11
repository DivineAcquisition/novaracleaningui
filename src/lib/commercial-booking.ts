// Which bookings belong on the Commercial tab.
//
// The Bookings tab is every job. Commercial is the same control center
// filtered to commercial / office / partnership work. STR turnovers stay
// out — they are a different product.

export function isCommercialBookingRow(row: {
  booking_type?: string | null;
  service_type?: string | null;
  booking_channel?: string | null;
  business_account_id?: string | null;
  business_name?: string | null;
}): boolean {
  const type = String(row.booking_type || "").toLowerCase();
  if (type === "str_turnover") return false;
  if (["commercial", "office", "partnership"].includes(type)) return true;
  if (String(row.service_type || "").toLowerCase() === "commercial") return true;
  if (String(row.booking_channel || "") === "admin_commercial") return true;
  if (row.business_account_id) return true;
  if (String(row.business_name || "").trim()) return true;
  return false;
}
