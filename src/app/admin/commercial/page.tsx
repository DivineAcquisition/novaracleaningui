import { redirect } from "next/navigation";
import { proposalsHubTab } from "@/lib/commercial-proposal";

// Commercial was renamed Accounts. Offer tabs still go to Proposals.
export default function Page({
  searchParams,
}: {
  searchParams: { tab?: string; account?: string };
}) {
  const raw = String(searchParams?.tab || "");
  const tab = raw === "proposals" ? "pipeline" : raw;
  if (tab === "send") {
    redirect(proposalsHubTab("send", searchParams?.account ? { account: searchParams.account, flow: "commercial" } : { flow: "commercial" }));
  }
  if (tab === "pipeline") {
    redirect(proposalsHubTab("pipeline"));
  }
  if (tab === "walkthroughs") {
    redirect(proposalsHubTab("price"));
  }

  const params = new URLSearchParams();
  if (tab) params.set("tab", tab);
  if (searchParams?.account) params.set("account", searchParams.account);
  const suffix = params.toString();
  redirect(suffix ? `/admin/accounts?${suffix}` : "/admin/accounts");
}

export const dynamic = "force-dynamic";
