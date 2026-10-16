import { areas, BOOK_URL, plans } from "../../lib/content";
import { Glyph } from "../../components/Icons";

export const metadata = { title: "Membership Plans | NovaraCleaning™" };

export default function MembershipPage() {
  return (
    <main>
      <section className="section" style={{ paddingBottom: 20 }}>
        <div className="wrap">
          <div className="center-copy">
            <p style={{ letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 800, fontSize: 13, color: "#7a45f6" }}>● Pricing</p>
            <h2 style={{ background: "linear-gradient(90deg,#6d28d9,#8b5cf6)", WebkitBackgroundClip: "text", color: "transparent" }}>
              Novara Cleaning Membership
            </h2>
          </div>
          <div className="plans">
            {plans.map((plan) => (
              <article className={plan.featured ? "plan featured" : "plan"} key={plan.name}>
                {plan.featured ? <div className="plan-flag">Novara Recommended</div> : null}
                <div className="plan-body">
                  <div className="mini-icon"><Glyph name="calendar" /></div>
                  <h3>{plan.name}</h3>
                  <p className="who">{plan.audience}</p>
                  <p className="price">{plan.price} <span>/month</span></p>
                </div>
                <div className="plan-foot">
                  <h4>What’s in it for you?</h4>
                  <ul>
                    {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
                  </ul>
                  <a className="btn btn-primary btn-block" href={BOOK_URL}>Get started</a>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="section" style={{ paddingTop: 10 }}>
        <div className="wrap">
          <div className="center-copy">
            <h2>Where we clean</h2>
            <p>Membership and one-time cleans are available across the DMV. The live Framer page also embeds a New York map left over from the template; it is not part of this preview.</p>
          </div>
          <div className="maps">
            {areas.map((area) => (
              <article className="map-card" key={area.name}>
                <iframe
                  title={`Map of ${area.name}`}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  src={`https://maps.google.com/maps?q=${encodeURIComponent(area.query)}&z=7&output=embed`}
                />
                <p>{area.name}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
