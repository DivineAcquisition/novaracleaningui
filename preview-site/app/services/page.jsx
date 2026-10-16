import Link from "next/link";
import { Spark } from "../../components/Icons";
import { serviceCards } from "../../lib/content";

export const metadata = { title: "Our Services | NovaraCleaning™" };

export default function ServicesPage() {
  return (
    <main>
      <section className="hero page-hero">
        <div className="wrap">
          <h1>Services</h1>
          <p className="lede">Home, office, and commercial cleaning across Maryland, Virginia, and Washington, DC.</p>
        </div>
      </section>
      <section className="section">
        <div className="wrap service-grid">
          {serviceCards.map((service) => (
            <Link className="service-card" href={`/services/${service.slug}`} key={service.slug}>
              <Spark />
              <h3>{service.title}</h3>
              <p>{service.blurb}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
