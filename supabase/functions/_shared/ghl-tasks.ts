// GHL contact tasks (PIT) — follow-up when cleaners are assigned to a booking.

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

function log(step: string, details?: unknown) {
  console.log(`[GHL-TASK] ${step}${details ? ` ${JSON.stringify(details)}` : ""}`);
}

function readGhlConfig(): { token: string; locationId: string } | null {
  const token = (Deno.env.get("GHL_PIT_TOKEN") || "").trim();
  const locationId = (Deno.env.get("GHL_LOCATION_ID") || "").trim();
  if (!token || !locationId) return null;
  return { token, locationId };
}

export async function createContactTask(
  contactId: string,
  task: {
    title: string;
    body?: string;
    dueDate?: string;
    completed?: boolean;
    assignedTo?: string;
  },
): Promise<{ taskId: string | null; error?: string }> {
  const cfg = readGhlConfig();
  if (!cfg || !contactId) {
    return { taskId: null, error: "GHL not configured or missing contactId" };
  }
  try {
    const body: Record<string, unknown> = {
      title: task.title,
      body: task.body || "",
      completed: task.completed ?? false,
    };
    if (task.dueDate) body.dueDate = task.dueDate;
    const assignee = task.assignedTo || (Deno.env.get("GHL_TASK_ASSIGNEE_USER_ID") || "").trim();
    if (assignee) body.assignedTo = assignee;

    const res = await fetch(`${GHL_BASE}/contacts/${encodeURIComponent(contactId)}/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Version: GHL_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      log("create failed", { status: res.status, body: text.slice(0, 300) });
      return { taskId: null, error: text.slice(0, 200) };
    }
    let parsed: any = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      /* ignore */
    }
    const taskId = parsed?.task?.id || parsed?.id || null;
    log("created", { contactId, taskId });
    return { taskId };
  } catch (e) {
    return { taskId: null, error: e instanceof Error ? e.message : String(e) };
  }
}
