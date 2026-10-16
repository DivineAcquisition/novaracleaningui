import Link from "next/link";
import { Compare } from "../components/Compare";
import { BlurFade, HeroSpotlight, MagicCard, Marquee, ShinyText } from "../components/effects";
import { Faq } from "../components/Faq";
import { Glyph } from "../components/Icons";
import { LeadForm } from "../components/LeadForm";
import { ProductStage } from "../components/ProductStage";
import { ServiceGrid } from "../components/ServiceGrid";
import { BOOK_URL, places, steps, values } from "../lib/content";

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <HeroSpotlight />
        <div className="wrap hero-grid">
          <div>
            <p className="kicker"><ShinyText>Book Your First Cleaning 50% Off.</ShinyText></p>
            <h1>Your Newly Started Trusted DMV Area Premium Cleaning Service</h1>
            <p className="lede">
              We connect homeowners with trusted, vetted cleaners through Novara.
              But with real local care and a membership that actually benefits you.
            </p>
            <Link className="btn btn-light" href="/services">Explore our services</Link>
          </div>
          <LeadForm />
        </div>
      </section>
      <Marquee items={places} />

      <section className="section lav" style={{ paddingBottom: 28 }}>
        <div className="wrap">
          <h2>Book Your Service In 3 <span className="muted-word">Easy Steps</span></h2>
          <div className="steps">
            {steps.map((step, index) => (
              <BlurFade delay={index * 0.08} key={step.title}>
                <article className="step">
                  <div className="icon-blob"><Glyph name={step.icon} /></div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </article>
              </BlurFade>
            ))}
          </div>
          <div className="rule" />
        </div>
      </section>

      <ProductStage />

      <section className="section" id="services">
        <div className="wrap">
          <div className="center-copy">
            <h2>Our Cleaning Services</h2>
            <p>
              At <strong>Novara Cleaning</strong>, we don’t just clean — we care for your space with precision, consistency, and attention to detail. Whether you need a quick refresh, a deep restorative clean, or a full property reset, our services are designed to fit your lifestyle and standards.
            </p>
          </div>
          <ServiceGrid />
        </div>
      </section>

      <section className="section" style={{ paddingTop: 10 }}>
        <div className="wrap mid-cta">
          <h2>Ready to enjoy a cleaner, <span className="muted-word">fresher</span> home?</h2>
          <p>Book your cleaning in under 60 seconds, pay just <ShinyText light>50% off today</ShinyText>, and let our team handle the rest.</p>
          <a className="btn btn-primary" href={BOOK_URL}>Book My 50% Off Cleaning</a>
        </div>
      </section>

      <Compare />

      <section className="section" id="about">
        <div className="wrap">
          <div className="center-copy">
            <h2>Founders’ Note & Our Values</h2>
            <p>
              We’re new to the neighborhood, not to high standards. Novara Cleaning delivers hotel-grade detail, transparent pricing, and a real guarantee: if anything’s missed, we return for a free reclean. — The NovaraCleaning Team
            </p>
          </div>
          <div className="value-grid">
            {values.map((value, index) => (
              <BlurFade delay={index * 0.08} key={value.title}>
                <MagicCard className="value-card">
                  <div className="mini-icon"><Glyph name={value.icon} /></div>
                  <h3>{value.title}</h3>
                  <p>{value.body}</p>
                </MagicCard>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="trust shine-frame">
            <h2>Trust, Insured & Secure</h2>
            <p>We’re fully insured and bonded, ensuring your property and our team are protected. Our background-checked professionals are trained to deliver reliable, secure, and top-quality cleaning services you can trust.</p>
            <div className="badges" aria-hidden="true">
              {["home", "clipboard", "shield", "users", "badge"].map((name) => (
                <div className="badge" key={name}><Glyph name={name} /></div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <Faq />
    </main>
  );
}
