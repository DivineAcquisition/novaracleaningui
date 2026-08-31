import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  drainPartnershipQueue,
  loadPartnershipSettings,
  mergePartnershipSettings,
} from "@/lib/partnership-comms/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(req: Request) {
  try {
    return { principal: await requireAdmin(req), failure: null as NextResponse | null };
  } catch (e) {
    const err = e as AdminAuthError;
    return {
      principal: null,
      failure: NextResponse.json({ error: err.message }, { status: err.status || 401 }),
    };
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const { failure } = await guard(req);
  if (failure) return failure;

  const supabase = getAdminSupabase();
  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim().replace(/[,()]/g, "").slice(0, 80);
  const status = String(url.searchParams.get("status") || "").trim();
  const templateKey = String(url.searchParams.get("template_key") || "").trim();
  const channel = String(url.searchParams.get("channel") || "").trim();
  const hostId = String(url.searchParams.get("host_id") || "").trim();
  const accountId = String(url.searchParams.get("account_id") || "").trim();
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 80)));

  let query = supabase
    .from("partnership_messages")
    .select(
      "id, template_key, template_version, role, priority, channel, status, trigger_source, " +
        "recipient_key, to_email, to_phone, subject, error, attempt_count, sent_at, created_at, " +
        "host_id, business_account_id, walkthrough_id, provider, escalated_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);
  if (templateKey) query = query.eq("template_key", templateKey);
  if (channel) query = query.eq("channel", channel);
  if (hostId) query = query.eq("host_id", hostId);
  if (accountId) query = query.eq("business_account_id", accountId);

  if (q) {
    const like = `%${q.replace(/%/g, "")}%`;
    const hostIds: string[] = [];
    const accountIds: string[] = [];
    const { data: hosts } = await supabase
      .from("hosts")
      .select("id")
      .or(`email.ilike.${like},name.ilike.${like},phone.ilike.${like}`)
      .limit(20);
    for (const h of hosts || []) hostIds.push(h.id);
    const { data: accounts } = await supabase
      .from("business_accounts")
      .select("id")
      .or(`email.ilike.${like},business_name.ilike.${like},phone.ilike.${like}`)
      .limit(20);
    for (const a of accounts || []) accountIds.push(a.id);

    const ors = [
      `to_email.ilike.${like}`,
      `to_phone.ilike.${like}`,
      `recipient_key.ilike.${like}`,
      `template_key.ilike.${like}`,
      `trigger_source.ilike.${like}`,
    ];
    if (hostIds.length) ors.push(`host_id.in.(${hostIds.join(",")})`);
    if (accountIds.length) ors.push(`business_account_id.in.(${accountIds.join(",")})`);
    query = query.or(ors.join(","));
  }

  const [{ data: messages, error: msgErr }, { data: templates, error: tplErr }] = await Promise.all([
    query,
    supabase
      .from("partnership_message_templates")
      .select("*")
      .eq("is_current", true)
      .order("key", { ascending: true }),
  ]);
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 400 });
  if (tplErr) return NextResponse.json({ error: tplErr.message }, { status: 400 });

  const settings = await loadPartnershipSettings(supabase);
  return NextResponse.json({
    ok: true,
    messages: messages || [],
    templates: templates || [],
    settings,
  });
}

export async function PUT(req: Request): Promise<NextResponse> {
  const { failure } = await guard(req);
  if (failure) return failure;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const current = await loadPartnershipSettings(supabase);
  const next = mergePartnershipSettings({
    ...current,
    ...((body.settings && typeof body.settings === "object" ? body.settings : body) as object),
  });

  const { error } = await supabase.from("app_settings").upsert(
    {
      key: "partnership_comms_settings",
      value: next,
      description: "Partnership comms: quiet hours, frequency caps, role-based sender identity.",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, settings: next });
}

export async function POST(req: Request): Promise<NextResponse> {
  const { principal, failure } = await guard(req);
  if (failure) return failure;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const action = String(body.action || "");

  if (action === "drain") {
    const result = await drainPartnershipQueue(supabase, 50);
    return NextResponse.json({ ok: true, ...result });
  }

  if (action !== "publish_template") {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  const tpl = (body.template && typeof body.template === "object" ? body.template : body) as Record<string, unknown>;
  const key = String(tpl.key || "").trim();
  if (!key) return NextResponse.json({ error: "Template key is required." }, { status: 400 });

  const { data: current } = await supabase
    .from("partnership_message_templates")
    .select("*")
    .eq("key", key)
    .eq("is_current", true)
    .maybeSingle();

  const nextVersion = Number(current?.version || 0) + 1;
  const channels = Array.isArray(tpl.channels) && tpl.channels.length
    ? tpl.channels
    : current?.channels || ["email"];

  if (current?.id) {
    const { error: demoteErr } = await supabase
      .from("partnership_message_templates")
      .update({ is_current: false })
      .eq("id", current.id);
    if (demoteErr) return NextResponse.json({ error: demoteErr.message }, { status: 400 });
  }

  const { data: inserted, error } = await supabase
    .from("partnership_message_templates")
    .insert({
      key,
      version: nextVersion,
      is_current: true,
      role: String(tpl.role || current?.role || "partner"),
      priority: String(tpl.priority || current?.priority || "standard"),
      channels,
      subject: tpl.subject != null ? String(tpl.subject) : current?.subject || null,
      html: tpl.html != null ? String(tpl.html) : current?.html || null,
      sms_body: tpl.sms_body != null ? String(tpl.sms_body) : current?.sms_body || null,
      description: tpl.description != null ? String(tpl.description) : current?.description || null,
      created_by_name: principal?.email || principal?.userId || null,
    })
    .select("*")
    .maybeSingle();

  if (error) {
    if (current?.id) {
      await supabase.from("partnership_message_templates").update({ is_current: true }).eq("id", current.id);
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, template: inserted });
}
