"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export interface WebhookHistoryEntry {
  id: string;
  timestamp: string;
  type: "booking" | "job" | "test";
  payload: any;
  response: {
    status: number;
    body: string;
  };
  webhookUrl: string;
}

interface WebhookHistoryContextType {
  history: WebhookHistoryEntry[];
  addEntry: (entry: Omit<WebhookHistoryEntry, "id" | "timestamp">) => void;
  clearHistory: () => void;
}

const WebhookHistoryContext = createContext<WebhookHistoryContextType | undefined>(undefined);

const STORAGE_KEY = "webhook_history";
const MAX_ENTRIES = 20;

export const WebhookHistoryProvider = ({ children }: { children: ReactNode }) => {
  const [history, setHistory] = useState<WebhookHistoryEntry[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load from localStorage on mount (client-side only)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          setHistory(JSON.parse(stored));
        }
      } catch {
        // Ignore parse errors
      }
      setIsInitialized(true);
    }
  }, []);

  // Save to localStorage when data changes
  useEffect(() => {
    if (isInitialized && typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    }
  }, [history, isInitialized]);

  const addEntry = (entry: Omit<WebhookHistoryEntry, "id" | "timestamp">) => {
    const newEntry: WebhookHistoryEntry = {
      ...entry,
      id: Math.random().toString(36).slice(2, 11),
      timestamp: new Date().toISOString(),
    };

    setHistory((prev) => [newEntry, ...prev].slice(0, MAX_ENTRIES));
  };

  const clearHistory = () => {
    setHistory([]);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  return (
    <WebhookHistoryContext.Provider value={{ history, addEntry, clearHistory }}>
      {children}
    </WebhookHistoryContext.Provider>
  );
};

export const useWebhookHistory = () => {
  const context = useContext(WebhookHistoryContext);
  if (!context) {
    throw new Error("useWebhookHistory must be used within WebhookHistoryProvider");
  }
  return context;
};
