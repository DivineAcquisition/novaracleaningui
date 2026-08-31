"use client";

import { useEffect, useState } from "react";
import { RiLoader4Line, RiSaveLine, RiDeleteBinLine } from "@remixicon/react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

interface Article {
  id: string;
  slug: string;
  title: string;
  category: string;
  body: string;
  escalation: boolean;
  adminOnly: boolean;
  updatedAt: string | null;
}

async function headers(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (data.session?.access_token) h.Authorization = `Bearer ${data.session.access_token}`;
  return h;
}

export default function AssistantKnowledge() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({
    slug: "",
    title: "",
    category: "Policy",
    body: "",
    escalation: false,
    adminOnly: false,
  });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ops-assistant/knowledge", { headers: await headers() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load articles");
      setArticles(data.articles || []);
      setSource(data.source || "");
    } catch (err: any) {
      toast.error(err?.message || "Could not load articles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/ops-assistant/knowledge", {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast.success("Saved");
      setDraft({ slug: "", title: "", category: "Policy", body: "", escalation: false, adminOnly: false });
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (slug: string) => {
    if (!confirm(`Delete “${slug}”?`)) return;
    const res = await fetch(`/api/ops-assistant/knowledge?slug=${encodeURIComponent(slug)}`, {
      method: "DELETE",
      headers: await headers(),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Delete failed");
      return;
    }
    await load();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Ops Assistant</p>
        <h1 className="mt-1 font-heading text-2xl font-bold tracking-tight">Policy & escalation articles</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          How-the-tool-works answers come from the generated guides at docs.novaracleaning.com — those
          are not edited here. This is the other category: policy, pricing-promise, and topics that
          must route to “confirm with management.”
        </p>
        {source && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Source: {source === "seed" ? "built-in seeds (table empty or missing)" : "database"}
          </p>
        )}
      </header>

      <section className="rounded-xl border border-[color:var(--hairline)] bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Add or replace an article</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="slug">Slug</Label>
            <Input id="slug" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="category">Category</Label>
            <Input
              id="category"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="title">Title</Label>
          <Input id="title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="body">Body</Label>
          <Textarea
            id="body"
            rows={6}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.escalation} onCheckedChange={(v) => setDraft({ ...draft, escalation: v })} />
            Escalation (confirm with management)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.adminOnly} onCheckedChange={(v) => setDraft({ ...draft, adminOnly: v })} />
            Admin only
          </label>
        </div>
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiSaveLine className="h-4 w-4" />}
          Save
        </Button>
      </section>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <RiLoader4Line className="h-4 w-4 animate-spin" /> Loading
        </p>
      ) : (
        <ul className="space-y-3">
          {articles.map((a) => (
            <li key={a.id} className="rounded-xl border border-[color:var(--hairline)] bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{a.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {a.category}
                    {a.escalation ? " · escalation" : ""}
                    {a.adminOnly ? " · admin only" : ""} · {a.slug}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void remove(a.slug)}
                  aria-label={`Delete ${a.slug}`}
                >
                  <RiDeleteBinLine className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() =>
                  setDraft({
                    slug: a.slug,
                    title: a.title,
                    category: a.category,
                    body: a.body,
                    escalation: a.escalation,
                    adminOnly: a.adminOnly,
                  })
                }
              >
                Edit
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
