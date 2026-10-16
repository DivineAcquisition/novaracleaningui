import Link from "next/link";
import { MagicCard, TiltCard } from "./effects";
import { serviceCards } from "../lib/content";

export function ServiceGrid() {
  return (
    <div className="bento">
      <div className="service-grid">
        {serviceCards.map((service) => (
          <TiltCard className="service-tilt" key={service.slug}>
            <MagicCard className="service-slot">
              <Link className="service-card" href={`/services/${service.slug}`}>
                <img src={service.image} alt={service.imageAlt} />
                <span className="service-copy">
                  <h3>{service.title}</h3>
                  <p>{service.blurb}</p>
                </span>
              </Link>
            </MagicCard>
          </TiltCard>
        ))}
      </div>
    </div>
  );
}
