"use client";

import { useState } from "react";
import { RiFileTextLine, RiLoader4Line } from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { factualSummaryAvailable } from "@/lib/qc-factual-summary";

interface GeneratedDoc {
  id?: string;
  generated_at?: string | null;
  generated_by?: string | null;
  pdf_status?: string | null;
  pdf_error?: string | null;
  disclaimer?: string | null;
}

export default function QcFactualSummary({
  issue,
  onSaved,
}: {
  issue: {
    id: string;
    status?: string | null;
    escalation?: { indicated?: unknown } | null;
    generated_case_documents?: GeneratedDoc[] | null;
  };
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const available = factualSummaryAvailable({
    status: issue.status,
    escalation: { indicated: issue.escalation?.indicated === true },
  });
  if (!available) return null;
  const docs = Array.isArray(issue.generated_case_documents) ? issue.generated_case_documents : [];

  const generate = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("qc-issues", {
        body: { action: "generate_factual_summary", issueId: issue.id },
      });
      if (error) throw error;
      const payload = data as { ok?: boolean; error?: string; signedUrl?: string | null; pdfStatus?: string };
      if (payload?.ok === false) throw new Error(payload.error || "Could not generate the summary");
      if (payload.signedUrl) window.open(payload.signedUrl, "_blank", "noopener,noreferrer");
      toast.success(payload.pdfStatus === "failed"
        ? "Summary saved on the case. The PDF file did not store."
        : "Factual summary saved on this case.");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate the summary");
    } finally {
      setBusy(false);
    }
  };

  const openDoc = async (documentId: string) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("qc-issues", {
        body: { action: "open_factual_summary", issueId: issue.id, documentId },
      });
      if (error) throw error;
      const payload = data as { ok?: boolean; error?: string; signedUrl?: string };
      if (payload?.ok === false || !payload.signedUrl) throw new Error(payload.error || "Could not open that summary");
      window.open(payload.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open that summary");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-300 bg-white p-4 space-y-3">
      <p className="text-sm font-bold text-slate-900">Factual summary and evidence index</p>
      <p className="text-xs text-slate-600">
        Assembled from the entries already logged on this case. It does not add a conclusion.
        The standing disclaimer is part of every generated file.
      </p>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void generate()}>
        {busy ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin mr-1" /> : <RiFileTextLine className="w-3.5 h-3.5 mr-1" />}
        Generate Factual Summary & Evidence Index
      </Button>
      <div className="space-y-1">
        {docs.map((doc) => (
          <div key={doc.id || doc.generated_at || "summary"} className="text-xs text-slate-600 flex flex-wrap items-center gap-2">
            <span>
              {doc.generated_at ? new Date(doc.generated_at).toLocaleString() : "time not stored"}
              {" · "}
              {doc.generated_by || "admin"}
              {" · "}
              {doc.pdf_status === "generated" ? "PDF stored" : doc.pdf_status === "failed" ? "PDF not stored" : "record stored"}
            </span>
            {doc.id && doc.pdf_status === "generated" && (
              <button type="button" className="text-slate-800 underline" onClick={() => void openDoc(doc.id || "")}>
                Open
              </button>
            )}
          </div>
        ))}
        {docs.length === 0 && <p className="text-xs text-slate-500">None generated yet.</p>}
      </div>
    </div>
  );
}
