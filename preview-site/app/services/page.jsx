import Link from "next/link";
import { MagicCard, Particles, TiltCard } from "../../components/effects";
import { Spark } from "../../components/Icons";
import { serviceCards } from "../../lib/content";

export const metadata = { title: "Our Services | NovaraCleaning™" };

export default function ServicesPage() {
  return (
    <main>
      <section className="hero page-hero">
        <Particles density={28} />
        <div className="wrap" style={{ position: "relative", zIndex: 1 }}>
          <h1>Services</h1>
          <p className="lede">Home, office, and commercial cleaning across Maryland, Virginia, and Washington, DC.</p>
        </div>
      </section>
      <section className="section">
        <div className="wrap">
          <div className="bento">
            <div className="service-grid">
              {serviceCards.map((service) => (
                <TiltCard key={service.slug}>
                  <MagicCard className="service-slot">
                    <Link className="service-card" href={`/services/${service.slug}`}>
                      <Spark />
                      <h3>{service.title}</h3>
                      <p>{service.blurb}</p>
                    </Link>
                  </MagicCard>
                </TiltCard>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
