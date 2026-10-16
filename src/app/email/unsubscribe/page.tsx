import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { notifyGhlEmailDnd } from "@/lib/email-compliance/ghl";
import { emailForToken, suppressAddress } from "@/lib/email-compliance/store";

export const dynamic = "force-dynamic";

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return domain ? `${user.slice(0, 2)}***@${domain}` : email;
}

export default async function UnsubscribePage({ searchParams }: { searchParams: { t?: string } }) {
  const token = searchParams.t || "";
  let message = "This unsubscribe link is missing its token.";
  let ok = false;
  if (token) {
    try {
      const supabase = getAdminSupabase();
      const email = await emailForToken(supabase, token);
      if (!email) message = "This unsubscribe link is not valid.";
      else {
        await suppressAddress(supabase, { email, reason: "unsubscribe", source: "unsubscribe_link", actor: "contact" });
        void notifyGhlEmailDnd(email);
        ok = true;
        message = `${maskEmail(email)} is unsubscribed from marketing email. Service messages about bookings, payments, and your account continue. Text messages are unchanged.`;
      }
    } catch {
      message = "We could not complete that unsubscribe. Reply to the email and we will take you off.";
    }
  }

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-16 text-zinc-800">
      <div className="mx-auto max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold text-violet-800">Novara Cleaning</p>
        <h1 className="mt-2 text-2xl font-semibold">{ok ? "You are unsubscribed" : "Unsubscribe"}</h1>
        <p className="mt-4 text-sm leading-6">{message}</p>
      </div>
    </main>
  );
}
