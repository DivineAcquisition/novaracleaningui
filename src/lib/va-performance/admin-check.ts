// Does this signed-in user hold the full `admin` role?
//
// Used to decide whether someone may act on an EOD for a day other than today.
// A VA arriving through a per-day link is never treated as an admin here — the
// link carries its own date and that is the whole point of it.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

export async function isAdminUser(userId: string): Promise<boolean> {
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    return Boolean(data);
  } catch {
    return false;
  }
}
