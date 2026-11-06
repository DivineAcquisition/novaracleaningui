import { Suspense } from "react";
import IndexPage from "@/views/Index";
import { AgentFlow } from "@/components/landing/AgentFlow";
import { Faq, Pricing, faqJsonLd } from "@/components/landing/Closing";
import { dollars } from "@/components/landing/format";
import { Hosts } from "@/components/landing/Hosts";
import { NovaSection } from "@/components/landing/NovaSection";
import { Standard } from "@/components/landing/Story";
import { GuaranteeBand } from "@/components/landing/Value";
import { getLandingData, startingOnlinePrice, startingPrice } from "@/lib/landing/data";

// The landing page keeps its original layout (src/views/Index.tsx). Sections
// that need live prices or render on the server are built here and passed in.
export default async function Page() {
  const { prices } = await getLandingData();
  const band = prices.bands.find((b) => b.id === "1000_1500") || prices.bands[0];
  const deep = (band && prices.base[band.id]?.deep) || startingPrice(prices, "deep");
  const oven = prices.addOns.find((a) => a.id === "oven");
  const standardFrom = startingOnlinePrice(prices, "standard");

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd()) }} />
      <Suspense>
        <IndexPage
          standardFrom={standardFrom > 0 ? dollars(standardFrom) : null}
          afterHow={
            <>
              <AgentFlow />
              <Standard />
            </>
          }
          afterWhy={
            <>
              <GuaranteeBand />
              <Hosts />
              <NovaSection deep={dollars(deep)} bandLabel={band?.label || ""} oven={oven ? dollars(oven.cents) : null} />
              <Pricing prices={prices} />
              <Faq />
            </>
          }
        />
      </Suspense>
    </>
  );
}

export const dynamic = "force-dynamic";
