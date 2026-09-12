import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import {
  QC_ISSUE_MEDIA_BUCKET,
  QC_ISSUE_MEDIA_MAX_FILES,
  mediaKindFor,
  normalizeQcIssueMedia,
  qcIssueMediaStoragePath,
  validateQcIssueMediaFile,
  type QcIssueMediaFile,
} from "@/lib/qc-issue-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  action?: string;
  filename?: string;
  contentType?: string;
  size?: number;
  issueId?: string;
  token?: string;
  path?: string;
  file?: QcIssueMediaFile;
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status });
}

async function actorName(userId: string, email: string): Promise<string> {
  try {
    const admin = getAdminSupabase();
    const { data } = await admin.auth.admin.getUserById(userId);
    const meta = data?.user?.user_metadata || {};
    return String(meta.full_name || meta.name || email || "Team");
  } catch {
    return email || "Team";
  }
}

async function isFullAdmin(userId: string): Promise<boolean> {
  const admin = getAdminSupabase();
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
  return (roles || []).some((r: { role: string }) => r.role === "admin");
}

async function bookingFromFieldToken(token: string): Promise<{
  bookingId: string;
  cleanerName: string;
} | null> {
  const admin = getAdminSupabase();
  const { data: assignment } = await (admin.from as any)("job_assignments")
    .select("job_id, cleaners(first_name, last_name)")
    .eq("response_token", token)
    .maybeSingle();
  if (!assignment?.job_id) return null;
  const { data: booking } = await admin
    .from("bookings")
    .select("id")
    .eq("job_id", assignment.job_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!booking?.id) return null;
  const c = Array.isArray(assignment.cleaners) ? assignment.cleaners[0] : assignment.cleaners;
  const cleanerName = c
    ? `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner"
    : "Cleaner";
  return { bookingId: booking.id, cleanerName };
}

async function loadIssueForAdmin(issueId: string, fullAdmin: boolean) {
  const admin = getAdminSupabase();
  const { data: issue } = await (admin.from as any)("qc_issues")
    .select("id, booking_id, admin_only, issue_type, evidence_files")
    .eq("id", issueId)
    .maybeSingle();
  if (!issue) return { error: "Issue not found.", status: 404 as const };
  if ((issue.admin_only || issue.issue_type === "serious_allegation") && !fullAdmin) {
    return { error: "Admins only.", status: 403 as const };
  }
  return { issue };
}

async function objectExists(path: string): Promise<boolean> {
  const admin = getAdminSupabase();
  const parts = path.split("/");
  const name = parts.pop();
  const folder = parts.join("/");
  if (!name) return false;
  const { data } = await admin.storage.from(QC_ISSUE_MEDIA_BUCKET).list(folder, { limit: 100 });
  return (data || []).some((o) => o.name === name);
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as Body;
  const action = String(body.action || "").toLowerCase();
  if (action !== "sign" && action !== "commit") {
    return json({ error: "Unknown action." }, 400);
  }

  const token = String(body.token || "").trim();
  const issueId = String(body.issueId || "").trim();
  if (!token && !issueId) return json({ error: "Sign in, or use the job's QC report link." }, 400);

  let via: "admin" | "cleaner_field" = "admin";
  let uploadedByName = "Team";
  let bookingId: string | null = null;
  let resolvedIssueId: string | null = issueId || null;

  if (issueId) {
    try {
      const principal = await requireAdmin(req);
      const fullAdmin = await isFullAdmin(principal.userId);
      const loaded = await loadIssueForAdmin(issueId, fullAdmin);
      if ("error" in loaded && loaded.error) return json({ error: loaded.error }, loaded.status);
      bookingId = loaded.issue.booking_id;
      uploadedByName = await actorName(principal.userId, principal.email);
      const existing = normalizeQcIssueMedia(loaded.issue.evidence_files);
      if (action === "sign" && existing.length >= QC_ISSUE_MEDIA_MAX_FILES) {
        return json({ error: `A case can hold ${QC_ISSUE_MEDIA_MAX_FILES} photos or videos.` }, 400);
      }
    } catch (e) {
      if (e instanceof AdminAuthError) return json({ error: e.message }, e.status);
      throw e;
    }
  } else {
    const field = await bookingFromFieldToken(token);
    if (!field) return json({ error: "This job link isn't valid anymore." }, 404);
    via = "cleaner_field";
    uploadedByName = field.cleanerName;
    bookingId = field.bookingId;
    resolvedIssueId = null;
  }

  if (action === "sign") {
    const filename = String(body.filename || "file");
    const size = Number(body.size) || 0;
    const contentType = String(body.contentType || "") || (mediaKindFor({ name: filename }) === "video" ? "video/mp4" : "image/jpeg");
    const check = validateQcIssueMediaFile({ name: filename, type: contentType, size });
    if (!check.ok) return json({ error: check.error }, 400);

    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    const path = qcIssueMediaStoragePath({
      issueId: resolvedIssueId,
      bookingId,
      filename,
      id,
    });
    const admin = getAdminSupabase();
    const { data, error } = await admin.storage.from(QC_ISSUE_MEDIA_BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token || !data.path) {
      return json({ error: error?.message || "Couldn't start the upload." }, 400);
    }
    const file: QcIssueMediaFile = {
      id,
      filename: path.split("/").pop() || filename,
      contentType,
      size,
      storagePath: data.path,
      kind: check.kind,
      uploadedAt: new Date().toISOString(),
      uploadedByName,
      uploadedVia: via,
    };
    return json({ ok: true, path: data.path, token: data.token, signedUrl: data.signedUrl, file });
  }

  const path = String(body.path || body.file?.storagePath || "");
  const meta = body.file;
  if (!path || !meta?.id) return json({ error: "Upload didn't finish — try that file again." }, 400);
  if (meta.storagePath !== path) return json({ error: "Upload didn't finish — try that file again." }, 400);
  if (resolvedIssueId) {
    if (!path.startsWith(`evidence/issue/${resolvedIssueId}/`)) {
      return json({ error: "That file doesn't belong to this QC case." }, 400);
    }
  } else if (bookingId && !path.startsWith(`evidence/booking/${bookingId}/`)) {
    return json({ error: "That file doesn't belong to this job." }, 400);
  }
  if (!(await objectExists(path))) {
    return json({ error: "Upload didn't reach storage — try that file again." }, 400);
  }

  const file: QcIssueMediaFile = {
    ...meta,
    storagePath: path,
    uploadedAt: meta.uploadedAt || new Date().toISOString(),
    uploadedByName,
    uploadedVia: via,
  };

  if (resolvedIssueId) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    const res = await fetch(`${url}/functions/v1/qc-issues`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: auth,
        apikey: anon || "",
      },
      body: JSON.stringify({ action: "add_evidence", issueId: resolvedIssueId, file }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || (payload as { ok?: boolean }).ok === false) {
      return json({ error: (payload as { error?: string }).error || "Couldn't attach that file to the case." }, res.ok ? 400 : res.status);
    }
    return json({ ok: true, file, issue: (payload as { issue?: unknown }).issue });
  }

  return json({ ok: true, file });
}
