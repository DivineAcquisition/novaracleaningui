import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_PHONE = "4436486798";
const CLEANER_PORTAL_URL = "https://try.novaracleaning.com/cleaner/dashboard";

function generateToken(assignmentId: string): string {
  const secret = Deno.env.get("OFFER_TOKEN_SECRET") || "novara-offer-2026";
  const encoder = new TextEncoder();
  const data = encoder.encode(assignmentId + secret);
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data[i]) | 0;
  }
  return Math.abs(hash).toString(36).padStart(8, '0').substring(0, 10);
}

function verifyToken(assignmentId: string, token: string): boolean {
  const expected = generateToken(assignmentId);
  // Support both new secure token and legacy base64 token
  const legacyToken = btoa(assignmentId).substring(0, 10);
  return token === expected || token === legacyToken;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const assignmentId = url.searchParams.get("id");
    const action = url.searchParams.get("action");
    const token = url.searchParams.get("token");

    if (!assignmentId || !action || !token) {
      throw new Error("Missing required parameters");
    }

    console.log(`[RESPOND] Assignment ${assignmentId} - Action: ${action}`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    if (!verifyToken(assignmentId, token)) {
      throw new Error("Invalid or expired token");
    }

    const { data: assignment, error: fetchError } = await supabase
      .from("job_assignments")
      .select("*, jobs(*), cleaners(*)")
      .eq("id", assignmentId)
      .single();

    if (fetchError || !assignment) {
      throw new Error("Assignment not found");
    }

    if (assignment.status !== "Offered") {
      const statusLabel = assignment.status === "Expired" ? "expired" : "already responded to";
      return new Response(renderPage("⚠️", `Offer ${statusLabel}`, `This job offer has been ${statusLabel}.`), {
        headers: { ...corsHeaders, "Content-Type": "text/html" },
      });
    }

    // Check if offer has expired (15 min)
    const offerAge = Date.now() - new Date(assignment.assigned_at).getTime();
    if (offerAge > 15 * 60 * 1000) {
      await supabase
        .from("job_assignments")
        .update({ status: "Expired", responded_at: new Date().toISOString() })
        .eq("id", assignmentId);

      return new Response(renderPage("⏰", "Offer Expired", "This offer has expired. You'll receive new offers soon."), {
        headers: { ...corsHeaders, "Content-Type": "text/html" },
      });
    }

    const newStatus = action === "accept" ? "Confirmed" : "Declined";
    await supabase
      .from("job_assignments")
      .update({ status: newStatus, responded_at: new Date().toISOString() })
      .eq("id", assignmentId);

    // Update cleaner performance metrics
    const { data: cleaner } = await supabase
      .from("cleaners")
      .select("total_offers_received, total_offers_accepted")
      .eq("id", assignment.cleaner_id)
      .single();

    const newOffersReceived = (cleaner?.total_offers_received || 0) + 1;
    const newOffersAccepted = action === "accept"
      ? (cleaner?.total_offers_accepted || 0) + 1
      : (cleaner?.total_offers_accepted || 0);

    await supabase
      .from("cleaners")
      .update({
        total_offers_received: newOffersReceived,
        total_offers_accepted: newOffersAccepted,
        acceptance_rate: Math.round((newOffersAccepted / newOffersReceived) * 1000) / 10,
      })
      .eq("id", assignment.cleaner_id);

    const jobDate = new Date(assignment.jobs.start_datetime).toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric",
    });
    const estimatedPay = ((assignment.pay_rate_hr || 18) * (assignment.jobs.duration_est_hours || 3)).toFixed(2);
    const cleanerName = `${assignment.cleaners.first_name} ${assignment.cleaners.last_name}`;

    if (action === "accept") {
      // --- ACCEPTED: Send confirmation SMS with full job details ---
      if (assignment.cleaners.phone) {
        const confirmMsg = `✅ Job Confirmed!

📅 ${jobDate}
📍 ${assignment.jobs.address || ''}, ${assignment.jobs.city}, ${assignment.jobs.state} ${assignment.jobs.zip}
⏰ Duration: ${assignment.jobs.duration_est_hours}hrs
💰 Pay: $${estimatedPay}
🧹 Role: ${assignment.role}
📏 Distance: ${assignment.distance_miles?.toFixed(1)} mi

View details in your dashboard: ${CLEANER_PORTAL_URL}`;

        await supabase.functions.invoke("send-sms-notification", {
          body: { toPhone: assignment.cleaners.phone, message: confirmMsg, type: "confirmation", jobAssignmentId: assignment.id },
        }).catch(() => {});
      }

      // Notify admin
      await supabase.functions.invoke("send-sms-notification", {
        body: {
          toPhone: ADMIN_PHONE,
          message: `✅ ${cleanerName} ACCEPTED job on ${jobDate} in ${assignment.jobs.city}. Pay: $${estimatedPay}. Role: ${assignment.role}.`,
          type: "confirmation",
        },
      }).catch(() => {});

      // Update cleaner scores
      try {
        await supabase.functions.invoke("update-cleaner-scores", {
          body: { cleanerId: assignment.cleaner_id },
        });
      } catch {}

    } else {
      // --- DECLINED: Notify admin + auto-escalate ---
      await supabase.functions.invoke("send-sms-notification", {
        body: {
          toPhone: ADMIN_PHONE,
          message: `❌ ${cleanerName} DECLINED job on ${jobDate} in ${assignment.jobs.city}. Auto-dispatching to next available cleaner...`,
          type: "reminder",
        },
      }).catch(() => {});

      // Check how many confirmed/offered cleaners remain for this job
      const { data: remaining } = await supabase
        .from("job_assignments")
        .select("id, status")
        .eq("job_id", assignment.jobs.id)
        .in("status", ["Offered", "Confirmed"]);

      const confirmedCount = (remaining || []).filter(a => a.status === "Confirmed").length;
      const offeredCount = (remaining || []).filter(a => a.status === "Offered").length;
      const needed = (assignment.jobs.min_cleaners_required || 2) - confirmedCount - offeredCount;

      if (needed > 0) {
        console.log(`[RESPOND] Re-dispatching: ${needed} more cleaners needed for job ${assignment.jobs.id}`);
        try {
          await supabase.functions.invoke("dispatch-job", {
            body: { jobId: assignment.jobs.id },
          });
        } catch (dispatchErr) {
          console.error("[RESPOND] Re-dispatch failed:", dispatchErr);
          await supabase.from("dispatch_alerts").insert({
            job_id: assignment.jobs.id,
            reason: `${cleanerName} declined. Auto re-dispatch failed. ${needed} more cleaner(s) needed.`,
            severity: "warning",
          });
        }
      }
    }

    const emoji = action === "accept" ? "✅" : "❌";
    const title = action === "accept" ? "Job Accepted!" : "Job Declined";
    const message = action === "accept"
      ? "You're confirmed for this job. Full details have been sent to your phone."
      : "No worries — we'll send you more offers soon.";

    const detailsHtml = `
      <div style="margin:30px 0;padding:20px;background:#f9fafb;border-radius:12px;text-align:left">
        <h3 style="margin:0 0 12px;color:#1f2937">Job Details</h3>
        <p><strong>Date:</strong> ${jobDate}</p>
        <p><strong>Location:</strong> ${assignment.jobs.city}, ${assignment.jobs.state} ${assignment.jobs.zip}</p>
        <p><strong>Duration:</strong> ${assignment.jobs.duration_est_hours} hours</p>
        <p><strong>Pay:</strong> $${estimatedPay}</p>
        <p><strong>Role:</strong> ${assignment.role}</p>
        <p><strong>Distance:</strong> ${assignment.distance_miles?.toFixed(1)} miles</p>
      </div>`;

    return new Response(
      renderPage(emoji, title, message, detailsHtml),
      { headers: { ...corsHeaders, "Content-Type": "text/html" } }
    );
  } catch (error: any) {
    console.error("[RESPOND] Error:", error);
    return new Response(
      renderPage("❌", "Error", error.message),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "text/html" } }
    );
  }
});

function renderPage(emoji: string, title: string, message: string, extra = ""): string {
  return `<!DOCTYPE html>
<html><head>
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:#f3f4f6; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
    .card { background:white; border-radius:16px; box-shadow:0 4px 24px rgba(0,0,0,0.1); padding:40px; max-width:480px; width:100%; text-align:center; }
    .emoji { font-size:64px; margin-bottom:16px; }
    h1 { font-size:24px; color:#1f2937; margin-bottom:8px; }
    .msg { font-size:16px; color:#6b7280; line-height:1.6; }
    .btn { display:inline-block; padding:14px 28px; background:linear-gradient(135deg,#7c3aed,#6d28d9); color:white; text-decoration:none; border-radius:10px; font-weight:600; margin-top:24px; }
    .btn:hover { opacity:0.9; }
  </style>
</head><body>
  <div class="card">
    <div class="emoji">${emoji}</div>
    <h1>${title}</h1>
    <p class="msg">${message}</p>
    ${extra}
    <a href="${CLEANER_PORTAL_URL}" class="btn">Open Dashboard</a>
  </div>
</body></html>`;
}
