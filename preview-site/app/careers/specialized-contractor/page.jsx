import { Particles } from "../../../components/effects";
import { LeadForm } from "../../../components/LeadForm";

export const metadata = { title: "Specialized Contractor | NovaraCleaning™" };

export default function SpecializedContractorPage() {
  return (
    <main>
      <section className="hero page-hero">
        <Particles density={28} />
        <div className="wrap">
          <h1>Specialized Contractor</h1>
          <p className="lede">Advanced cleans on strict timelines. Bring your expertise and gear; we bring consistent work.</p>
        </div>
      </section>
      <section className="section">
        <div className="wrap contact-grid">
          <div>
            <h2>Specialized Contractor (1099) — Waitlist Only</h2>
            <p className="contact-copy">
              We’re here to answer your questions, explore opportunities, and help bring your ideas to life. Reach out and we typically respond within 24 hours.
            </p>
          </div>
          <LeadForm
            title="Join the waitlist"
            submitLabel="Send Message"
            names
            showZip={false}
            showMessage
          />
        </div>
      </section>
    </main>
  );
}
