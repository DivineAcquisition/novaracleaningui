// Best-effort copy of an email unsubscribe into GoHighLevel.
// Only the Email do-not-disturb flag is set. Text status is left alone.
// If GHL is not configured, the shared list is still the source of truth.

export async function notifyGhlEmailDnd(email: string): Promise<void> {
  const token = process.env.GHL_PIT_TOKEN || "";
  const locationId = process.env.GHL_LOCATION_ID || "";
  if (!token || !locationId || !email) return;
  try {
    const headers = {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
    };
    const found = await fetch(
      `https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(email)}`,
      { headers },
    );
    const body = await found.json().catch(() => ({}));
    const contacts = (body?.contacts || []) as Array<{ id?: string; email?: string }>;
    const match = (Array.isArray(contacts) ? contacts : []).find((row) => String(row.email || "").toLowerCase() === email.toLowerCase());
    if (!match?.id) return;
    await fetch(`https://services.leadconnectorhq.com/contacts/${match.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        dndSettings: { Email: { status: "active", message: "Unsubscribed", code: "103" } },
      }),
    });
  } catch {
    /* The shared suppression row already exists. */
  }
}
