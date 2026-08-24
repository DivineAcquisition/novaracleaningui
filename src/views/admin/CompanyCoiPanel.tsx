"use client";

// ─── Our certificate of insurance ──────────────────────────────────────────
//
// Distinct from the client certificates listed below this panel. This is the
// document we attach on signature. Without a current file here, signing
// records a delivery failure instead of sending the PDF.

import { useCallback, useEffect, useState } from "react";
import {
  RiCheckboxCircleFill,
  RiErrorWarningLine,
  RiLoader4Line,
  RiMailSendLine,
  RiShieldCheckLine,
  RiUploadCloud2Line,
} from "@remixicon/react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const COMPANY_COI_BUCKET = "company-coi";

async function api(method: "GET" | "POST", body?: unknown): Promise<Record<string, any>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch("/api/admin/company-coi", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.ok === false) throw new Error(out?.error || `Request failed (${res.status})`);
  return out;
}

export default function CompanyCoiPanel() {
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<Record<string, any> | null>(null);
  const [needsResend, setNeedsResend] = useState<unknown[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [expiration, setExpiration] = useState("");
  const [effective, setEffective] = useState("");
  const [carrier, setCarrier] = useState("");
  const [policy, setPolicy] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const out = await api("GET");
      setCurrent(out.current || null);
      setNeedsResend(out.needsResend || []);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async () => {
    if (!file || !expiration) return;
    setBusy("upload");
    try {
      const ext = (file.name.split(".").pop() || "pdf").toLowerCase().slice(0, 8);
      const key = `general/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from(COMPANY_COI_BUCKET).upload(key, file, {
        cacheControl: "3600",
        contentType: file.type || "application/pdf",
        upsert: false,
      });
      if (error) throw error;
      const out = await api("POST", {
        action: "upload_document",
        documentPath: key,
        documentName: file.name,
        documentSizeBytes: file.size,
        expirationDate: expiration,
        effectiveDate: effective || null,
        carrier: carrier || null,
        policyNumber: policy || null,
      });
      if (out.warning) toast.warning(out.warning);
      else toast.success("Our certificate is on file — it will attach on the next signature.");
      setFile(null);
      setExpiration("");
      setEffective("");
      setCarrier("");
      setPolicy("");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const resend = async () => {
    setBusy("resend");
    try {
      const out = await api("POST", { action: "resend_to_holders" });
      toast.success(`Sent to ${out.sent || 0} client${out.sent === 1 ? "" : "s"}.`);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const expired = Boolean(current?.expired);
  const missing = !current;

  return (
    <Card className={cn(
      "border",
      missing || expired ? "border-amber-300 bg-amber-50/40" : "border-slate-200",
    )}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              <RiShieldCheckLine className="w-4 h-4 text-violet-600" />
              Our certificate of insurance
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Attached as a PDF when a client signs — not a link, those expire. Distinct from the
              client certificates in the list below.
            </p>
          </div>
          {missing || expired ? (
            <Badge className="border-0 bg-amber-100 text-amber-800">
              {missing ? "Not on file" : "Expired"}
            </Badge>
          ) : (
            <Badge className="border-0 bg-emerald-100 text-emerald-800">
              Current through {String(current.expiration_date).slice(0, 10)}
            </Badge>
          )}
        </div>

        {loading ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : current ? (
          <p className="text-xs text-slate-600">
            {current.carrier || "Carrier not recorded"}
            {current.policy_number ? ` · Policy ${current.policy_number}` : ""}
            {typeof current.daysRemaining === "number"
              ? ` · ${current.daysRemaining} day${current.daysRemaining === 1 ? "" : "s"} remaining`
              : ""}
          </p>
        ) : (
          <p className="text-xs text-amber-800 flex items-start gap-1.5">
            <RiErrorWarningLine className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Nothing on file. The next commercial signature will record a delivery failure instead of
            sending the certificate.
          </p>
        )}

        <div className="grid sm:grid-cols-2 gap-2">
          <div className="sm:col-span-2">
            <Label className="text-xs">PDF</Label>
            <Input type="file" accept="application/pdf,.pdf" className="mt-1"
              onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          <div>
            <Label className="text-xs">Expires *</Label>
            <Input type="date" value={expiration} onChange={(e) => setExpiration(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Effective</Label>
            <Input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Carrier</Label>
            <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Policy #</Label>
            <Input value={policy} onChange={(e) => setPolicy(e.target.value)} className="mt-1" />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!file || !expiration || busy !== null} onClick={() => void upload()}>
            {busy === "upload" ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiUploadCloud2Line className="w-4 h-4 mr-1.5" />}
            {current ? "Replace our certificate" : "Upload our certificate"}
          </Button>
          {needsResend.length > 0 && (
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void resend()}>
              {busy === "resend" ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiMailSendLine className="w-4 h-4 mr-1.5" />}
              Resend to {needsResend.length} holder{needsResend.length === 1 ? "" : "s"} of an older copy
            </Button>
          )}
        </div>
        {current && !expired && (
          <p className="text-[11px] text-emerald-700 flex items-center gap-1">
            <RiCheckboxCircleFill className="w-3.5 h-3.5" />
            Signature-time delivery will attach this file.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
