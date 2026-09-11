import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  EMPTY_QC_STATEMENT_DRAFT,
  QC_STATEMENT_STORAGE_BUCKET,
  normalizeQcStatementDraft,
  type QcStatementAttachment,
} from "@/lib/qc-statement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = /^(image\/|application\/pdf|application\/octet-stream|text\/plain)/i;

function safeName(name: string): string {
  return String(name || "file")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "file";
}

export async function POST(req: Request, ctx: Ctx): Promise<NextResponse> {
  const token = String((await ctx.params).token || "").trim();
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });
  }
  const supabase = getAdminSupabase();
  const { data: request } = await (supabase.from as any)("qc_statement_requests")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (!request) return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });
  if (request.submitted_at) {
    return NextResponse.json({ error: "This statement is already submitted and cannot be changed." }, { status: 409 });
  }
  const expired = request.token_expires_at && new Date(String(request.token_expires_at)).getTime() < Date.now();
  if (expired) {
    return NextResponse.json({ error: "This statement link has expired." }, { status: 410 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That file is larger than 12 MB." }, { status: 400 });
  }
  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED.test(contentType) && !/\.(jpe?g|png|gif|webp|heic|pdf|txt)$/i.test(file.name)) {
    return NextResponse.json({ error: "Upload a photo, PDF, or screenshot." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = crypto.randomUUID().slice(0, 8);
  const filename = safeName(file.name);
  const storagePath = `statements/${request.issue_id}/${request.id}/${id}-${filename}`;
  const { error: upErr } = await supabase.storage.from(QC_STATEMENT_STORAGE_BUCKET).upload(storagePath, bytes, {
    contentType,
    upsert: false,
  });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

  const attachment: QcStatementAttachment = {
    id,
    filename,
    contentType,
    size: file.size,
    storagePath,
    driveFileId: null,
    uploadedAt: new Date().toISOString(),
  };
  const draft = normalizeQcStatementDraft(request.draft, EMPTY_QC_STATEMENT_DRAFT);
  draft.attachments = [...draft.attachments, attachment].slice(0, 30);
  const now = new Date().toISOString();
  await (supabase.from as any)("qc_statement_requests").update({
    draft,
    last_saved_at: now,
    updated_at: now,
    opened_at: request.opened_at || now,
  }).eq("id", request.id);

  let driveFileId: string | null = null;
  try {
    const { data } = await supabase.functions.invoke("qc-statement-drive", {
      body: {
        action: "upload_one",
        requestId: request.id,
        storagePath,
        filename,
        contentType,
      },
    });
    driveFileId = (data as { driveFileId?: string } | null)?.driveFileId || null;
    if (driveFileId) {
      draft.attachments = draft.attachments.map((a) =>
        a.id === id ? { ...a, driveFileId } : a,
      );
      await (supabase.from as any)("qc_statement_requests").update({ draft, updated_at: now }).eq("id", request.id);
    }
  } catch {
    /* Drive is progressive best-effort; storage already holds the file */
  }

  return NextResponse.json({ ok: true, attachment: { ...attachment, driveFileId }, draft });
}
