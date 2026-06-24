import OpenScheduler from "@/views/partner/OpenScheduler";

// Public, token-authenticated weekly scheduler (sent to hosts via SMS/email).
// No login — the hosts.calendar_token in the URL identifies the account.
export default function Page({ params }: { params: { token: string } }) {
  return <OpenScheduler token={params.token} />;
}

export const dynamic = "force-dynamic";
