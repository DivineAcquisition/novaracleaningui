import { supabase } from "@/integrations/supabase/client";

async function authHeaders(): Promise<HeadersInit> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  };
}

export async function sendMembershipAgreement(input: {
  email: string;
  name?: string;
  phone?: string;
  plan?: string;
  serviceAddress?: string;
  firstServiceDate?: string;
  membershipRateCents?: number;
  oneTimeRateCents?: number;
  initialDeepClean?: string;
  homeSizeId?: string;
  scheduleId?: string;
  paymentUrl?: string;
  holdPayment?: boolean;
  sendEmail?: boolean;
}) {
  const res = await fetch("/api/memberships/send-agreement", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Agreement send failed (${res.status})`);
  return data as {
    ok?: boolean;
    signingUrl?: string | null;
    submissionId?: string | null;
    holdPayment?: boolean;
    paymentUrl?: string | null;
    error?: string;
  };
}

export async function sendCustomerChecklist(input: {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  serviceType?: string;
  sendEmail?: boolean;
  sendSms?: boolean;
}) {
  const { data, error } = await supabase.functions.invoke("send-cleaning-checklist", {
    body: {
      email: input.email || undefined,
      phone: input.phone || undefined,
      firstName: input.firstName || undefined,
      serviceType: input.serviceType || "standard",
      sendEmail: input.sendEmail !== false,
      sendSms: Boolean(input.sendSms && input.phone),
      force: true,
    },
  });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as { success?: boolean; emailed?: boolean; smsSent?: boolean; viewUrl?: string };
}
