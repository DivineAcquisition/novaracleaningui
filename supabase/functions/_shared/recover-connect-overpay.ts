// Recovers a Connect overpay: wait until a bank-payout reversal credits the
// contractor's Stripe balance, then reverse the original platform transfer
// so the money returns to Novara. Never reverse the transfer while the
// connected available balance is short — that would create a second bank
// debit via debit_negative_balances.

import Stripe from "https://esm.sh/stripe@18.5.0";
import { resolveSecret } from "./app-secrets.ts";

// deno-lint-ignore no-explicit-any
type DB = any;

export const OPEN_STATUSES = ["watching", "ready", "recovering"] as const;
const OPS_EMAIL = "contact@novaracleaning.com";

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function usdFromBalance(
  buckets: Array<{ amount?: number; currency?: string }> | null | undefined,
): number {
  return (buckets || [])
    .filter((b) => (b.currency || "usd") === "usd")
    .reduce((s, b) => s + (Number(b.amount) || 0), 0);
}

async function stripeClient(admin: DB): Promise<Stripe> {
  const key = await resolveSecret(admin, "STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY missing");
  return new Stripe(key, { apiVersion: "2025-08-27.basil" });
}

async function notifyOps(admin: DB, subject: string, html: string): Promise<void> {
  try {
    const resendKey = await resolveSecret(admin, "RESEND_API_KEY");
    if (!resendKey) return;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Novara Cleaning <hello@novaracleaning.com>",
        to: [OPS_EMAIL],
        subject,
        html,
      }),
    });
  } catch (err) {
    console.warn("[recover-connect-overpay] notify failed", err);
  }
}

