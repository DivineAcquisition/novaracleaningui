// ─── Discord internal-notifications helper ─────────────────────────────────
//
// Fire-and-forget post to a Discord incoming webhook for internal team
// notifications. Gated on DISCORD_WEBHOOK_URL (app_secrets first, then env),
// so it no-ops cleanly until the webhook is configured. Never throws.
//
// Most automated notifications are handled by the public.events DB trigger
// (trg_notify_discord_on_event). Use this helper when an edge function wants
// to push a custom/ad-hoc message that isn't an events row.

import { resolveSecret } from "./app-secrets.ts";

// deno-lint-ignore no-explicit-any
type DB = any;

export interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordMessage {
  title: string;
  description?: string;
  /** Decimal color int for the embed sidebar. Defaults to Novara violet. */
  color?: number;
  fields?: DiscordField[];
  username?: string;
}

const NOVARA_VIOLET = 5793266;

export async function notifyDiscord(supabase: DB, msg: DiscordMessage): Promise<boolean> {
  try {
    const url = (await resolveSecret(supabase, "DISCORD_WEBHOOK_URL")).trim();
    if (!url) return false;
    const body = {
      username: msg.username || "Novara Ops",
      embeds: [
        {
          title: msg.title,
          description: msg.description ? msg.description.slice(0, 1800) : undefined,
          color: msg.color ?? NOVARA_VIOLET,
          fields: (msg.fields || []).slice(0, 25),
          footer: { text: "Novara" },
          timestamp: new Date().toISOString(),
        },
      ],
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn("[discord] webhook returned", res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[discord] post failed", err instanceof Error ? err.message : String(err));
    return false;
  }
}
