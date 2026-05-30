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
          Conversations inbox (2-way GHL) and one-off SMS / email composer.
          Every send is logged.
        </p>
      </div>

      <GhlInboxPanel
        onPick={(c) =>
          setTarget({
            phone: c.phone || "",
            email: c.email || "",
            firstName: (c.name || "").split(" ")[0] || "",
          })
        }
      />

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

function SmsComposer({ target }: { target: { phone: string; email?: string; firstName: string } }) {
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
      // Route through GHL so outbound rides the same 10DLC number the
      // 2-way Conversations inbox is wired to. Telnyx (`send-sms-
      // notification`) is now reserved for cron-driven system SMS
      // where we don't want replies routing to a human inbox.
      const { data, error } = await supabase.functions.invoke("send-ghl-sms", {
        body: {
          phone: target.phone,
          email: target.email || undefined,
          firstName: target.firstName || undefined,
          message: merged,
          type: "admin_composer",
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("SMS sent via GHL ✓");
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
          Sent via GHL so the customer's reply lands in the Conversations
          inbox. Add <code>{"{firstName}"}</code> to merge the recipient's
          first name.
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

// ─── GHL Conversations 2-way inbox panel ──────────────────────────────
//
// Backed by the existing `admin-ghl-conversation-probe` edge function
// (which calls /contacts + /conversations/search + /conversations/{id}/
// messages on the GHL Conversations API). The panel is poll-based
// (10s) — when GHL inbound webhook is configured the same data is
// already syncing into our DB but we deliberately read from GHL live so
// the operator always sees the source of truth.
//
// Operator workflow:
//   1. See the most recent 20 GHL contacts with conversation activity.
//   2. Click one → right pane shows the full message thread.
//   3. Type a reply → sends via send-ghl-sms (rides the same GHL number).
//
// Clicking "Use as composer recipient" lifts the contact into the
// existing one-off SMS / email composer below.

interface GhlContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  dateAdded?: string;
}

interface GhlMessage {
  id: string;
  direction: "inbound" | "outbound";
  body?: string;
  dateAdded: string;
  messageType?: string;
  status?: string;
}

function GhlInboxPanel({ onPick }: { onPick: (c: GhlContact) => void }) {
  const [contacts, setContacts] = useState<GhlContact[]>([]);
  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [messages, setMessages] = useState<GhlMessage[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const refresh = useMemo(
    () => async (contactKey?: { id?: string; email?: string; phone?: string }) => {
      try {
        if (!contactKey) setLoadingList(true);
        else setLoadingThread(true);
        const { data, error } = await supabase.functions.invoke(
          "admin-ghl-conversation-probe",
          {
            body: contactKey?.email
              ? { email: contactKey.email }
              : contactKey?.phone
              ? { phone: contactKey.phone }
              : {},
          },
        );
        if (error) throw error;
        const d = (data || {}) as {
          contacts?: GhlContact[];
          messages?: Array<{ items: GhlMessage[] }>;
        };
        if (!contactKey) {
          setContacts((d.contacts || []).slice(0, 20));
        } else {
          const items = (d.messages || []).flatMap((b) => b.items || []);
          items.sort(
            (a, b) =>
              new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime(),
          );
          setMessages(items);
        }
      } catch (err) {
        if (!contactKey) toast.error("GHL inbox load failed: " + (err as Error).message);
      } finally {
        setLoadingList(false);
        setLoadingThread(false);
      }
    },
    [],
  );

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30000);
    return () => clearInterval(t);
  }, [refresh]);

  const openContact = (c: GhlContact) => {
    setActiveContactId(c.id);
    void refresh({ id: c.id, email: c.email || undefined, phone: c.phone || undefined });
  };

  const activeContact = useMemo(
    () => contacts.find((c) => c.id === activeContactId) || null,
    [contacts, activeContactId],
  );

  const sendReply = async () => {
    if (!activeContact || !reply.trim()) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-ghl-sms", {
        body: {
          phone: activeContact.phone || undefined,
          email: activeContact.email || undefined,
          firstName: (activeContact.name || "").split(" ")[0] || undefined,
          message: reply.trim(),
          type: "admin_reply",
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Reply sent via GHL ✓");
      setReply("");
      // Re-fetch the thread to show the new outbound row.
      setTimeout(
        () => void refresh({ id: activeContact.id, phone: activeContact.phone || undefined, email: activeContact.email || undefined }),
        800,
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="border-slate-200 shadow-sm rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <RiChat3Line className="w-4 h-4 text-emerald-700" />
          GHL Conversations (2-way)
        </CardTitle>
        <CardDescription>
          Live SMS thread from GoHighLevel. Replies sent here ride the same
          verified 10DLC number; inbound replies sync via the GHL inbound
          webhook.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0 grid grid-cols-1 md:grid-cols-3 gap-0 border-t border-slate-200">
        <div className="md:col-span-1 border-r border-slate-200 max-h-[420px] overflow-y-auto">
          {loadingList && (
            <div className="p-3 space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}
          {!loadingList && contacts.length === 0 && (
            <p className="p-4 text-xs text-slate-500">
              No recent GHL contacts. Run the inbound webhook check.
            </p>
          )}
          {contacts.map((c) => (
            <button
              key={c.id}
              onClick={() => openContact(c)}
              className={cn(
                "w-full text-left p-3 hover:bg-slate-50 border-b border-slate-100",
                activeContactId === c.id && "bg-emerald-50/60",
              )}
            >
              <p className="text-sm font-medium text-slate-900 truncate">
                {c.name || c.phone || "(no name)"}
              </p>
              <p className="text-[11px] text-slate-500 truncate">
                {c.phone || c.email || "—"}
              </p>
              {c.tags && c.tags.length > 0 && (
                <div className="flex flex-wrap gap-0.5 mt-1">
                  {c.tags.slice(0, 3).map((t) => (
                    <Badge
                      key={t}
                      variant="outline"
                      className="text-[9px] font-normal py-0 px-1.5 bg-slate-50 border-slate-200 text-slate-600"
                    >
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
        <div className="md:col-span-2 p-4 flex flex-col gap-3 min-h-[300px]">
          {!activeContact && (
            <p className="text-xs text-slate-500 text-center mt-12">
              Pick a contact on the left to see their thread.
            </p>
          )}
          {activeContact && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {activeContact.name || activeContact.phone}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {activeContact.phone || "no phone"} ·{" "}
                    {activeContact.email || "no email"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onPick(activeContact)}
                  className="text-xs h-7"
                >
                  Use as composer recipient
                </Button>
              </div>
              <div className="flex-1 max-h-[260px] overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2">
                {loadingThread && <Skeleton className="h-8 w-full" />}
                {!loadingThread && messages.length === 0 && (
                  <p className="text-xs text-slate-500 text-center pt-6">
                    No messages on file.
                  </p>
                )}
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "max-w-[80%] rounded-lg px-3 py-1.5 text-sm whitespace-pre-wrap break-words",
                      m.direction === "outbound"
                        ? "ml-auto bg-emerald-600 text-white"
                        : "mr-auto bg-white border border-slate-200",
                    )}
                  >
                    <span>{m.body || `(${m.messageType || "no body"})`}</span>
                    <div
                      className={cn(
                        "text-[9px] mt-0.5",
                        m.direction === "outbound" ? "text-emerald-100" : "text-slate-400",
                      )}
                    >
                      {new Date(m.dateAdded).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Textarea
                  rows={2}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Reply…"
                  className="text-sm"
                />
                <Button
                  onClick={sendReply}
                  disabled={sending || !reply.trim()}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white self-end"
                >
                  {sending ? (
                    <RiLoader4Line className="w-4 h-4 animate-spin" />
                  ) : (
                    <RiSendPlane2Line className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
