"use client";

// ─── Contractors working without a signed agreement ──────────────────────────
//
// The backlog this exists to clear: people already taking jobs who never signed
// an ICA. Until now that was invisible — you found out when activation was
// blocked, or when you needed the document and it wasn't there.
//
// One tap per person sends a single-use signing link that opens straight onto
// the agreement (no login, no onboarding wizard), because the auth-gated wizard
// is exactly where these signatures were being lost. The panel hides itself
// when the backlog is empty; a permanent empty card teaches people to ignore it.

import { RiFileWarningLine, RiLoader4Line, RiMailSendLine } from "@remixicon/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { describeEdgeError } from "@/lib/edge-invoke";

interface AgreementStatusRow {
  cleaner_id: string;
  cleaner_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  signed: boolean;
  link_outstanding: boolean;
  agreement_token_sent_at: string | null;
  link_sent_count: number;
  working_unsigned: boolean;
}

function sinceLabel(iso: string | null): string {
  if (!iso) return "never asked";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "asked today";
  if (days === 1) return "asked yesterday";
  return `asked ${days} days ago`;
}

export default function UnsignedAgreements({
  onSelectCleaner,
}: {
  onSelectCleaner?: (cleanerId: string) => void;
}) {
  const [rows, setRows] = useState<AgreementStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    // The view post-dates the generated Supabase types.
    const { data, error } = await (supabase.from as any)("cleaner_agreement_status_v1")
      .select("*")
      .eq("signed", false)
      .order("working_unsigned", { ascending: false })
      .order("cleaner_name", { ascending: true })
      .limit(50);
    if (!error) setRows((data || []) as AgreementStatusRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sendLink = async (row: AgreementStatusRow) => {
    setBusyId(row.cleaner_id);
    try {
      const { data, error } = await supabase.functions.invoke("cleaner-admin-action", {
        body: { action: "send_agreement", cleanerId: row.cleaner_id },
      });
      if (error) throw new Error(await describeEdgeError(error, data));
      const d = (data || {}) as {
        error?: string;
        emailed?: boolean;
        smsSent?: boolean;
        agreementUrl?: string;
      };
      if (d.error) throw new Error(d.error);
      const via = [d.emailed ? "email" : null, d.smsSent ? "text" : null].filter(Boolean).join(" + ");
      toast.success(
        via
          ? `Signing link sent to ${row.cleaner_name || "them"} by ${via}`
          : "Signing link created",
        { description: d.agreementUrl, duration: via ? 6000 : 20_000 },
      );
      await load();
    } catch (e) {
      toast.error("Couldn't send the signing link", {
        description: (e as Error).message,
        duration: 20_000,
      });
    } finally {
      setBusyId(null);
    }
  };

  if (loading || rows.length === 0) return null;

  const working = rows.filter((r) => r.working_unsigned);

  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
            <RiFileWarningLine className="h-4 w-4" />
            {rows.length} contractor{rows.length === 1 ? "" : "s"} without a signed agreement
          </p>
          {working.length > 0 ? (
            <p className="text-xs text-amber-800">
              <span className="font-semibold">{working.length}</span> of them are active and taking
              work
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          {rows.map((r) => (
            <div
              key={r.cleaner_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2"
            >
              <div className="min-w-0 text-xs">
                <button
                  onClick={() => onSelectCleaner?.(r.cleaner_id)}
                  className="font-medium text-slate-900 underline decoration-dotted"
                >
                  {r.cleaner_name || "Unnamed contractor"}
                </button>
                {r.working_unsigned ? (
                  <Badge variant="destructive" className="ml-1.5 text-[10px]">
                    working unsigned
                  </Badge>
                ) : (
                  <Badge variant="outline" className="ml-1.5 text-[10px]">
                    {r.status || "pending"}
                  </Badge>
                )}
                <span className="ml-1.5 text-slate-500">
                  {r.link_outstanding
                    ? `link out · ${sinceLabel(r.agreement_token_sent_at)}`
                    : sinceLabel(r.agreement_token_sent_at)}
                  {r.link_sent_count > 1 ? ` · ${r.link_sent_count} attempts` : ""}
                  {!r.email && !r.phone ? " · no contact details on file" : ""}
                </span>
              </div>
              <Button
                size="sm"
                variant={r.link_outstanding ? "outline" : "default"}
                onClick={() => void sendLink(r)}
                disabled={busyId !== null || (!r.email && !r.phone)}
              >
                {busyId === r.cleaner_id ? (
                  <RiLoader4Line className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <RiMailSendLine className="mr-1 h-3.5 w-3.5" />
                    {r.link_outstanding ? "Send again" : "Send signing link"}
                  </>
                )}
              </Button>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-amber-800/90">
          The link opens straight onto the agreement — no login and no onboarding wizard, which is
          where these signatures were getting lost. Single-use and valid for 30 days.
        </p>
      </CardContent>
    </Card>
  );
}