async function pauseAutomaticPayouts(
  stripe: Stripe,
  row: Record<string, unknown>,
  admin: DB,
): Promise<void> {
  if (row.payouts_paused) return;
  const accountId = String(row.stripe_account_id);
  const acct = await stripe.accounts.retrieve(accountId);
  const schedule = acct.settings?.payouts?.schedule;
  const interval = schedule?.interval || "daily";
  const delayDays = typeof schedule?.delay_days === "number" ? schedule.delay_days : 2;
  if (interval !== "manual") {
    await stripe.accounts.update(accountId, {
      settings: { payouts: { schedule: { interval: "manual" } } },
    });
  }
  await admin.from("connect_overpay_recovery").update({
    payouts_paused: true,
    prior_payout_interval: interval,
    prior_payout_delay_days: delayDays,
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
  row.payouts_paused = true;
  row.prior_payout_interval = interval;
  row.prior_payout_delay_days = delayDays;
}

async function restoreAutomaticPayouts(
  stripe: Stripe,
  row: Record<string, unknown>,
): Promise<void> {
  if (!row.payouts_paused) return;
  const interval = String(row.prior_payout_interval || "daily");
  if (interval === "manual") return;
  const delayDays = Number(row.prior_payout_delay_days) || 2;
  try {
    await stripe.accounts.update(String(row.stripe_account_id), {
      settings: {
        payouts: {
          schedule: { interval: "daily", delay_days: delayDays },
        },
      },
    });
  } catch (err) {
    console.warn("[recover-connect-overpay] restore payout schedule failed", err);
  }
}

async function mark(
  admin: DB,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await admin.from("connect_overpay_recovery").update({
    ...patch,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
}

export async function tickRecoverConnectOverpay(
  admin: DB,
  opts?: { rowId?: string },
): Promise<{ checked: number; results: unknown[] }> {
  const stripe = await stripeClient(admin);
  let q = admin
    .from("connect_overpay_recovery")
    .select("*")
    .in("status", [...OPEN_STATUSES]);
  if (opts?.rowId) q = q.eq("id", opts.rowId);
  const { data: rows, error } = await q;
  if (error) throw error;
  const list = (rows || []) as Record<string, unknown>[];
  const results: unknown[] = [];

  for (const row of list) {
    results.push(await processRow(admin, stripe, row));
  }
  return { checked: list.length, results };
}

async function processRow(
  admin: DB,
  stripe: Stripe,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = String(row.id);
  const accountId = String(row.stripe_account_id);
  const transferId = String(row.transfer_id);
  const payoutReversalId = String(row.payout_reversal_id);
  const amountCents = Number(row.amount_cents) || 0;
  const label = String(row.booking_label || transferId);
  const name = String(row.cleaner_name || "contractor");

  try {
    await pauseAutomaticPayouts(stripe, row, admin);

    const payout = await stripe.payouts.retrieve(
      payoutReversalId,
      {},
      { stripeAccount: accountId },
    );
    const bal = await stripe.balance.retrieve({ stripeAccount: accountId });
    const available = usdFromBalance(bal.available as never);
    const pending = usdFromBalance(bal.pending as never);
    const transfer = await stripe.transfers.retrieve(transferId);
    const alreadyReversed = (transfer.amount_reversed || 0) >= amountCents || !!transfer.reversed;

    const snapshot = {
      last_payout_status: payout.status,
      last_available_cents: available,
      last_pending_cents: pending,
      last_checked_at: new Date().toISOString(),
      last_error: null,
    };

    if (alreadyReversed) {
      await restoreAutomaticPayouts(stripe, row);
      await mark(admin, id, {
        ...snapshot,
        status: "recovered",
        stripe_reversal_id: row.stripe_reversal_id || "already_reversed",
        recovered_at: new Date().toISOString(),
        payouts_paused: false,
      });
      return { id, action: "already_reversed", payoutStatus: payout.status, available, pending };
    }

    if (payout.status === "failed" || payout.status === "canceled") {
      await restoreAutomaticPayouts(stripe, row);
      await mark(admin, id, {
        ...snapshot,
        status: "failed",
        last_error: payout.failure_message || `payout ${payout.status}`,
        payouts_paused: false,
      });
      await notifyOps(
        admin,
        `Connect recovery FAILED — ${label} ${usd(amountCents)}`,
        `<p>The bank debit on ${name}'s connected account is <strong>${payout.status}</strong>.</p>
         <p>${payout.failure_message || "Stripe could not pull the funds from her bank."}</p>
         <p>Payout reversal: <code>${payoutReversalId}</code></p>
         <p>The original transfer <code>${transferId}</code> was <strong>not</strong> reversed, so Novara's platform balance did not change.</p>`,
      );
      return { id, action: "failed", payoutStatus: payout.status, failure: payout.failure_message };
    }

    const debitInFlight = payout.status === "pending" || payout.status === "in_transit";
    if (debitInFlight || (payout.status === "paid" && available < amountCents)) {
      const nextStatus = payout.status === "paid" ? "ready" : "watching";
      const becameReady = nextStatus === "ready" && row.status !== "ready";
      await mark(admin, id, { ...snapshot, status: nextStatus });
      if (!row.armed_notified_at) {
        await notifyOps(
          admin,
          `Connect recovery armed — watching ${name} ${usd(amountCents)}`,
          `<p>Bank debit is <strong>${payout.status}</strong> (still attempting to pull ${usd(amountCents)} from ${name}'s bank).</p>
           <p>Payout reversal: <code>${payoutReversalId}</code></p>
           <p>Her Connect balance now: available ${usd(available)}, pending ${usd(pending)}.</p>
           <p>Automatic daily payouts on her account are paused so the money cannot leave for her bank again. The moment ${usd(amountCents)} is <em>available</em> on her Stripe balance, we will reverse transfer <code>${transferId}</code> onto Novara's platform balance.</p>`,
        );
        await mark(admin, id, { armed_notified_at: new Date().toISOString() });
      }
      if (becameReady) {
        await notifyOps(
          admin,
          `Connect recovery: bank debit succeeded — waiting for available balance (${name})`,
          `<p>Stripe marked payout reversal <code>${payoutReversalId}</code> as <strong>paid</strong>.</p>
           <p>Her Connect balance: available ${usd(available)}, pending ${usd(pending)}. We will reverse the transfer as soon as available ≥ ${usd(amountCents)}.</p>`,
        );
      }
      return {
        id,
        action: "waiting",
        payoutStatus: payout.status,
        available,
        pending,
        debitInFlight,
      };
    }

    if (payout.status === "paid" && available >= amountCents) {
      const { data: locked } = await admin
        .from("connect_overpay_recovery")
        .update({ status: "recovering", updated_at: new Date().toISOString() })
        .eq("id", id)
        .in("status", ["watching", "ready"])
        .select("id")
        .maybeSingle();
      if (!locked) {
        return { id, action: "skipped_lock", available, pending };
      }

      const reversal = await stripe.transfers.createReversal(
        transferId,
        {
          amount: amountCents,
          description: `Recover duplicate pay ${label}`,
          metadata: {
            recovery_id: id,
            payout_reversal_id: payoutReversalId,
            source: "recover-connect-overpay",
          },
        },
        { idempotencyKey: `recover_transfer_${transferId}` },
      );

      await restoreAutomaticPayouts(stripe, row);
      await mark(admin, id, {
        ...snapshot,
        status: "recovered",
        stripe_reversal_id: reversal.id,
        recovered_at: new Date().toISOString(),
        payouts_paused: false,
      });
      await notifyOps(
        admin,
        `Connect recovery COMPLETE — ${usd(amountCents)} back on Novara Stripe (${name})`,
        `<p>${usd(amountCents)} is back on the Novara platform Stripe balance.</p>
         <p>Transfer reversed: <code>${transferId}</code></p>
         <p>Reversal: <code>${reversal.id}</code></p>
         <p>Source: bank debit <code>${payoutReversalId}</code> on ${name}'s Connect account, then transfer reversal onto the platform.</p>
         <p>Her automatic daily payouts have been restored.</p>`,
      );
      return {
        id,
        action: "recovered",
        reversalId: reversal.id,
        available,
        pending,
        payoutStatus: payout.status,
      };
    }

    await mark(admin, id, {
      ...snapshot,
      last_error: `unexpected payout status ${payout.status}`,
    });
    return { id, action: "unknown_payout_status", payoutStatus: payout.status, available, pending };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await mark(admin, id, {
      last_error: msg.slice(0, 500),
      last_checked_at: new Date().toISOString(),
      status: row.status === "recovering" ? "ready" : row.status,
    });
    return { id, action: "error", error: msg };
  }
}
