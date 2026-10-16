import { Particles } from "../../components/effects";
import { LeadForm } from "../../components/LeadForm";
import { PHONE_DISPLAY, PHONE_TEL, SUPPORT_EMAIL } from "../../lib/content";

export const metadata = { title: "Contact Us | NovaraCleaning™" };

export default function ContactPage() {
  return (
    <main>
      <section className="hero page-hero">
        <Particles density={28} />
        <div className="wrap">
          <h1>Contact Us</h1>
          <p className="lede">Questions about booking, pricing, or your upcoming clean? Reach out and we’ll get back within 1 business hour (9am–6pm).</p>
        </div>
      </section>
      <section className="section">
        <div className="wrap contact-grid">
          <div>
            <h2>Let’s get in touch and work together!</h2>
            <p className="contact-copy">
              Whether you need a one-time reset, a recurring home clean, or a quote for an office, the NovaraCleaning team is ready to help.
            </p>
            <div className="contact-facts">
              <p>Maryland, Virginia & DC</p>
              <p><a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></p>
              <p><a href={`tel:${PHONE_TEL}`}>{PHONE_DISPLAY}</a></p>
            </div>
          </div>
          <LeadForm
            title="Send us a message"
            submitLabel="Send message"
            showZip={false}
            showService
            showMessage
          />
        </div>
      </section>
    </main>
  );
}
