"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { describeEdgeError } from "@/lib/edge-invoke";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Preview = {
  taxYear: number;
  jobPayCents: number;
  tipCents: number;
  combinedCents: number;
  eligible: boolean;
  box1aCents: number | null;
  box1bCents: number | null;
  box1cCodes: string[] | null;
  box1dCents: null;
  box3Cents: null;
  w9: { validated: boolean; legalName?: string; tinMasked?: string };
  payerReady: boolean;
  payer?: {
    name: string;
    tin: string;
    street: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
  };
  ttoc: { codes: string[]; confirmed: boolean };
  blockers: string[];
  original: { id: string; created_at: string } | null;
  corrections: { id: string; created_at: string }[];
};

function money(cents: number | null | undefined): string {
  if (cents == null) return "Blank";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

async function invoke(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("nec-1099", { body });
  if (error) throw new Error(await describeEdgeError(error, data));
  const payload = (data || {}) as Record<string, unknown>;
  if (payload.error) throw new Error(String(payload.error));
  return payload;
}

function downloadPdf(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function Nec1099Panel({ cleanerId }: { cleanerId: string }) {
  const [year, setYear] = useState(2026);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [w9, setW9] = useState({
    legalName: "",
    tin: "",
    tinType: "ssn",
    street: "",
    city: "",
    state: "",
    zip: "",
  });
  const [payer, setPayer] = useState({
    name: "NovaraCleaning LLC",
    tin: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    phone: "",
  });
  const [ttoc, setTtoc] = useState("");
  const [ttocConfirmed, setTtocConfirmed] = useState(false);
  const [showW9, setShowW9] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await invoke({ action: "preview", cleanerId, taxYear: year })) as unknown as Preview;
      setPreview(data);
      setLoadError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not preview the 1099.";
      setPreview(null);
      setLoadError(
        /cleaner_w9|schema cache/i.test(message)
          ? "The W-9 table is not on this database yet, so the 1099 section cannot load. The rest of this contractor record is unaffected."
          : message,
      );
    } finally {
      setLoading(false);
    }
  }, [cleanerId, year]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!preview?.payer) return;
    setPayer(preview.payer);
    setTtoc((preview.ttoc?.codes || []).join(", "));
    setTtocConfirmed(preview.ttoc?.confirmed === true);
  }, [preview]);

  const openCopy = async (formId: string, copy: "B" | "C") => {
    setBusy(true);
    try {
      const data = await invoke({ action: "open", formId, copy });
      downloadPdf(String(data.pdf || ""), String(data.filename || `1099-NEC-Copy-${copy}.pdf`));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open the form.");
    } finally {
      setBusy(false);
    }
  };

  const saveW9 = async () => {
    setBusy(true);
    try {
      await invoke({ action: "save_w9", cleanerId, ...w9 });
      toast.success("Validated W-9 saved. The form reads it from there.");
      setW9((prev) => ({ ...prev, tin: "" }));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the W-9.");
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    setBusy(true);
    try {
      const codes = ttoc.split(/[\s,]+/).map((code) => code.trim()).filter(Boolean);
      await invoke({
        action: "save_settings",
        payer,
        ttoc: { codes, confirmed: ttocConfirmed },
      });
      toast.success("Filing settings saved.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save filing settings.");
    } finally {
      setBusy(false);
    }
  };

  const generate = async (corrected: boolean) => {
    setBusy(true);
    try {
      const data = await invoke({
        action: corrected ? "correct" : "generate",
        cleanerId,
        taxYear: year,
        originalId: preview?.original?.id,
      });
      toast.success(data.alreadyFiled ? "Original filing left unchanged." : corrected ? "Corrected 1099 filed as a new record." : "Copy B and Copy C filed.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not file the 1099.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700 space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">Form 1099-NEC</p>
          <p className="text-slate-500">December 2026 revision. Copy B and Copy C only.</p>
        </div>
        <div className="w-24">
          <Label htmlFor="nec-year" className="text-[10px] text-slate-500">Calendar year</Label>
          <Input id="nec-year" value={String(year)} onChange={(event) => setYear(Number(event.target.value) || year)} />
        </div>
      </div>

      {loading && !preview ? <p className="text-slate-500">Reading the pay ledger and tips…</p> : null}
      {loadError ? <p className="text-amber-800">{loadError}</p> : null}

      {preview ? (
        <div className="space-y-1">
          <p>Box 1a nonemployee compensation {money(preview.box1aCents)} (job pay {money(preview.jobPayCents)} plus tips).</p>
          <p>Box 1b cash tips {money(preview.box1bCents)}.</p>
          <p>Box 1c occupation code {preview.box1cCodes?.length ? preview.box1cCodes.join(", ") : "Blank"}.</p>
          <p>Box 1d overtime compensation Blank. Box 3 excess golden parachute payments Blank.</p>
          <p>Combined for the $2,000 threshold: {money(preview.combinedCents)}. {preview.eligible ? "At or above the threshold." : "Under the threshold."}</p>
          {preview.w9.validated ? (
            <p>W-9 on file for {preview.w9.legalName}. TIN {preview.w9.tinMasked}.</p>
          ) : (
            <p>No validated W-9 on file.</p>
          )}
          {preview.blockers.map((blocker) => (
            <p key={blocker} className="text-amber-800">{blocker}</p>
          ))}
        </div>
      ) : null}

      {preview && (!preview.w9.validated || showW9) ? (
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Legal name on the W-9" value={w9.legalName} onChange={(event) => setW9({ ...w9, legalName: event.target.value })} />
          <Input placeholder="TIN" value={w9.tin} onChange={(event) => setW9({ ...w9, tin: event.target.value })} />
          <select className="h-9 rounded-md border border-slate-200 px-2" value={w9.tinType} onChange={(event) => setW9({ ...w9, tinType: event.target.value })}>
            <option value="ssn">SSN</option>
            <option value="ein">EIN</option>
            <option value="itin">ITIN</option>
          </select>
          <Input placeholder="Street" value={w9.street} onChange={(event) => setW9({ ...w9, street: event.target.value })} />
          <Input placeholder="City" value={w9.city} onChange={(event) => setW9({ ...w9, city: event.target.value })} />
          <Input placeholder="State" value={w9.state} onChange={(event) => setW9({ ...w9, state: event.target.value })} />
          <Input placeholder="ZIP" value={w9.zip} onChange={(event) => setW9({ ...w9, zip: event.target.value })} />
          <Button type="button" variant="outline" disabled={busy} onClick={() => void saveW9()}>Save validated W-9</Button>
        </div>
      ) : null}

      {preview && (showSettings || !preview.payerReady || (preview.tipCents > 0 && !preview.ttoc.confirmed)) ? (
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Payer name" value={payer.name} onChange={(event) => setPayer({ ...payer, name: event.target.value })} />
          <Input placeholder="Payer EIN" value={payer.tin} onChange={(event) => setPayer({ ...payer, tin: event.target.value })} />
          <Input placeholder="Payer street" value={payer.street} onChange={(event) => setPayer({ ...payer, street: event.target.value })} />
          <Input placeholder="Payer city" value={payer.city} onChange={(event) => setPayer({ ...payer, city: event.target.value })} />
          <Input placeholder="Payer state" value={payer.state} onChange={(event) => setPayer({ ...payer, state: event.target.value })} />
          <Input placeholder="Payer ZIP" value={payer.zip} onChange={(event) => setPayer({ ...payer, zip: event.target.value })} />
          <Input placeholder="Payer phone" value={payer.phone} onChange={(event) => setPayer({ ...payer, phone: event.target.value })} />
          <Input placeholder="Occupation code" value={ttoc} onChange={(event) => setTtoc(event.target.value)} />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={ttocConfirmed} onChange={(event) => setTtocConfirmed(event.target.checked)} />
            Accountant confirmed this code
          </label>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void saveSettings()}>Save filing settings</Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {preview?.w9.validated ? (
          <Button type="button" variant="outline" onClick={() => setShowW9((open) => !open)}>Replace W-9</Button>
        ) : null}
        <Button type="button" variant="outline" onClick={() => setShowSettings((open) => !open)}>Payer and occupation code</Button>
        <Button type="button" variant="outline" disabled={busy || !preview || preview.blockers.length > 0 || Boolean(preview?.original)} onClick={() => void generate(false)}>
          Generate Copy B and Copy C
        </Button>
        {preview?.original ? (
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void openCopy(preview.original!.id, "B")}>Original Copy B</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void openCopy(preview.original!.id, "C")}>Original Copy C</Button>
            <Button type="button" variant="outline" disabled={busy || preview.blockers.some((blocker) => !blocker.includes("threshold"))} onClick={() => void generate(true)}>
              File a correction
            </Button>
          </>
        ) : null}
        {preview?.corrections.map((row) => (
          <span key={row.id} className="inline-flex gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => void openCopy(row.id, "B")}>Corrected Copy B</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void openCopy(row.id, "C")}>Corrected Copy C</Button>
          </span>
        ))}
      </div>
    </div>
  );
}
