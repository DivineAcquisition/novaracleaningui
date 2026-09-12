"use client";

import { supabase } from "@/integrations/supabase/client";
import {
  QC_ISSUE_MEDIA_BUCKET,
  validateQcIssueMediaFile,
  type QcIssueMediaFile,
} from "@/lib/qc-issue-media";

async function authHeaders(issueId?: string): Promise<Record<string, string>> {
  if (!issueId) return { "Content-Type": "application/json" };
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function parseErr(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return (data as { error?: string }).error || `Upload failed (${res.status})`;
}

/** Direct-to-storage upload (signed URL) so videos aren't capped by the app host's body limit. */
export async function uploadQcIssueMedia(opts: {
  file: File;
  issueId?: string;
  token?: string;
}): Promise<QcIssueMediaFile> {
  const check = validateQcIssueMediaFile({
    name: opts.file.name,
    type: opts.file.type,
    size: opts.file.size,
  });
  if (check.ok === false) throw new Error(check.error);

  const headers = await authHeaders(opts.issueId);
  const signRes = await fetch("/api/qc/issue-media", {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "sign",
      filename: opts.file.name,
      contentType: opts.file.type || (check.kind === "video" ? "video/mp4" : "image/jpeg"),
      size: opts.file.size,
      issueId: opts.issueId,
      token: opts.token,
    }),
  });
  if (!signRes.ok) throw new Error(await parseErr(signRes));
  const sign = await signRes.json() as {
    path: string;
    token: string;
    signedUrl?: string;
    file: QcIssueMediaFile;
  };

  if (sign.signedUrl) {
    const put = await fetch(sign.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": sign.file.contentType || "application/octet-stream" },
      body: opts.file,
    });
    if (!put.ok) throw new Error("Upload failed — try a smaller clip or another file.");
  } else {
    const { error: upErr } = await supabase.storage
      .from(QC_ISSUE_MEDIA_BUCKET)
      .uploadToSignedUrl(sign.path, sign.token, opts.file);
    if (upErr) throw new Error(upErr.message || "Upload failed");
  }

  const commitRes = await fetch("/api/qc/issue-media", {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "commit",
      path: sign.path,
      issueId: opts.issueId,
      token: opts.token,
      file: sign.file,
    }),
  });
  if (!commitRes.ok) throw new Error(await parseErr(commitRes));
  const commit = await commitRes.json() as { file: QcIssueMediaFile };
  return commit.file;
}
