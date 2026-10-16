import { ServiceGrid } from "../../components/ServiceGrid";

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
        <div className="wrap">
          <ServiceGrid />
        </div>
      </section>
    </main>
  );
}
