"use client";

// ─── /admin/messages — Manual SMS + email composer ─────────────────────
//
// Lets VAs/admins fire a one-off SMS (via send-sms-notification → Telnyx)
// or one-off email (via Resend through send-system-email if available, or
// the existing send-booking-email path) to a customer or any phone/email.
// Every send is logged via the existing edge function logging so we can
// attribute it later.

import { useEffect, useMemo, useState } from "react";
import {
  RiChat3Line,
  RiMailSendLine,
  RiPhoneLine,
  RiUser3Line,
  RiSendPlane2Line,
  RiLoader4Line,
  RiSearch2Line,
  RiCheckLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ContactRow {
  kind: "customer" | "cleaner";
  id: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
}

const SMS_TEMPLATES = [
  {
    id: "reminder_24h",
    label: "Day-before reminder",
    text:
      "Novara Cleaning: Quick reminder — your cleaning is tomorrow. Reply if anything's changed. ❤️",
  },
  {
    id: "running_late",
    label: "Cleaner is running late",
    text:
      "Novara Cleaning: Quick heads-up — your cleaner is running ~15 min behind schedule. We'll text again when they're on the way.",
  },
  {
    id: "ask_review",
    label: "Ask for review",
    text:
      "Hi from Novara Cleaning! Hope your cleaning was great. If you have 30 sec, we'd love a Google review: https://g.page/r/novaracleaning/review",
  },
];

const EMAIL_TEMPLATES = [
  {
    id: "confirm_followup",
    label: "Confirm details follow-up",
    subject: "One quick step to lock in your Novara cleaning",
    body:
      "Hi {firstName},\n\nWe still need a few home details to finalise your booking. " +
      "Tap the link below and you're all set:\n\nhttps://app.novaracleaning.com/account\n\n" +
      "— The Novara team",
  },
  {
    id: "say_hi",
    label: "Friendly check-in",
    subject: "Checking in from Novara Cleaning",
    body:
      "Hi {firstName},\n\nJust circling back — let us know if you'd like to book another cleaning. " +
      "Loyal customers get 10% off — reply YES and we'll auto-apply it on your next booking.\n\n" +
      "— Novara",
  },
];

export default function AdminMessages() {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<{ phone: string; email: string; firstName: string }>(
    { phone: "", email: "", firstName: "" },
  );

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      if (!search.trim()) {
        setContacts([]);
        return;
      }
      setLoading(true);
      const q = search.trim();
      const digits = q.replace(/\D/g, "");
      const orFilter = [
        `first_name.ilike.%${q}%`,
        `last_name.ilike.%${q}%`,
        `email.ilike.%${q}%`,
        digits ? `phone.ilike.%${digits}%` : "",
      ]
        .filter(Boolean)
        .join(",");
      const [cust, clean] = await Promise.all([
        supabase
          .from("customers")
          .select("id, email, phone, first_name, last_name")
          .or(orFilter)
          .limit(15),
        supabase
          .from("cleaners")
          .select("id, email, phone, first_name, last_name")
          .or(orFilter)
          .limit(15),
      ]);
      if (!alive) return;
      const rows: ContactRow[] = [
        ...((cust.data as any[]) || []).map((c) => ({ ...c, kind: "customer" as const })),
        ...((clean.data as any[]) || []).map((c) => ({ ...c, kind: "cleaner" as const })),
      ];
      setContacts(rows);
      setLoading(false);
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [search]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-jakarta text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <RiChat3Line className="w-6 h-6 text-emerald-700" />
          Messages
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Fire a one-off SMS or email to any customer or cleaner. Every send is logged.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* LEFT — recipient picker */}
        <Card className="border-slate-200 shadow-sm rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <RiUser3Line className="w-4 h-4 text-emerald-700" />
              Recipient
            </CardTitle>
            <CardDescription>
              Search by name, email, or phone. Or paste a number / email manually.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <RiSearch2Line className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="max-h-72 overflow-y-auto rounded-md border divide-y bg-white">
              {loading && <Skeleton className="h-10 w-full m-2" />}
              {!loading && search && contacts.length === 0 && (
                <p className="text-xs text-slate-500 p-3">No matches.</p>
              )}
              {contacts.map((c) => (
                <button
                  key={`${c.kind}-${c.id}`}
                  onClick={() => {
                    setTarget({
                      phone: c.phone || "",
                      email: c.email || "",
                      firstName: c.first_name || "",
                    });
                    toast.success(
                      `Recipient set: ${c.first_name || ""} ${c.last_name || ""}`.trim(),
                    );
                  }}
                  className="w-full text-left p-2.5 hover:bg-slate-50 flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {c.first_name || ""} {c.last_name || ""}
                      {!c.first_name && !c.last_name && (
                        <span className="text-slate-400">(no name)</span>
                      )}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {c.email || "—"} · {c.phone || "—"}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      c.kind === "customer"
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                        : "bg-slate-100 text-slate-700 border-slate-200",
                    )}
                  >
                    {c.kind}
                  </Badge>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-2 pt-2 border-t border-slate-100">
              <Label className="text-xs text-slate-500">Or set manually</Label>
              <Input
                placeholder="Phone (E.164 or 10-digit US)"
                value={target.phone}
                onChange={(e) => setTarget((t) => ({ ...t, phone: e.target.value }))}
              />
              <Input
                placeholder="Email"
                value={target.email}
                onChange={(e) => setTarget((t) => ({ ...t, email: e.target.value }))}
              />
              <Input
                placeholder='First name (optional, used for {firstName} merge)'
                value={target.firstName}
                onChange={(e) => setTarget((t) => ({ ...t, firstName: e.target.value }))}
              />
            </div>
          </CardContent>
        </Card>

        {/* RIGHT — composer */}
        <div className="lg:col-span-2 space-y-5">
          <Tabs defaultValue="sms">
            <TabsList>
              <TabsTrigger value="sms">
                <RiPhoneLine className="w-4 h-4 mr-1.5" /> SMS
              </TabsTrigger>
              <TabsTrigger value="email">
                <RiMailSendLine className="w-4 h-4 mr-1.5" /> Email
              </TabsTrigger>
            </TabsList>
            <TabsContent value="sms" className="mt-4">
              <SmsComposer target={target} />
            </TabsContent>
            <TabsContent value="email" className="mt-4">
              <EmailComposer target={target} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

// ─── SMS composer ────────────────────────────────────────────────────

function SmsComposer({ target }: { target: { phone: string; firstName: string } }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const merged = useMemo(
    () => body.replaceAll("{firstName}", target.firstName || "there"),
    [body, target.firstName],
  );

  const send = async () => {
    if (!target.phone.trim()) {
      toast.error("Pick a recipient or enter a phone number.");
      return;
    }
    if (!body.trim()) {
      toast.error("Type a message first.");
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-sms-notification", {
        body: {
          toPhone: target.phone,
          message: merged,
          type: "confirmation",
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("SMS sent ✓");
      setBody("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="border-slate-200 shadow-sm rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Compose SMS</CardTitle>
        <CardDescription>
          Sent via Telnyx. Add <code>{"{firstName}"}</code> to merge the recipient's first name.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {SMS_TEMPLATES.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant="outline"
              onClick={() => setBody(t.text)}
              className="text-xs h-7"
            >
              {t.label}
            </Button>
          ))}
        </div>
        <Textarea
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Type SMS…"
        />
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <p className="font-semibold mb-1">Preview</p>
          <p className="whitespace-pre-wrap break-words">{merged || "—"}</p>
          <p className="mt-2 text-[11px] text-slate-400">
            {merged.length} chars · {Math.ceil(merged.length / 160) || 0} segment
            {merged.length > 160 ? "s" : ""} · to {target.phone || "no recipient"}
          </p>
        </div>
        <Button
          onClick={send}
          disabled={sending || !target.phone || !body.trim()}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {sending ? (
            <>
              <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> Sending…
            </>
          ) : (
            <>
              <RiSendPlane2Line className="w-4 h-4 mr-2" /> Send SMS
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Email composer ──────────────────────────────────────────────────

function EmailComposer({ target }: { target: { email: string; firstName: string } }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const mergedSubject = useMemo(
    () => subject.replaceAll("{firstName}", target.firstName || "there"),
    [subject, target.firstName],
  );
  const mergedBody = useMemo(
    () => body.replaceAll("{firstName}", target.firstName || "there"),
    [body, target.firstName],
  );

  const send = async () => {
    if (!target.email.trim()) {
      toast.error("Pick a recipient or enter an email.");
      return;
    }
    if (!subject.trim() || !body.trim()) {
      toast.error("Subject and body are required.");
      return;
    }
    setSending(true);
    try {
      const html =
        `<div style="font-family:Inter,sans-serif;font-size:15px;color:#1e293b;line-height:1.55;max-width:560px;">` +
        mergedBody.replaceAll("\n", "<br/>") +
        `<br/><br/><span style="color:#64748b;font-size:13px">— Novara Cleaning · support@novaracleaning.com · (844) 735-2070</span>` +
        `</div>`;
      const { data, error } = await supabase.functions.invoke("admin-send-email", {
        body: {
          to: target.email,
          subject: mergedSubject,
          html,
          from: "Novara Cleaning <hello@novaracleaning.com>",
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Email sent ✓");
      setBody("");
      setSubject("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="border-slate-200 shadow-sm rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Compose email</CardTitle>
        <CardDescription>
          Sent via Resend. Add <code>{"{firstName}"}</code> in subject or body to merge.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {EMAIL_TEMPLATES.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant="outline"
              className="text-xs h-7"
              onClick={() => {
                setSubject(t.subject);
                setBody(t.body);
              }}
            >
              {t.label}
            </Button>
          ))}
        </div>
        <Input
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <Textarea
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Email body…"
        />
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 max-h-40 overflow-auto">
          <p className="font-semibold">Preview · {target.email || "no recipient"}</p>
          <p className="font-semibold mt-1">Subject: {mergedSubject || "—"}</p>
          <p className="mt-2 whitespace-pre-wrap break-words">{mergedBody || "—"}</p>
        </div>
        <Button
          onClick={send}
          disabled={sending || !target.email || !subject.trim() || !body.trim()}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {sending ? (
            <>
              <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> Sending…
            </>
          ) : (
            <>
              <RiCheckLine className="w-4 h-4 mr-2" /> Send email
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
