"use client";

// ─── Payroll → Expenses & reimbursements ──────────────────────────────────────
//
// Logging money owed to a cleaner, VA or vendor, and marking it paid.
//
// This used to live under a separate "P&L Data" screen alongside ad spend and
// EOD reports, which is a reporting surface — but reimbursing a cleaner for mop
// heads is a PAYROLL task, done by the same person in the same sitting as the
// rest of their pay. It sits here now so nobody has to remember which of two
// money screens holds the thing they owe somebody.
//
// The Promised/Paid distinction is the point of the workflow, not decoration:
// "Promised" records a commitment so it shows as owed without touching profit,
// and flipping to "Paid" is what lets it hit True Net. Logging something as Paid
// before the money moves is how the books drift.

import { RiCheckboxCircleFill, RiLoader4Line } from "@remixicon/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const EXPENSE_TYPES = ["Promised", "Reimbursement", "One-off Expense", "Other"];
const EXPENSE_STATUSES = ["Promised", "Approved", "Paid", "Denied"];

const STATUS_STYLE: Record<string, string> = {
  Promised: "bg-amber-100 text-amber-700",
  Approved: "bg-blue-100 text-blue-700",
  Paid: "bg-emerald-100 text-emerald-700",
  Denied: "bg-rose-100 text-rose-700",
};

// Local calendar day. toISOString() would roll over to tomorrow after 8pm
// Eastern and date-stamp an expense on a day nobody worked.
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

interface ExpenseRow {
  id: string;
  date: string;
  type: string;
  who: string;
  description: string;
  amount_cents: number;
  status: string;
  paid_date: string | null;
}

export default function ExpensesTab() {
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [f, setF] = useState({
    date: todayYmd(),
    type: "Promised",
    who: "",
    description: "",
    amount: "",
    status: "Promised",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase.from as any)("pl_expenses")
      .select("*")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);
    setRows((data || []) as ExpenseRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    const amount = Math.round(parseFloat(f.amount) * 100);
    if (!f.date || !f.who.trim() || !f.description.trim() || !Number.isFinite(amount) || amount <= 0) {
      toast.error("Date, who, description, and a valid amount are required.");
      return;
    }
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await (supabase.from as any)("pl_expenses").insert({
        date: f.date,
        type: f.type,
        who: f.who.trim(),
        description: f.description.trim(),
        amount_cents: amount,
        status: f.status,
        paid_date: f.status === "Paid" ? f.date : null,
        created_by: u.user?.id || null,
      });
      if (error) throw error;
      toast.success("Logged.");
      setF({ date: todayYmd(), type: "Promised", who: "", description: "", amount: "", status: "Promised" });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (row: ExpenseRow, status: string) => {
    setBusyId(row.id);
    try {
      const { error } = await (supabase.from as any)("pl_expenses")
        .update({
          status,
          paid_date: status === "Paid" ? row.paid_date || todayYmd() : null,
        })
        .eq("id", row.id);
      if (error) throw error;
      toast.success(status === "Paid" ? "Marked Paid — now hits True Net." : `Status → ${status}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  };

  const owed = rows
    .filter((r) => r.status === "Promised" || r.status === "Approved")
    .reduce((sum, r) => sum + r.amount_cents, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-bold text-slate-800">Log an expense / reimbursement</p>
            {owed > 0 ? (
              <p className="text-xs text-amber-800">
                <span className="font-semibold">{money(owed)}</span> currently owed and unpaid
              </p>
            ) : null}
          </div>
          <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
            Log as <strong>Promised</strong> when you commit to it (shows as owed, doesn&apos;t hit
            profit) — flip to <strong>Paid</strong> once the money has actually moved, which is when
            it hits True Net.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <Label>Date *</Label>
              <Input
                type="date"
                value={f.date}
                onChange={(e) => setF({ ...f, date: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Type *</Label>
              <Select value={f.type} onValueChange={(v) => setF({ ...f, type: v })}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount ($) *</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={f.amount}
                onChange={(e) => setF({ ...f, amount: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Status *</Label>
              <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Who (Cleaner / VA / Vendor) *</Label>
              <Input
                value={f.who}
                onChange={(e) => setF({ ...f, who: e.target.value })}
                placeholder="e.g. Issac Bell"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Description *</Label>
              <Input
                value={f.description}
                onChange={(e) => setF({ ...f, description: e.target.value })}
                placeholder="e.g. supplies reimbursement — mop heads"
                className="mt-1"
              />
            </div>
          </div>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? (
              <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RiCheckboxCircleFill className="mr-1.5 h-4 w-4" />
            )}
            Log expense
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <span className="font-mono text-xs text-slate-400">{r.date}</span>
              <Badge variant="outline">{r.type}</Badge>
              <span className="font-medium text-slate-800">{r.who}</span>
              <span className="max-w-[240px] truncate text-slate-500">{r.description}</span>
              <span className="ml-auto font-semibold">{money(r.amount_cents)}</span>
              <Select value={r.status} onValueChange={(v) => void setStatus(r, v)} disabled={busyId === r.id}>
                <SelectTrigger className={cn("h-7 w-[110px] border-0 text-xs", STATUS_STYLE[r.status])}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          {rows.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-slate-500">
                No expenses logged yet.
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
