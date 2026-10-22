"use client";

import { SEO } from "@/components/SEO";
import { SiteLegalFooter } from "@/components/site/SiteLegalFooter";
import { PUBLIC_SITE } from "@/lib/public-site";

export default function TextMessageTerms() {
  const site = PUBLIC_SITE;
  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <SEO
        title="Text Message Terms"
        description="What texts Novara Cleaning sends, how to stop them, and that consent is not required to book or apply."
      />
      <main className="mx-auto max-w-2xl px-4 py-12">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{site.brand}</p>
        <h1 className="mt-2 text-3xl font-bold">Text Message Terms</h1>
        <p className="mt-4 text-sm leading-6 text-zinc-700">
          {site.legalName} sends text messages from the Novara Cleaning program. The phone number is{" "}
          <a className="underline" href={site.phoneTel}>{site.phoneDisplay}</a>.
          Email <a className="underline" href={`mailto:${site.emails.support}`}>{site.emails.support}</a>.
        </p>

        <h2 className="mt-8 text-xl font-semibold">Customers</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-zinc-700">
          <li>Messages can include booking confirmations, reminders, and arrival and completion notices.</li>
          <li>Promotions are sent only if you agreed to promotional texts. That box is optional.</li>
          <li>Message frequency varies. Message and data rates may apply.</li>
          <li>Consent is not required to book a cleaning.</li>
          <li>Reply STOP to cancel texts. Reply HELP for help.</li>
          <li>Carriers are not liable for delayed or undelivered messages.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Applicants and contractors</h2>
        <p className="mt-3 text-sm leading-6 text-zinc-700">
          Job and application texts are a separate program. Consent is not required to apply. Reply STOP to cancel those texts and HELP for help. The same phone and support email apply.
        </p>

        <p className="mt-8 text-sm leading-6 text-zinc-700">
          <a className="underline" href="https://novaracleaning.com/privacy">Privacy Policy</a>
          {" · "}
          <a className="underline" href="https://novaracleaning.com/terms">Terms</a>
        </p>
      </main>
      <SiteLegalFooter />
    </div>
  );
}
