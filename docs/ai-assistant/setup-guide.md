# Telnyx AI Assistant ("Glow") — Setup & Operations Guide

Three artifacts in this folder make up the assistant:

| File | What it is |
|---|---|
| `system-prompt.md` | Paste-ready instructions for Telnyx — defines persona, qualification, objections, escalation |
| `tool-definitions.json` | JSON schemas for the 8 tools Telnyx calls |
| `setup-guide.md` (this file) | How to wire it all together + monitor |

**Backend support already deployed:**
- `ai-tool-router` edge function — handles every tool call
- `ai_tool_calls` table — every call logged (for monitoring + debugging)
- `ai_escalations` table — open queue when the AI hands off to a human
- `bookings.ai_human_takeover_until` — pauses the AI on a booking for 4 hrs after escalation

---

## 1 · One-time Telnyx Mission Control setup

### 1.1 Create the AI Assistant

1. Go to **Telnyx Mission Control → AI Assistants → + New Assistant**
2. **Name:** `Novara Booking Assistant — Glow`
3. **Voice:** SMS only (skip voice settings).
4. **Model:** GPT-4o or Claude Sonnet (whichever Telnyx exposes; Sonnet is better for warm-but-concise tone).
5. **Instructions field:** Open `system-prompt.md` in this folder and paste the entire content (everything below the `---` separator). Save.

### 1.2 Register the 8 tools

For each tool in `tool-definitions.json`:

1. Click **+ Add Tool** on the assistant.
2. **Name:** copy from JSON `name` field (e.g. `lookup_customer`).
3. **Description:** copy from JSON `description` field — Telnyx uses this to decide when to call it.
4. **URL:** `https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/ai-tool-router?tool=<name>` (substitute the tool name).
5. **Method:** `POST`
6. **Headers:** `Content-Type: application/json` (no auth — the router has its own validation).
7. **Body schema:** copy the `parameters` object from JSON verbatim.
8. Save.

Repeat for all 8 tools: `lookup_customer`, `check_service_area`, `get_price_estimate`, `get_available_slots`, `create_booking`, `handle_keyword`, `add_to_waitlist`, `escalate_to_human`.

### 1.3 Bind the assistant to your toll-free number

1. Go to **Messaging → Messaging Profiles → [your existing profile]**
2. Scroll to **AI Assistant** section (or **Webhook URL** if older UI).
3. Select the assistant you just created.
4. **Set inbound message webhook URL to:**
   ```
   https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/sms-inbound
   ```
   This keeps the deterministic keyword path (R/C/YES/NO/STOP/HELP) in front of the AI for sub-second response.
5. **Failover URL:** point at the AI Assistant directly so anything `sms-inbound` doesn't handle falls through.

Confirm by texting any message that isn't `R/C/YES/NO/STOP/HELP` to `+18334432004` — the AI should reply within 5 seconds.

---

## 2 · Operations dashboard

### 2.1 Per-conversation monitoring (Telnyx native)

**Telnyx Mission Control → AI Assistants → [Glow] → Conversations**

You'll see every thread, with: customer phone, message-by-message transcript, AI confidence scores, tool calls made + responses, and a "take over" button.

### 2.2 Tool-call audit (our database)

Every tool call is logged to `public.ai_tool_calls`. Useful queries:

**Recent failures**
```sql
select tool, phone, error, request_payload, created_at
from ai_tool_calls
where http_status >= 400
order by created_at desc
limit 50;
```

**Tool usage by volume (last 24 hrs)**
```sql
select tool, count(*) as calls, avg(duration_ms)::int as avg_ms, max(duration_ms) as max_ms
from ai_tool_calls
where created_at > now() - interval '24 hours'
group by tool
order by calls desc;
```

**Bookings created BY the AI**
```sql
select count(*) filter (where booker_source = 'Glow AI Assistant') as ai_bookings,
       sum(deposit_cents) filter (where booker_source = 'Glow AI Assistant') / 100.0 as ai_deposit_revenue_usd,
       count(*) as total_bookings
from bookings
where created_at > now() - interval '7 days';
```

