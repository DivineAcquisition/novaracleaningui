import { notFound } from "next/navigation";
import { LeadForm } from "../../../components/LeadForm";
import { services } from "../../../lib/content";

export function generateStaticParams() {
  return Object.keys(services).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const service = services[slug];
  if (!service) return { title: "Services | NovaraCleaning™" };
  return { title: `${service.title} | NovaraCleaning™` };
}

export default async function ServicePage({ params }) {
  const { slug } = await params;
  const service = services[slug];
  if (!service) notFound();

  return (
    <main>
      <section className="hero page-hero">
        <div className="wrap">
          <h1>{service.title}</h1>
          <p className="lede">{service.eyebrow}</p>
        </div>
      </section>
      <section className="section">
        <div className="wrap detail">
          <LeadForm
            tone="soft"
            title="Get Started Today & Get 50% Off"
            submitLabel="Request a quote"
            showZip={false}
            showService
            showMessage
          />
          <article className="checklist">
            <h2 style={{ textAlign: "left", fontSize: 32 }}>{service.summaryTitle}</h2>
            <p>{service.summary}</p>
            {service.meta ? <p className="meta">{service.meta}</p> : null}
            {service.groups.map((group) => (
              <div key={group.title}>
                <h3>{group.title}</h3>
                <ul>
                  {group.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            ))}
          </article>
        </div>
      </section>
    </main>
  );
}
