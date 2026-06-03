"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RiDownloadLine, RiRefreshLine, RiFileTextLine, RiCheckLine, RiCloseLine } from "@remixicon/react";
import { toast } from "sonner";

interface AgreementRow {
  id: string;
  booking_id: string | null;
  customer_email: string | null;
  customer_name: string | null;
  agreement_version: string;
  agreed_terms: boolean;
  agreed_disclaimer: boolean;
  agreed_refund: boolean;
  agreed_service_agreement: boolean;
  source: string;
  pdf_path: string | null;
  accepted_at: string;
}

export default function AdminAgreements() {
  const [rows, setRows] = useState<AgreementRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // deno-lint-ignore no-explicit-any
      const { data, error } = await (supabase.from as any)("service_agreements")
        .select(
          "id, booking_id, customer_email, customer_name, agreement_version, agreed_terms, agreed_disclaimer, agreed_refund, agreed_service_agreement, source, pdf_path, accepted_at",
        )
        .order("accepted_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setRows((data as AgreementRow[]) || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load agreements");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (row: AgreementRow) => {
    if (!row.pdf_path) {
      toast.error("No PDF stored for this agreement.");
      return;
    }
    try {
      const { data, error } = await supabase.storage
        .from("service-agreements")
        .createSignedUrl(row.pdf_path, 120);
      if (error || !data?.signedUrl) throw error || new Error("Could not sign URL");
      window.open(data.signedUrl, "_blank");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    }
  };

  const Yes = ({ ok }: { ok: boolean }) =>
    ok ? (
      <RiCheckLine className="w-3.5 h-3.5 text-emerald-600 inline" />
    ) : (
      <RiCloseLine className="w-3.5 h-3.5 text-red-500 inline" />
    );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-jakarta text-2xl font-extrabold flex items-center gap-2">
            <RiFileTextLine className="w-6 h-6 text-violet-600" />
            Service Agreements
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Signed One-Time Service Agreements + policy acceptances (chargeback evidence).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RiRefreshLine className="w-4 h-4" />
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <RiFileTextLine className="w-10 h-10 mx-auto mb-3 text-violet-400" />
            No signed agreements yet. They appear here as customers complete checkout.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id} className="border-violet-100">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">
                    {row.customer_name || row.customer_email || "Unknown"}
                  </CardTitle>
                  <Badge variant="outline" className="text-xs">
                    {row.source} · {new Date(row.accepted_at).toLocaleDateString()}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{row.customer_email}</p>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-4 flex-wrap">
                <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
                  <span><Yes ok={row.agreed_terms} /> Terms</span>
                  <span><Yes ok={row.agreed_disclaimer} /> Disclaimer</span>
                  <span><Yes ok={row.agreed_refund} /> Refund</span>
                  <span><Yes ok={row.agreed_service_agreement} /> Service Agreement</span>
                </div>
                <Button size="sm" onClick={() => void download(row)} disabled={!row.pdf_path}>
                  <RiDownloadLine className="w-4 h-4 mr-2" />
                  Download PDF
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
