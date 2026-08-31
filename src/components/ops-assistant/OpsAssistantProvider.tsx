"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

import { supabase } from "@/integrations/supabase/client";
import { screenSlugFromPath } from "@/lib/ops-assistant/retrieval";
import type {
  AskResponse,
  AssistantEntry,
  AssistantSurface,
  ChatMessage,
  PageContext,
  PageRecord,
  ThreadResponse,
} from "@/lib/ops-assistant/types";

interface OpsAssistantValue {
  surface: AssistantSurface;
  open: boolean;
  setOpen: (open: boolean) => void;
  messages: ChatMessage[];
  sending: boolean;
  error: string | null;
  page: PageContext;
  setRecord: (record: PageRecord | null) => void;
  ask: (text: string, entry?: AssistantEntry) => Promise<void>;
  askFromSearch: (text: string) => Promise<void>;
  rate: (messageId: string, rating: "helpful" | "not_helpful", note?: string) => Promise<void>;
}

const Ctx = createContext<OpsAssistantValue | null>(null);

async function authHeaders(surface: AssistantSurface): Promise<HeadersInit> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (surface === "workspace") {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  return headers;
}

export function OpsAssistantProvider({
  surface,
  children,
}: {
  surface: AssistantSurface;
  children: ReactNode;
}) {
  const pathname = usePathname() || "";
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<PageRecord | null>(null);
  const [urlRecord, setUrlRecord] = useState<PageRecord | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const account = sp.get("account") || "";
    const highlight = sp.get("highlight") || "";
    setUrlRecord(
      account ? { kind: "account", id: account } : highlight ? { kind: "booking", id: highlight } : null,
    );
  }, [pathname]);

  const page = useMemo<PageContext>(() => {
    return {
      surface,
      path: pathname,
      docSlug: screenSlugFromPath(pathname),
      record: record || urlRecord,
    };
  }, [pathname, record, urlRecord, surface]);

  const loadThread = useCallback(async () => {
    try {
      const headers = await authHeaders(surface);
      const res = await fetch("/api/ops-assistant", { headers, credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as ThreadResponse;
      if (Array.isArray(data.messages)) setMessages(data.messages);
    } catch {
      // Offline / unsigned — the panel still opens, history fills in after sign-in.
    }
  }, [surface]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  const ask = useCallback(
    async (text: string, entry: AssistantEntry = "chat") => {
      const message = text.trim();
      if (!message || sending) return;
      setSending(true);
      setError(null);
      setOpen(true);
      const optimistic: ChatMessage = {
        id: `local-${Date.now()}`,
        role: "user",
        content: message,
        citations: [],
        actions: [],
        surface,
        entry,
        escalation: false,
        writeRefused: false,
        rating: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      try {
        const headers = await authHeaders(surface);
        const res = await fetch("/api/ops-assistant", {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify({ message, surface, entry, page }),
        });
        const data = (await res.json()) as AskResponse & { error?: string };
        if (!res.ok) throw new Error(data.error || "The assistant could not answer.");
        setMessages((prev) => {
          const without = prev.filter((m) => m.id !== optimistic.id);
          return [
            ...without,
            { ...optimistic, id: `acked-${optimistic.id}` },
            data.message,
          ];
        });
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setError(err instanceof Error ? err.message : "The assistant could not answer.");
      } finally {
        setSending(false);
      }
    },
    [page, sending, surface],
  );

  const rate = useCallback(
    async (messageId: string, rating: "helpful" | "not_helpful", note?: string) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, rating, ratingNote: note || m.ratingNote || null } : m)),
      );
      try {
        const headers = await authHeaders(surface);
        const res = await fetch("/api/ops-assistant/feedback", {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify({ messageId, rating, note: note || "" }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || "Could not save that rating.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save that rating.");
      }
    },
    [surface],
  );

  const askFromSearch = useCallback(
    async (text: string) => {
      await ask(text, "search");
    },
    [ask],
  );

  const value = useMemo<OpsAssistantValue>(
    () => ({
      surface,
      open,
      setOpen,
      messages,
      sending,
      error,
      page,
      setRecord,
      ask,
      askFromSearch,
      rate,
    }),
    [surface, open, messages, sending, error, page, ask, askFromSearch, rate],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOpsAssistant(): OpsAssistantValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useOpsAssistant must be used inside OpsAssistantProvider");
  }
  return ctx;
}

export function useOpsAssistantOptional(): OpsAssistantValue | null {
  return useContext(Ctx);
}

/** Pages call this when a record sheet is open so the assistant can see it. */
export function useOpsAssistantRecord(record: PageRecord | null) {
  const ctx = useContext(Ctx);
  const setRecord = ctx?.setRecord;
  useEffect(() => {
    if (!setRecord) return;
    setRecord(record);
    return () => setRecord(null);
  }, [setRecord, record?.kind, record?.id, record?.label]);
}
