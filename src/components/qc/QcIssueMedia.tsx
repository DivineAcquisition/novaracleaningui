"use client";

import { useEffect, useRef, useState } from "react";
import { RiCameraLine, RiCloseCircleLine, RiLoader4Line, RiPlayCircleLine } from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { MediaThumb } from "@/components/job-media/MediaThumb";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { QC_ISSUE_MEDIA_BUCKET, QC_ISSUE_MEDIA_MAX_FILES, type QcIssueMediaFile } from "@/lib/qc-issue-media";
import { uploadQcIssueMedia } from "@/lib/qc-issue-media-client";

function useSignedPaths(paths: string[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.join("|");
  useEffect(() => {
    if (!paths.length) {
      setUrls({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(paths.map(async (path) => {
        const { data } = await supabase.storage.from(QC_ISSUE_MEDIA_BUCKET).createSignedUrl(path, 3600);
        if (data?.signedUrl) next[path] = data.signedUrl;
      }));
      if (!cancelled) setUrls(next);
    })();
    return () => { cancelled = true; };
  }, [key]);
  return urls;
}

export function QcIssueMediaGrid({
  files,
  httpUrls,
  onRemove,
  emptyHint,
}: {
  files: QcIssueMediaFile[];
  httpUrls?: string[];
  onRemove?: (id: string) => void;
  emptyHint?: string;
}) {
  const signed = useSignedPaths(files.map((f) => f.storagePath));
  const extras = (httpUrls || []).filter((u) => u.startsWith("http"));
  if (files.length === 0 && extras.length === 0) {
    return emptyHint ? <p className="text-xs text-slate-500">{emptyHint}</p> : null;
  }
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {files.map((f) => {
        const url = signed[f.storagePath];
        return (
          <div key={f.id} className="relative group">
            {url ? (
              <a href={url} target="_blank" rel="noreferrer" className="block">
                <MediaThumb url={url} alt={f.filename} className="w-full h-16 object-cover rounded-md border border-slate-200" />
                {f.kind === "video" && (
                  <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <RiPlayCircleLine className="w-6 h-6 text-white drop-shadow" />
                  </span>
                )}
              </a>
            ) : (
              <div className="w-full h-16 rounded-md border border-slate-200 bg-slate-100 flex items-center justify-center">
                <RiLoader4Line className="w-4 h-4 animate-spin text-slate-400" />
              </div>
            )}
            <span className="absolute bottom-0.5 left-0.5 text-[9px] font-bold bg-black/60 text-white px-1 rounded">
              {f.kind === "video" ? "Video" : "Photo"}
            </span>
            {onRemove && (
              <button
                type="button"
                className="absolute top-0.5 right-0.5 rounded-full bg-black/70 text-white p-0.5 opacity-0 group-hover:opacity-100"
                title="Remove from this case"
                onClick={() => onRemove(f.id)}
              >
                <RiCloseCircleLine className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        );
      })}
      {extras.map((u, i) => (
        <a key={`http-${i}`} href={u} target="_blank" rel="noreferrer" className="relative">
          <MediaThumb url={u} alt="Case media" className="w-full h-16 object-cover rounded-md border border-slate-200" />
        </a>
      ))}
    </div>
  );
}

export function QcIssueMediaPicker({
  issueId,
  token,
  attached,
  onChange,
  disabled,
  className,
}: {
  issueId?: string;
  token?: string;
  attached: QcIssueMediaFile[];
  onChange: (next: QcIssueMediaFile[]) => void;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (list: FileList | null) => {
    if (!list?.length || disabled) return;
    const remaining = QC_ISSUE_MEDIA_MAX_FILES - attached.length;
    if (remaining <= 0) {
      toast.error(`A case can hold ${QC_ISSUE_MEDIA_MAX_FILES} photos or videos.`);
      return;
    }
    setBusy(true);
    const next = [...attached];
    try {
      for (const file of Array.from(list).slice(0, remaining)) {
        const uploaded = await uploadQcIssueMedia({ file, issueId, token });
        next.push(uploaded);
        onChange([...next]);
        toast.success(uploaded.kind === "video" ? "Video attached." : "Photo attached.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add that file");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => void pick(e.target.files)}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8"
        disabled={disabled || busy || attached.length >= QC_ISSUE_MEDIA_MAX_FILES}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <RiCameraLine className="w-3.5 h-3.5 mr-1.5" />}
        Add photos or videos
      </Button>
      {attached.length > 0 && !issueId && (
        <ul className="text-[11px] text-slate-600 space-y-0.5">
          {attached.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{f.kind === "video" ? "Video" : "Photo"} · {f.filename.replace(/^[a-z0-9]+-/, "")}</span>
              <button
                type="button"
                className="text-slate-400 hover:text-rose-600"
                onClick={() => onChange(attached.filter((x) => x.id !== f.id))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