**Escalations queue**
```sql
select id, phone, reason, summary, matched_booking_id, created_at
from ai_escalations
where status = 'open'
order by created_at desc;
```

Mark an escalation acknowledged:
```sql
update ai_escalations
set status = 'acknowledged', acknowledged_at = now()
where id = '<uuid>';
```

### 2.3 Pause the AI for a specific customer

Useful if a human is mid-conversation:

```sql
update bookings
set ai_human_takeover_until = now() + interval '4 hours'
where phone ilike '%4436486798%';
```

(The AI will still respond to brand-new conversations on that phone after the takeover window expires.)

---

## 3 · Tuning + safety

### 3.1 Re-running the system prompt after changes

Edit `system-prompt.md` → paste into Telnyx Assistant → save. No backend change needed; the tool router is decoupled.

### 3.2 Add new tools

1. Add a new `case` in `ai-tool-router/index.ts` (the switch statement at the bottom).
2. Deploy: `supabase functions deploy ai-tool-router --project-ref sxdraeptzuamsgjcvfeg --no-verify-jwt --use-api`
3. Register the new tool in Telnyx Mission Control with the appropriate URL/body.
4. Reference it in the system prompt §7 (tool call policy).

### 3.3 Reduce hallucinations

- The prompt §0 has hard rules: never invent prices/dates/slots. Every concrete answer the AI gives MUST come from a tool call.
- If you see the AI making things up in the transcript, escalate the bug — usually means the system prompt needs a sharper "never X" rule.
- Telnyx → Assistant settings → enable **"Strict tool calling"** if available.

### 3.4 Compliance

- STOP/HELP are passed to `handle_keyword` which forwards to `sms-inbound` — keeps opt-out compliance consistent.
- 10DLC / TFV — handled by your existing Telnyx number registration, not by the AI.

---

## 4 · Cost expectations

- **Telnyx SMS:** ~$0.0040 per outbound segment + ~$0.0080 inbound (toll-free).
- **Telnyx AI Assistant tokens:** model-dependent; budget ~$0.01–$0.03 per assistant reply with GPT-4o on a typical 4-5-message conversation.
- **Stripe Payment Links:** free to create, 2.9% + $0.30 on successful deposit charge.
- **Supabase edge invocations:** free tier covers up to 500K invocations/month; AI tool calls run ~5 calls per booked conversation → 100K bookings = 500K invocations.

For 100 conversations/day, expect ~$5–$15/day total all-in (Telnyx + LLM + Supabase).

---

## 5 · Test plan — quickstart smoke test

After Telnyx wiring is done, text these to `+18334432004` from a phone NOT in your bookings table:

1. **"Hi, what do you charge?"** → AI should ask for ZIP.
2. **"21030"** → AI runs `check_service_area`, gets a yes, asks for name + bedrooms.
3. **"3 bed 2 bath house, my name is Alex Test, alex@test.com, 123 Main St"** → AI proposes Deep Clean, runs `get_price_estimate`, quotes a number.
4. **"Sounds good, this Saturday morning?"** → AI runs `get_available_slots(2026-05-23)`, offers 3 morning slots.
5. **"10 AM"** → AI runs `create_booking`, replies with a Stripe Payment Link.
6. **Tap the link, pay the deposit** → Stripe webhook fires → booking row flips to `confirmed` → standard confirmation SMS goes out → PG trigger syncs the GHL contact with everything.

End-to-end success = a `confirmed` booking row + a paid Stripe deposit + a GHL contact populated with 50+ custom fields.

Escalation test:

7. From the same phone: **"I want to speak to a real person now."** → AI calls `escalate_to_human(phone_request, ...)` → `ai_escalations` row appears → if you've set `AI_ESCALATION_NOTIFY_PHONE` env var, you get an SMS within ~1 second.

---

## 6 · The optional 9th tool: GHL Conversation API mirror

If later you want every assistant reply ALSO logged into the GHL Conversations tab (for unified visibility with anything humans send from GHL), add a `mirror_to_ghl_conversation` tool that calls `POST /conversations/messages` via PIT. Not implemented today because the Telnyx-native dashboard is already comprehensive — flip it on if your CSRs prefer to work out of GHL exclusively.
